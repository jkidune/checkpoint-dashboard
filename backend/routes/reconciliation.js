const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const {
  Counter,
  Member,
  Contribution,
  Loan,
  Repayment,
  Fine,
  Transaction,
  Expense,
  Investment,
  ReconciliationRun,
  AuditSourceRecord,
} = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const CURRENT_NAME_OVERRIDES = new Map(Object.entries({
  'ansgar thomas kabutelana': 'Ansgar Kabutelana',
  'elias prosper wakara': 'Elias Wakara',
  'emmanuel giddamis': 'Emmanuel Gidamis',
  'gibson gosbert mulokozi': 'Gibson Mulokozi',
  'jakob shauri daniel': 'Jakob Daniel',
  'william george mattao': 'William Mattao',
}));

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sourceContext(source) {
  if (
    source?.schema_version !== 'checkpoint-reconciliation-v1'
    || !source?.generated_on
    || !Array.isArray(source?.members)
    || !Array.isArray(source?.contribution_ledgers)
    || !source?.loan_ledgers
  ) {
    throw new Error('Unsupported or incomplete reconciliation file');
  }

  const aliases = new Map(
    (source.member_alias_map || []).map((item) => [normalizeName(item.input_name), item.canonical_member])
  );
  for (const [input, canonical] of CURRENT_NAME_OVERRIDES) aliases.set(input, canonical);
  for (const member of source.members) aliases.set(normalizeName(member.member), member.member);

  const canonicalName = (value) => aliases.get(normalizeName(value)) || value;
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const runKey = `${source.schema_version}:${source.generated_on}`;

  return { aliases, canonicalName, sourceHash, runKey };
}

function periodParts(period) {
  const [monthName, yearText] = period.split(' ');
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ].indexOf(monthName) + 1;
  if (!month || !yearText) throw new Error(`Invalid contribution period: ${period}`);
  return { month, year: Number(yearText) };
}

function desiredLoans(source) {
  return [
    ...source.loan_ledgers.Y1_standardised.map((loan) => ({
      ...loan,
      fiscal_year: 2024,
      total_repayments: loan.total_repayments,
      desired_status: 'paid',
    })),
    ...source.loan_ledgers.Y2_primary_ledger.map((loan) => ({
      ...loan,
      fiscal_year: loan.issue_date < '2025-03-01' ? 2024 : 2025,
      total_repayments: loan.repayments_y2 + loan.repayments_y3,
      desired_status: loan.current_balance > 0 ? 'active' : 'paid',
    })),
    ...source.loan_ledgers.Y3_current_snapshot
      .filter((loan) => loan.is_new_y3)
      .map((loan) => ({
        ...loan,
        fiscal_year: 2026,
        total_repayments: loan.repayments_y3,
        desired_status: loan.current_balance > 0 ? 'active' : 'paid',
      })),
  ];
}

function appendNote(existing, note) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}

async function syncCounter(Model, counterName, session) {
  const highest = await Model.findOne().sort({ id: -1 }).select({ id: 1 }).session(session).lean();
  await Counter.findByIdAndUpdate(
    counterName,
    { $max: { seq: highest?.id || 0 } },
    { upsert: true, returnDocument: 'after', session }
  );
}

async function nextId(counterName, session) {
  const counter = await Counter.findByIdAndUpdate(
    counterName,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session }
  );
  return counter.seq;
}

async function currentSnapshot() {
  const [members, contributions, loans, repayments, fines, transactions, expenses, investments] = await Promise.all([
    Member.find().lean(),
    Contribution.find().lean(),
    Loan.find().lean(),
    Repayment.find().lean(),
    Fine.find().lean(),
    Transaction.find().lean(),
    Expense.find().lean(),
    Investment.find().lean(),
  ]);
  return { members, contributions, loans, repayments, fines, transactions, expenses, investments };
}

async function preview(source) {
  const { canonicalName, sourceHash, runKey } = sourceContext(source);
  const snapshot = await currentSnapshot();
  const membersByCanonical = new Map(
    snapshot.members.map((member) => [canonicalName(member.name), member])
  );

  let contributionChanges = 0;
  for (const ledger of source.contribution_ledgers) {
    for (const sourceMember of ledger.members) {
      const member = membersByCanonical.get(sourceMember.member);
      for (const monthEntry of sourceMember.months) {
        const { month, year } = periodParts(monthEntry.period);
        const current = member
          ? snapshot.contributions
              .filter((item) => item.member_id === member.id && item.month === month && item.year === year)
              .reduce((sum, item) => sum + item.amount, 0)
          : 0;
        if (current !== Number(monthEntry.amount_tzs || 0)) contributionChanges += 1;
      }
    }
  }

  const sourceLoanList = desiredLoans(source);
  let missingLoans = 0;
  let changedLoans = 0;
  for (const desired of sourceLoanList) {
    const member = membersByCanonical.get(canonicalName(desired.member));
    const current = member && snapshot.loans.find((loan) => (
      loan.member_id === member.id
      && loan.issued_date === desired.issue_date
      && loan.principal === desired.principal
    ));
    if (!current) {
      missingLoans += 1;
      continue;
    }
    const totalRepaid = snapshot.repayments
      .filter((repayment) => repayment.loan_id === current.id)
      .reduce((sum, repayment) => sum + repayment.amount, 0);
    if (
      current.interest_rate !== desired.interest_rate
      || current.interest_amount !== desired.interest
      || current.fiscal_year !== desired.fiscal_year
      || current.status !== desired.desired_status
      || totalRepaid !== desired.total_repayments
    ) changedLoans += 1;
  }

  return {
    run_key: runKey,
    source_hash: sourceHash,
    already_applied: Boolean(await ReconciliationRun.exists({ run_key: runKey, status: 'applied' })),
    current: {
      members: snapshot.members.length,
      contributions: snapshot.contributions.length,
      loans: snapshot.loans.length,
      repayments: snapshot.repayments.length,
      fines: snapshot.fines.length,
    },
    proposed: {
      missing_members: source.members.filter((item) => !membersByCanonical.has(item.member)).map((item) => item.member),
      contribution_month_changes: contributionChanges,
      missing_loans: missingLoans,
      changed_loans: changedLoans,
      audit_form_records: (source.audit_form_contributions?.length || 0) + (source.audit_loan_requests?.length || 0),
      investments: source.investments?.length || 0,
    },
    blocked_from_posting: source.pending_review || [],
  };
}

router.post('/preview', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await preview(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/apply', authenticate, requireAdmin, async (req, res) => {
  const source = req.body;
  let context;
  try {
    context = sourceContext(source);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const { canonicalName, sourceHash, runKey } = context;
  const prior = await ReconciliationRun.findOne({ run_key: runKey }).lean();
  if (prior?.status === 'applied') {
    return res.json({ idempotent: true, run_key: runKey, result: prior.result });
  }
  if (prior && prior.source_hash !== sourceHash) {
    return res.status(409).json({ error: 'Run key already exists with a different source hash' });
  }

  const backup = prior?.backup || await currentSnapshot();
  await ReconciliationRun.findOneAndUpdate(
    { run_key: runKey },
    {
      $setOnInsert: {
        run_key: runKey,
        source_hash: sourceHash,
        schema_version: source.schema_version,
        source_generated_on: source.generated_on,
        reporting_cutoff: source.club.reporting_cutoff,
        backup,
        created_at: new Date(),
      },
      $set: {
        status: 'applying',
        source_summary: source.master_totals,
        flags: source.reconciliation_flags || [],
        applied_by: req.user.username,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  const result = {
    members_created: 0,
    contributions_created: 0,
    contributions_updated: 0,
    loans_created: 0,
    loans_updated: 0,
    repayment_adjustments_created: 0,
    fine_adjustments_created: 0,
    investments_upserted: 0,
    audit_records_upserted: 0,
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Promise.all([
        syncCounter(Member, 'member_id', session),
        syncCounter(Contribution, 'contribution_id', session),
        syncCounter(Loan, 'loan_id', session),
        syncCounter(Repayment, 'repayment_id', session),
        syncCounter(Fine, 'fine_id', session),
      ]);

      let members = await Member.find().session(session).lean();
      const membersByCanonical = new Map(members.map((member) => [canonicalName(member.name), member]));

      for (const sourceMember of source.members) {
        if (membersByCanonical.has(sourceMember.member)) continue;
        if (sourceMember.membership_status !== 'Former / Y1 only') {
          throw new Error(`Active member missing from production: ${sourceMember.member}`);
        }
        const firstLedgerMember = source.contribution_ledgers
          .flatMap((ledger) => ledger.members)
          .find((member) => member.member === sourceMember.member);
        const [created] = await Member.create([{
          id: await nextId('member_id', session),
          name: sourceMember.member,
          role: 'member',
          status: 'former',
          entry_fee: firstLedgerMember?.entry_fee_tzs || 100000,
          join_date: '2024-01-01',
        }], { session });
        const member = created.toObject();
        membersByCanonical.set(sourceMember.member, member);
        result.members_created += 1;
      }

      const reconciliationNote = `Reconciled from ${runKey}; originals retained in ReconciliationRun backup`;
      const allContributions = await Contribution.find().sort({ id: 1 }).session(session).lean();
      const contributionsByPeriod = new Map();
      for (const contribution of allContributions) {
        const key = `${contribution.member_id}:${contribution.year}:${contribution.month}`;
        const periodContributions = contributionsByPeriod.get(key) || [];
        periodContributions.push(contribution);
        contributionsByPeriod.set(key, periodContributions);
      }

      for (const ledger of source.contribution_ledgers) {
        for (const sourceMember of ledger.members) {
          const member = membersByCanonical.get(sourceMember.member);
          if (!member) throw new Error(`Could not match contribution member: ${sourceMember.member}`);
          for (const monthEntry of sourceMember.months) {
            const { month, year } = periodParts(monthEntry.period);
            const desiredAmount = Number(monthEntry.amount_tzs || 0);
            const existing = contributionsByPeriod.get(`${member.id}:${year}:${month}`) || [];
            const currentTotal = existing.reduce((sum, item) => sum + item.amount, 0);
            if (currentTotal === desiredAmount) continue;

            if (existing.length) {
              const otherTotal = existing.slice(1).reduce((sum, item) => sum + item.amount, 0);
              const primaryAmount = desiredAmount - otherTotal;
              if (primaryAmount < 0) {
                throw new Error(`Cannot safely reconcile duplicate contributions for ${sourceMember.member} ${monthEntry.period}`);
              }
              await Contribution.updateOne(
                { _id: existing[0]._id },
                {
                  $set: {
                    amount: primaryAmount,
                    status: desiredAmount > 0 ? 'paid' : 'reconciled_void',
                    notes: appendNote(existing[0].notes, reconciliationNote),
                  },
                },
                { session }
              );
              result.contributions_updated += 1;
            } else if (desiredAmount > 0) {
              await Contribution.create([{
                id: await nextId('contribution_id', session),
                member_id: member.id,
                amount: desiredAmount,
                month,
                year,
                status: 'paid',
                paid_date: `${year}-${String(month).padStart(2, '0')}-01`,
                mpesa_ref: `recon:${runKey}:${member.id}:${year}-${month}`,
                notes: reconciliationNote,
              }], { session });
              result.contributions_created += 1;
            }
          }
        }
      }

      const allLoans = await Loan.find().session(session).lean();
      const allRepayments = await Repayment.find().session(session).lean();
      for (const desired of desiredLoans(source)) {
        const member = membersByCanonical.get(canonicalName(desired.member));
        if (!member) throw new Error(`Could not match loan member: ${desired.member}`);
        const candidates = allLoans.filter(
          (item) => item.member_id === member.id && item.issued_date === desired.issue_date
        );
        let loan = candidates.length === 1
          ? candidates[0]
          : candidates.find((item) => item.principal === desired.principal);

        const loanValues = {
          member_id: member.id,
          loan_number: desired.loan_number,
          principal: desired.principal,
          interest_rate: desired.interest_rate,
          interest_amount: desired.interest,
          amount_deposited: desired.net_disbursed,
          issued_date: desired.issue_date,
          status: desired.desired_status,
          fiscal_year: desired.fiscal_year,
        };

        if (loan) {
          await Loan.updateOne(
            { _id: loan._id },
            { $set: { ...loanValues, notes: appendNote(loan.notes, reconciliationNote) } },
            { session }
          );
          result.loans_updated += 1;
        } else {
          const [created] = await Loan.create([{
            id: await nextId('loan_id', session),
            ...loanValues,
            due_date: null,
            notes: reconciliationNote,
          }], { session });
          loan = created.toObject();
          allLoans.push(loan);
          result.loans_created += 1;
        }

        const existingRepayments = allRepayments.filter((item) => item.loan_id === loan.id);
        const currentRepaid = existingRepayments.reduce((sum, item) => sum + item.amount, 0);
        const adjustment = desired.total_repayments - currentRepaid;
        if (adjustment !== 0) {
          const adjustmentRef = `recon:${runKey}:loan:${loan.id}`;
          const existingAdjustment = existingRepayments.find((item) => item.mpesa_ref === adjustmentRef);
          if (existingAdjustment) {
            await Repayment.updateOne(
              { _id: existingAdjustment._id },
              { $set: { amount: existingAdjustment.amount + adjustment } },
              { session }
            );
          } else {
            await Repayment.create([{
              id: await nextId('repayment_id', session),
              loan_id: loan.id,
              amount: adjustment,
              repayment_date: source.club.reporting_cutoff.Y3_loans,
              mpesa_ref: adjustmentRef,
              notes: `${reconciliationNote}; signed adjustment to source repayment total`,
            }], { session });
            result.repayment_adjustments_created += 1;
          }
        }
      }

      const allFines = await Fine.find().session(session).lean();
      for (const sourceMember of source.members) {
        const member = membersByCanonical.get(sourceMember.member);
        const memberFines = allFines.filter((fine) => fine.member_id === member.id);
        for (const [status, desiredAmount] of [
          ['paid', sourceMember.fines.all_years_paid_tzs],
          ['unpaid', sourceMember.fines.source_unpaid_fines_tzs],
        ]) {
          const currentAmount = memberFines
            .filter((fine) => fine.status === status)
            .reduce((sum, fine) => sum + fine.amount, 0);
          const adjustment = desiredAmount - currentAmount;
          if (adjustment < 0) {
            throw new Error(`Fine total exceeds source for ${sourceMember.member} (${status})`);
          }
          if (adjustment === 0) continue;
          const key = `recon:${runKey}:fine:${member.id}:${status}`;
          const existingAdjustment = memberFines.find((fine) => fine.reconciliation_key === key);
          if (existingAdjustment) {
            await Fine.updateOne({ _id: existingAdjustment._id }, { $set: { amount: adjustment } }, { session });
          } else {
            await Fine.create([{
              id: await nextId('fine_id', session),
              member_id: member.id,
              amount: adjustment,
              reason: status === 'paid' ? 'Historical paid fines reconciliation' : 'Source outstanding fines snapshot',
              year: 2026,
              status,
              paid_date: status === 'paid' ? source.club.reporting_cutoff.Y3_loans : null,
              review_required: status === 'unpaid',
              reconciliation_key: key,
              notes: status === 'unpaid'
                ? 'Source-tracked amount; member-level confirmation still required.'
                : reconciliationNote,
            }], { session });
            result.fine_adjustments_created += 1;
          }
        }
      }

      for (const investment of source.investments || []) {
        const key = `recon:${runKey}:investment:${normalizeName(investment.provider)}`;
        await Investment.updateOne(
          { reconciliation_key: key },
          {
            $set: {
              provider: investment.provider,
              amount: investment.amount_tzs,
              status: investment.status,
              verification_status: investment.verification_status,
              action_required: investment.action_required,
              source: 'Checkpoint System Reconciliation',
              updated_at: new Date(),
            },
            $setOnInsert: { reconciliation_key: key, created_at: new Date() },
          },
          { upsert: true, session }
        );
        result.investments_upserted += 1;
      }

      const auditOperations = [];
      for (const [sourceType, rows] of [
        ['google_form_contribution', source.audit_form_contributions || []],
        ['google_form_loan_request', source.audit_loan_requests || []],
      ]) {
        for (const row of rows) {
          auditOperations.push({
            updateOne: {
              filter: { reconciliation_run: runKey, source_type: sourceType, source_row: row.source_row },
              update: {
                $set: {
                  review_status: row.review_status || 'unposted',
                  posted: false,
                  payload: row,
                },
                $setOnInsert: {
                  reconciliation_run: runKey,
                  source_type: sourceType,
                  source_row: row.source_row,
                  created_at: new Date(),
                },
              },
              upsert: true,
            },
          });
        }
      }
      if (auditOperations.length) {
        await AuditSourceRecord.bulkWrite(auditOperations, { session });
        result.audit_records_upserted = auditOperations.length;
      }
    });

    await ReconciliationRun.updateOne(
      { run_key: runKey },
      { $set: { status: 'applied', result, applied_at: new Date() } }
    );
    res.json({ idempotent: false, run_key: runKey, source_hash: sourceHash, result });
  } catch (error) {
    await ReconciliationRun.updateOne(
      { run_key: runKey },
      { $set: { status: 'failed', result: { ...result, error: error.message } } }
    );
    res.status(500).json({ error: error.message, run_key: runKey, result });
  } finally {
    await session.endSession();
  }
});

router.get('/latest', authenticate, async (req, res) => {
  const run = await ReconciliationRun.findOne({ status: 'applied' })
    .sort({ applied_at: -1 })
    .select('-backup')
    .lean();
  res.json(run || null);
});

router.get('/status', authenticate, requireAdmin, async (req, res) => {
  const run = await ReconciliationRun.findOne()
    .sort({ created_at: -1 })
    .select('-backup')
    .lean();
  res.json(run || null);
});

module.exports = router;
