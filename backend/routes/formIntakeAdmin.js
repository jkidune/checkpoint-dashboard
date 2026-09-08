const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  Member,
  Transaction,
  Contribution,
  Repayment,
  Loan,
  Fine,
  getNextId,
} = require('../db/models');
const { FormIntakeSubmission } = require('../db/formIntakeModels');
const { getRulesForFY } = require('./rules');
const {
  getFiscalYear,
  isContributionLate,
  calculateOneTimeFine,
  finePeriodQuery,
} = require('../services/contributionFinePolicy');
const { sendFormIntakeAlert } = require('../utils/formIntakeAlertEmail');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_MAP = MONTH_NAMES.reduce((map, name, index) => {
  if (name) map[name.toLowerCase()] = index;
  return map;
}, {});

function normalize(value) {
  return String(value || '').trim();
}

function asDateKey(value) {
  const raw = normalize(value);
  if (!raw) return null;
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function monthKey(month, year) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(month, year) {
  return `${MONTH_NAMES[month] || month} ${year}`;
}

function periodFromMonthName(monthName, paymentDate) {
  const month = MONTH_MAP[normalize(monthName).toLowerCase()];
  if (!month) return null;
  const paid = new Date(`${paymentDate}T12:00:00Z`);
  if (Number.isNaN(paid.getTime())) return null;
  let year = paid.getUTCFullYear();
  const paymentMonth = paid.getUTCMonth() + 1;
  if (month > paymentMonth) year -= 1;
  return { month, year };
}

function monthsBetween(startDate, endDate) {
  const start = new Date(`${startDate || ''}T12:00:00Z`);
  const end = new Date(`${endDate || ''}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth());
}

async function duplicateEvidence(reference, session = null) {
  const ref = normalize(reference).toUpperCase();
  if (!ref) return [];
  const options = session ? { session } : {};
  const [transactions, contributions, repayments] = await Promise.all([
    Transaction.find({ reference: ref }, null, options).lean(),
    Contribution.find({ mpesa_ref: ref }, null, options).lean(),
    Repayment.find({ mpesa_ref: ref }, null, options).lean(),
  ]);
  return [
    ...transactions.map((item) => ({
      collection: 'transactions', id: item.id, amount: item.amount,
      type: item.type, date: item.transaction_date,
    })),
    ...contributions.map((item) => ({
      collection: 'contributions', id: item.id, amount: item.amount,
      month: item.month, year: item.year,
    })),
    ...repayments.map((item) => ({
      collection: 'repayments', id: item.id, amount: item.amount,
      loan_id: item.loan_id, date: item.repayment_date,
    })),
  ];
}

async function contributionCandidates(submission) {
  const paymentDate = asDateKey(submission.payment_date);
  if (!paymentDate || !submission.matched_member_id) return [];

  const paid = new Date(`${paymentDate}T12:00:00Z`);
  const selectedKeys = new Set();
  for (const name of submission.months || []) {
    const period = periodFromMonthName(name, paymentDate);
    if (period) selectedKeys.add(monthKey(period.month, period.year));
  }

  const periods = new Map();
  for (let offset = 17; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(
      paid.getUTCFullYear(),
      paid.getUTCMonth() - offset,
      1,
      12,
    ));
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();
    periods.set(monthKey(month, year), { month, year });
  }
  for (const key of selectedKeys) {
    const [year, month] = key.split('-').map(Number);
    periods.set(key, { month, year });
  }

  const rows = [];
  for (const { month, year } of periods.values()) {
    const fy = getFiscalYear(month, year);
    const [rules, existing, existingFine] = await Promise.all([
      getRulesForFY(fy),
      Contribution.findOne({
        member_id: submission.matched_member_id,
        month,
        year,
      }).lean(),
      Fine.findOne(finePeriodQuery(
        submission.matched_member_id,
        month,
        year,
      )).lean(),
    ]);

    const target = Number(rules.contribution_amount || 0);
    const existingAmount = Number(existing?.amount || 0);
    const due = Math.max(0, target - existingAmount);
    const late = isContributionLate(month, year, paymentDate);
    const potentialFine = late
      && !existingFine
      && rules.late_fine_enabled
      ? calculateOneTimeFine(rules, target, month, year, fy)
      : null;

    if (due > 0 || selectedKeys.has(monthKey(month, year))) {
      rows.push({
        key: monthKey(month, year),
        month,
        year,
        label: monthLabel(month, year),
        fiscal_year: fy,
        target,
        existing_amount: existingAmount,
        amount_due: due,
        selected_by_member: selectedKeys.has(monthKey(month, year)),
        existing_contribution_id: existing?.id || null,
        existing_fine_id: existingFine?.id || null,
        existing_fine_status: existingFine?.status || null,
        assessed_late_fine: potentialFine
          ? Number(potentialFine.amount || 0)
          : 0,
      });
    }
  }

  rows.sort((a, b) => a.year - b.year || a.month - b.month);
  return rows;
}

async function fineCandidates(memberId) {
  if (!memberId) return [];
  const rows = await Fine.find({
    member_id: memberId,
    status: 'unpaid',
  }).sort({ created_at: 1 }).lean();
  return rows.map((fine) => ({
    id: fine.id,
    amount: Number(fine.amount || 0),
    reason: fine.reason,
    contribution_month: fine.contribution_month,
    contribution_year: fine.contribution_year,
    period_label: fine.contribution_month && fine.contribution_year
      ? monthLabel(fine.contribution_month, fine.contribution_year)
      : null,
    created_at: fine.created_at,
  }));
}

async function loanCandidates(memberId, paymentDate) {
  if (!memberId) return [];
  const loans = await Loan.find({
    member_id: memberId,
    status: { $in: ['active', 'overdue'] },
  }).sort({ issued_date: 1 }).lean();

  const rows = [];
  for (const loan of loans) {
    const repayments = await Repayment.find({ loan_id: loan.id }).lean();
    const repaid = repayments.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    const issued = new Date(`${loan.issued_date}T12:00:00Z`);
    const fallbackFy = Number.isNaN(issued.getTime())
      ? getFiscalYear(new Date().getUTCMonth() + 1, new Date().getUTCFullYear())
      : getFiscalYear(issued.getUTCMonth() + 1, issued.getUTCFullYear());
    const fy = Number(loan.fiscal_year) || fallbackFy;
    const rules = await getRulesForFY(fy);
    const ageMonths = monthsBetween(loan.issued_date, paymentDate);
    let overduePenalty = 0;
    if (
      rules.overdue_penalty_enabled
      && rules.loan_repayment_months
      && ageMonths > Number(rules.loan_repayment_months)
    ) {
      overduePenalty = Math.round(
        Number(loan.principal || 0)
        * Number(rules.overdue_penalty_rate || 0)
        * (ageMonths - Number(rules.loan_repayment_months)),
      );
    }
    const totalDue = Number(loan.principal || 0) + overduePenalty;
    const balance = Math.max(0, totalDue - repaid);
    if (balance > 0) {
      rows.push({
        loan_id: loan.id,
        loan_number: loan.loan_number || `Loan #${loan.id}`,
        principal: Number(loan.principal || 0),
        overdue_penalty: overduePenalty,
        total_due: totalDue,
        repaid,
        balance,
        due_date: loan.due_date || null,
        status: loan.status,
      });
    }
  }
  return rows;
}

function allocationKey(item) {
  if (item.kind === 'contribution' || item.kind === 'late_fine') {
    return `${item.kind}:${Number(item.year)}-${Number(item.month)}`;
  }
  if (item.kind === 'fine') return `fine:${Number(item.fine_id)}`;
  if (item.kind === 'loan_repayment') {
    return `loan:${Number(item.loan_id)}`;
  }
  return `unknown:${JSON.stringify(item)}`;
}

function buildSuggestions(submission, contributions, fines, loans) {
  let remaining = Number(submission.amount || 0);
  const allocations = [];

  if (submission.type === 'monthly') {
    const selected = contributions.filter((row) => row.selected_by_member);
    for (const row of selected) {
      if (remaining <= 0 || row.amount_due <= 0) continue;
      const amount = Math.min(remaining, row.amount_due);
      allocations.push({
        kind: 'contribution',
        month: row.month,
        year: row.year,
        amount,
      });
      remaining -= amount;
    }

    const selectedKeys = new Set(
      selected.map((row) => monthKey(row.month, row.year)),
    );
    for (const fine of fines) {
      const key = fine.contribution_month && fine.contribution_year
        ? monthKey(fine.contribution_month, fine.contribution_year)
        : null;
      if (
        remaining > 0
        && key
        && selectedKeys.has(key)
        && remaining >= fine.amount
      ) {
        allocations.push({
          kind: 'fine',
          fine_id: fine.id,
          amount: fine.amount,
        });
        remaining -= fine.amount;
      }
    }

    for (const row of selected) {
      if (
        remaining > 0
        && row.assessed_late_fine > 0
        && remaining >= row.assessed_late_fine
      ) {
        allocations.push({
          kind: 'late_fine',
          month: row.month,
          year: row.year,
          amount: row.assessed_late_fine,
        });
        remaining -= row.assessed_late_fine;
      }
    }
  } else if (submission.type === 'fine') {
    for (const fine of fines) {
      if (remaining >= fine.amount && fine.amount > 0) {
        allocations.push({
          kind: 'fine',
          fine_id: fine.id,
          amount: fine.amount,
        });
        remaining -= fine.amount;
      }
      if (remaining <= 0) break;
    }
  } else if (submission.type === 'loan_repayment' && loans.length === 1) {
    const amount = Math.min(remaining, loans[0].balance);
    if (amount > 0) {
      allocations.push({
        kind: 'loan_repayment',
        loan_id: loans[0].loan_id,
        amount,
      });
      remaining -= amount;
    }
  }

  return { allocations, unallocated: remaining };
}

async function buildWorkbench(submission) {
  const activeMembers = await Member.find({ status: 'active' })
    .select('id name')
    .sort({ name: 1 })
    .lean();

  const duplicates = submission?.mpesa_ref
    ? await duplicateEvidence(submission.mpesa_ref)
    : [];

  if (!submission?.matched_member_id) {
    return {
      submission,
      members: activeMembers,
      contribution_candidates: [],
      fine_candidates: [],
      loan_candidates: [],
      suggested_allocations: [],
      suggested_unallocated: Number(submission?.amount || 0),
      duplicate_matches: duplicates,
    };
  }

  const [contributions, fines, loans] = await Promise.all([
    contributionCandidates(submission),
    fineCandidates(submission.matched_member_id),
    loanCandidates(
      submission.matched_member_id,
      submission.payment_date,
    ),
  ]);

  const suggestions = buildSuggestions(
    submission,
    contributions,
    fines,
    loans,
  );

  return {
    submission,
    members: activeMembers,
    contribution_candidates: contributions,
    fine_candidates: fines,
    loan_candidates: loans,
    suggested_allocations: suggestions.allocations,
    suggested_unallocated: suggestions.unallocated,
    duplicate_matches: duplicates,
  };
}

async function validateAllocationDraft(submission, draft = []) {
  const workbench = await buildWorkbench(submission);
  const errors = [];
  const warnings = [];
  const normalized = [];

  if (!submission) errors.push('Submission not found.');
  if (!submission?.matched_member_id) {
    errors.push('Choose the correct member before posting.');
  }
  if (!normalize(submission?.mpesa_ref)) {
    errors.push('Enter the payment reference before posting.');
  }
  if (submission?.posted || submission?.posting_status === 'posted') {
    errors.push('This submission has already been posted.');
  }
  if (workbench.duplicate_matches.length) {
    errors.push(
      'This payment reference already exists in the ledger. '
      + 'Resolve the duplicate before posting.',
    );
  }

  const allocations = Array.isArray(draft) ? draft : [];
  if (!allocations.length) {
    errors.push('Add at least one allocation before posting.');
  }

  const contributionMap = new Map(
    workbench.contribution_candidates.map((row) => [
      monthKey(row.month, row.year),
      row,
    ]),
  );
  const fineMap = new Map(
    workbench.fine_candidates.map((row) => [Number(row.id), row]),
  );
  const loanMap = new Map(
    workbench.loan_candidates.map((row) => [
      Number(row.loan_id),
      row,
    ]),
  );

  const seen = new Set();
  let total = 0;

  for (const raw of allocations) {
    const kind = normalize(raw.kind);
    const amount = Number(raw.amount);
    const item = { kind, amount };
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push('Every allocation must have a positive amount.');
      continue;
    }

    if (kind === 'contribution' || kind === 'late_fine') {
      item.month = Number(raw.month);
      item.year = Number(raw.year);
    } else if (kind === 'fine') {
      item.fine_id = Number(raw.fine_id);
    } else if (kind === 'loan_repayment') {
      item.loan_id = Number(raw.loan_id);
    } else {
      errors.push(`Unsupported allocation type: ${kind || 'blank'}.`);
      continue;
    }

    const key = allocationKey(item);
    if (seen.has(key)) {
      errors.push(`Duplicate allocation target: ${key}.`);
      continue;
    }
    seen.add(key);

    if (kind === 'contribution') {
      const candidate = contributionMap.get(
        monthKey(item.month, item.year),
      );
      if (!candidate) {
        errors.push(
          `Contribution period ${monthLabel(item.month, item.year)} `
          + 'is not available for this payment.',
        );
        continue;
      }
      if (amount > candidate.amount_due) {
        errors.push(
          `${monthLabel(item.month, item.year)} has only `
          + `TZS ${candidate.amount_due.toLocaleString('en-US')} outstanding.`,
        );
        continue;
      }
      normalized.push({
        ...item,
        label: `Contribution · ${candidate.label}`,
        max_amount: candidate.amount_due,
        existing_contribution_id: candidate.existing_contribution_id,
      });
    }

    if (kind === 'fine') {
      const candidate = fineMap.get(item.fine_id);
      if (!candidate) {
        errors.push(`Fine #${item.fine_id} is not unpaid anymore.`);
        continue;
      }
      if (amount !== candidate.amount) {
        errors.push(
          `Fine #${item.fine_id} must be settled in full at `
          + `TZS ${candidate.amount.toLocaleString('en-US')}.`,
        );
        continue;
      }
      normalized.push({
        ...item,
        label: `Fine #${candidate.id} · ${candidate.reason}`,
        max_amount: candidate.amount,
      });
    }

    if (kind === 'late_fine') {
      const candidate = contributionMap.get(
        monthKey(item.month, item.year),
      );
      if (!candidate || candidate.assessed_late_fine <= 0) {
        errors.push(
          `There is no unrecorded late fine for `
          + `${monthLabel(item.month, item.year)}.`,
        );
        continue;
      }
      if (amount !== candidate.assessed_late_fine) {
        errors.push(
          `The assessed late fine for ${candidate.label} is `
          + `TZS ${candidate.assessed_late_fine.toLocaleString('en-US')} `
          + 'and must be allocated in full.',
        );
        continue;
      }
      normalized.push({
        ...item,
        label: `Late fine · ${candidate.label}`,
        max_amount: candidate.assessed_late_fine,
      });
    }

    if (kind === 'loan_repayment') {
      const candidate = loanMap.get(item.loan_id);
      if (!candidate) {
        errors.push(`Loan #${item.loan_id} is not currently outstanding.`);
        continue;
      }
      if (amount > candidate.balance) {
        errors.push(
          `${candidate.loan_number} has only `
          + `TZS ${candidate.balance.toLocaleString('en-US')} outstanding.`,
        );
        continue;
      }
      normalized.push({
        ...item,
        label: `Loan repayment · ${candidate.loan_number}`,
        max_amount: candidate.balance,
        balance_before: candidate.balance,
        balance_after: candidate.balance - amount,
      });
    }

    total += amount;
  }

  const received = Number(submission?.amount || 0);
  const difference = received - total;
  if (Math.abs(difference) > 0.001) {
    errors.push(
      difference > 0
        ? `TZS ${difference.toLocaleString('en-US')} is still unallocated.`
        : `Allocations exceed the received amount by TZS `
          + `${Math.abs(difference).toLocaleString('en-US')}.`,
    );
  }

  const claimedType = submission?.type;
  const actualKinds = new Set(normalized.map((item) => item.kind));
  if (
    claimedType === 'monthly'
    && [...actualKinds].some((kind) => kind !== 'contribution')
  ) {
    warnings.push(
      'The member selected monthly contribution, but this receipt is being '
      + 'split across more than one ledger category.',
    );
  }
  if (
    claimedType === 'loan_repayment'
    && [...actualKinds].some((kind) => kind !== 'loan_repayment')
  ) {
    warnings.push(
      'The admin allocation differs from the member’s loan-repayment claim.',
    );
  }
  if (
    claimedType === 'fine'
    && [...actualKinds].some(
      (kind) => !['fine', 'late_fine'].includes(kind),
    )
  ) {
    warnings.push(
      'The admin allocation differs from the member’s fine-payment claim.',
    );
  }

  return {
    valid: errors.length === 0,
    amount_received: received,
    amount_allocated: total,
    remaining: difference,
    allocations: normalized,
    blocking_errors: errors,
    warnings,
    duplicate_matches: workbench.duplicate_matches,
    workbench,
  };
}

async function postValidatedAllocation(
  submission,
  preview,
  req,
) {
  const session = await mongoose.startSession();
  const actor = req.user.name || req.user.username || 'admin';
  const reference = normalize(submission.mpesa_ref).toUpperCase();
  const paymentDate = submission.payment_date;
  let result = null;

  try {
    await session.withTransaction(async () => {
      const fresh = await FormIntakeSubmission.findById(
        submission._id,
        null,
        { session },
      ).lean();
      if (!fresh) throw new Error('Submission not found.');
      if (fresh.posted) {
        result = fresh.posting_result || null;
        return;
      }

      const duplicates = await duplicateEvidence(reference, session);
      if (duplicates.length) {
        throw new Error(
          'This payment reference was posted elsewhere before confirmation '
          + 'completed. Posting stopped.',
        );
      }

      const memberId = fresh.matched_member_id;
      const noteBase = fresh.notes
        ? `${fresh.notes} | Form intake ${fresh.source_id}`
        : `Form intake ${fresh.source_id}`;

      const created = {
        contributions: [],
        repayments: [],
        fines_paid: [],
        fines_created: [],
        transactions: [],
      };

      const lateFineByPeriod = new Map(
        preview.allocations
          .filter((item) => item.kind === 'late_fine')
          .map((item) => [
            monthKey(item.month, item.year),
            item,
          ]),
      );

      const contributionItems = preview.allocations.filter(
        (item) => item.kind === 'contribution',
      );

      for (const item of contributionItems) {
        const fy = getFiscalYear(item.month, item.year);
        const rules = await getRulesForFY(fy);
        const existing = await Contribution.findOne({
          member_id: memberId,
          month: item.month,
          year: item.year,
        }, null, { session });

        const target = Number(rules.contribution_amount || 0);
        const before = Number(existing?.amount || 0);
        const after = before + Number(item.amount || 0);
        if (after > target + 0.001) {
          throw new Error(
            `${monthLabel(item.month, item.year)} changed while you were `
            + 'reviewing it. Refresh the workbench.',
          );
        }

        let contribution;
        if (existing) {
          contribution = await Contribution.findOneAndUpdate(
            { id: existing.id },
            {
              $set: {
                amount: after,
                status: after >= target ? 'paid' : 'partial',
                paid_date: paymentDate,
                mpesa_ref: reference,
                notes: noteBase,
              },
            },
            { new: true, session },
          );
        } else {
          [contribution] = await Contribution.create([{
            id: await getNextId('contribution_id'),
            member_id: memberId,
            amount: Number(item.amount),
            month: item.month,
            year: item.year,
            status: Number(item.amount) >= target ? 'paid' : 'partial',
            paid_date: paymentDate,
            mpesa_ref: reference,
            notes: noteBase,
          }], { session });
        }

        created.contributions.push({
          id: contribution.id,
          month: item.month,
          year: item.year,
          amount_applied: Number(item.amount),
          amount_after: Number(contribution.amount),
          status: contribution.status,
        });

        const currentFine = await Fine.findOne(
          finePeriodQuery(memberId, item.month, item.year),
          null,
          { session },
        );

        if (
          !currentFine
          && rules.late_fine_enabled
          && isContributionLate(
            item.month,
            item.year,
            paymentDate,
          )
        ) {
          const assessment = calculateOneTimeFine(
            rules,
            target,
            item.month,
            item.year,
            fy,
          );
          const payingNow = lateFineByPeriod.get(
            monthKey(item.month, item.year),
          );
          const [fine] = await Fine.create([{
            id: await getNextId('fine_id'),
            member_id: memberId,
            amount: Number(assessment.amount || 0),
            reason: assessment.reason,
            year: fy,
            contribution_month: item.month,
            contribution_year: item.year,
            status: payingNow ? 'paid' : 'unpaid',
            paid_date: payingNow ? paymentDate : null,
            notes: payingNow
              ? `${noteBase} | Assessed and paid in same receipt`
              : `${noteBase} | Auto-assessed from late contribution`,
          }], { session });
          created.fines_created.push({
            id: fine.id,
            amount: fine.amount,
            month: item.month,
            year: item.year,
            status: fine.status,
          });
          if (payingNow) {
            created.fines_paid.push({
              id: fine.id,
              amount: fine.amount,
              reason: fine.reason,
            });
          }
        }
      }

      const existingFineItems = preview.allocations.filter(
        (item) => item.kind === 'fine',
      );
      for (const item of existingFineItems) {
        const fine = await Fine.findOneAndUpdate(
          {
            id: item.fine_id,
            member_id: memberId,
            status: 'unpaid',
          },
          {
            $set: {
              status: 'paid',
              paid_date: paymentDate,
              notes: noteBase,
            },
          },
          { new: true, session },
        );
        if (!fine) {
          throw new Error(
            `Fine #${item.fine_id} is no longer unpaid. Refresh the workbench.`,
          );
        }
        created.fines_paid.push({
          id: fine.id,
          amount: fine.amount,
          reason: fine.reason,
        });
      }

      const loanItems = preview.allocations.filter(
        (item) => item.kind === 'loan_repayment',
      );
      for (const item of loanItems) {
        const loan = await Loan.findOne({
          id: item.loan_id,
          member_id: memberId,
          status: { $in: ['active', 'overdue'] },
        }, null, { session });
        if (!loan) {
          throw new Error(
            `Loan #${item.loan_id} is no longer outstanding. Refresh the workbench.`,
          );
        }
        const [repayment] = await Repayment.create([{
          id: await getNextId('repayment_id'),
          loan_id: loan.id,
          amount: Number(item.amount),
          repayment_date: paymentDate,
          mpesa_ref: reference,
          notes: noteBase,
        }], { session });
        created.repayments.push({
          id: repayment.id,
          loan_id: loan.id,
          amount: repayment.amount,
        });

        const allRepayments = await Repayment.find(
          { loan_id: loan.id },
          null,
          { session },
        ).lean();
        const totalPaid = allRepayments.reduce(
          (sum, row) => sum + Number(row.amount || 0),
          0,
        );
        const fy = Number(loan.fiscal_year) || getFiscalYear(
          new Date(`${loan.issued_date}T12:00:00Z`).getUTCMonth() + 1,
          new Date(`${loan.issued_date}T12:00:00Z`).getUTCFullYear(),
        );
        const rules = await getRulesForFY(fy);
        const ageMonths = monthsBetween(loan.issued_date, paymentDate);
        const overduePenalty = rules.overdue_penalty_enabled
          && rules.loan_repayment_months
          && ageMonths > Number(rules.loan_repayment_months)
          ? Math.round(
            Number(loan.principal || 0)
            * Number(rules.overdue_penalty_rate || 0)
            * (ageMonths - Number(rules.loan_repayment_months)),
          )
          : 0;
        const totalDue = Number(loan.principal || 0) + overduePenalty;
        if (totalPaid >= totalDue - 0.001) {
          await Loan.updateOne(
            { id: loan.id },
            { $set: { status: 'repaid' } },
            { session },
          );
        }
      }

      const contributionTotal = contributionItems.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      );
      if (contributionTotal > 0) {
        const labels = contributionItems
          .map((item) => monthLabel(item.month, item.year))
          .join(', ');
        const [transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: contributionTotal,
          type: 'contribution',
          description: `Form receipt allocation — contributions: ${labels}`,
          reference,
          transaction_date: paymentDate,
        }], { session });
        created.transactions.push({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
        });
      }

      for (const item of loanItems) {
        const [transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: Number(item.amount),
          type: 'loan_repayment',
          description: `Form receipt allocation — loan #${item.loan_id}`,
          reference,
          transaction_date: paymentDate,
        }], { session });
        created.transactions.push({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
        });
      }

      const fineTotal = preview.allocations
        .filter((item) => ['fine', 'late_fine'].includes(item.kind))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (fineTotal > 0) {
        const [transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: fineTotal,
          type: 'fine_payment',
          description: 'Form receipt allocation — fines',
          reference,
          transaction_date: paymentDate,
        }], { session });
        created.transactions.push({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
        });
      }

      const postedTotal = created.transactions.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      );
      if (Math.abs(postedTotal - Number(fresh.amount || 0)) > 0.001) {
        throw new Error(
          'Internal reconciliation check failed: ledger transactions do not '
          + 'equal the cash received.',
        );
      }

      result = {
        intake_id: String(fresh._id),
        source_id: fresh.source_id,
        member_id: memberId,
        member_claim: {
          type: fresh.type,
          months: fresh.months,
          notes: fresh.notes,
        },
        amount: Number(fresh.amount),
        reference,
        payment_date: paymentDate,
        posted_by: actor,
        allocations: preview.allocations,
        records: created,
      };

      await FormIntakeSubmission.updateOne(
        { _id: fresh._id },
        {
          $set: {
            review_status: 'posted',
            posting_status: 'posted',
            posted: true,
            posted_by: actor,
            posted_at: new Date(),
            allocation_snapshot: preview,
            posting_result: result,
            posting_error: null,
          },
        },
        { session },
      );
    });

    return result;
  } finally {
    await session.endSession();
  }
}

router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    res.on('finish', () => {
      if (res.statusCode === 201) {
        sendFormIntakeAlert(req.body || {}).catch((error) => {
          console.error('[form-intake-alert-email]', error.message);
        });
      }
    });
  }
  next();
});

router.get('/alerts', authenticate, requireAdmin, async (req, res) => {
  const rows = await FormIntakeSubmission.find({
    posted: false,
    review_status: { $nin: ['rejected', 'posted'] },
  }).sort({ created_at: -1 }).limit(20).lean();

  res.json({
    count: rows.length,
    items: rows.map((row) => ({
      id: String(row._id),
      title: 'Payment awaiting review',
      member_name: row.member_name,
      amount: Number(row.amount || 0),
      type: row.type,
      review_status: row.review_status,
      created_at: row.created_at,
      route: '/form-intake',
    })),
  });
});

router.get('/:id/workbench', authenticate, requireAdmin, async (req, res) => {
  const submission = await FormIntakeSubmission.findById(req.params.id).lean();
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }
  const workbench = await buildWorkbench(submission);
  res.json(workbench);
});

router.patch('/:id/correct', authenticate, requireAdmin, async (req, res) => {
  const current = await FormIntakeSubmission.findById(req.params.id).lean();
  if (!current) {
    return res.status(404).json({ error: 'Submission not found' });
  }
  if (current.posted || current.posting_status === 'posted') {
    return res.status(409).json({
      error: 'Posted submissions cannot be edited.',
    });
  }

  const set = {};
  const changes = {};
  const body = req.body || {};

  if (body.member_id != null && body.member_id !== '') {
    const memberId = Number(body.member_id);
    const member = await Member.findOne({ id: memberId }).lean();
    if (!member) {
      return res.status(400).json({ error: 'Selected member was not found.' });
    }
    if (current.matched_member_id !== memberId) {
      changes.member_id = {
        from: current.matched_member_id,
        to: memberId,
      };
    }
    set.matched_member_id = memberId;
    set.match_status = 'matched';
  }

  if (body.mpesa_ref != null) {
    const ref = normalize(body.mpesa_ref).toUpperCase() || null;
    if (normalize(current.mpesa_ref).toUpperCase() !== (ref || '')) {
      changes.mpesa_ref = { from: current.mpesa_ref, to: ref };
    }
    set.mpesa_ref = ref;
    const duplicates = ref ? await duplicateEvidence(ref) : [];
    set.duplicate_reference = duplicates.length > 0;
    set.duplicate_matches = duplicates;
  }

  if (body.amount != null && body.amount !== '') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive.' });
    }
    if (Number(current.amount) !== amount) {
      changes.amount = { from: current.amount, to: amount };
    }
    set.amount = amount;
  }

  if (body.payment_date != null) {
    const paymentDate = asDateKey(body.payment_date);
    if (!paymentDate) {
      return res.status(400).json({ error: 'Payment date is invalid.' });
    }
    if (current.payment_date !== paymentDate) {
      changes.payment_date = {
        from: current.payment_date,
        to: paymentDate,
      };
    }
    set.payment_date = paymentDate;
  }

  if (body.type != null) {
    const type = normalize(body.type);
    if (!['monthly', 'loan_repayment', 'fine'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported contribution type.' });
    }
    if (current.type !== type) {
      changes.type = { from: current.type, to: type };
    }
    set.type = type;
  }

  if (Array.isArray(body.months)) {
    const months = body.months.map(normalize).filter(Boolean);
    if (JSON.stringify(current.months || []) !== JSON.stringify(months)) {
      changes.months = { from: current.months || [], to: months };
    }
    set.months = months;
  }

  if (body.notes != null) {
    const notes = normalize(body.notes) || null;
    if ((current.notes || null) !== notes) {
      changes.notes = { from: current.notes || null, to: notes };
    }
    set.notes = notes;
  }

  if (Object.keys(changes).length) {
    set.review_status = 'pending';
    set.posting_status = 'unposted';
    set.posting_error = null;
  }

  const update = { $set: set };
  if (Object.keys(changes).length) {
    update.$push = {
      correction_history: {
        at: new Date(),
        by: req.user.name || req.user.username || 'admin',
        changes,
        reason: normalize(body.reason) || 'Admin verification correction',
      },
    };
  }

  const updated = await FormIntakeSubmission.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true },
  ).lean();
  res.json(updated);
});

router.post(
  '/:id/allocation-preview',
  authenticate,
  requireAdmin,
  async (req, res) => {
    const submission = await FormIntakeSubmission.findById(req.params.id).lean();
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    const preview = await validateAllocationDraft(
      submission,
      req.body?.allocations,
    );
    res.json(preview);
  },
);

router.post(
  '/:id/allocation-post',
  authenticate,
  requireAdmin,
  async (req, res) => {
    const submission = await FormIntakeSubmission.findById(req.params.id).lean();
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    if (submission.posted || submission.posting_status === 'posted') {
      return res.json({
        success: true,
        already_posted: true,
        result: submission.posting_result,
      });
    }

    const preview = await validateAllocationDraft(
      submission,
      req.body?.allocations,
    );
    if (!preview.valid) {
      await FormIntakeSubmission.findByIdAndUpdate(
        submission._id,
        {
          $set: {
            review_status: 'needs_review',
            allocation_snapshot: preview,
            posting_error: preview.blocking_errors.join(' '),
          },
        },
      );
      return res.status(409).json({
        error: 'The payment does not reconcile yet.',
        preview,
      });
    }

    const claimed = await FormIntakeSubmission.findOneAndUpdate(
      {
        _id: submission._id,
        posted: false,
        posting_status: { $ne: 'posting' },
      },
      {
        $set: {
          posting_status: 'posting',
          review_status: 'accepted',
          allocation_snapshot: preview,
          posting_error: null,
          reviewed_by: req.user.name || req.user.username || 'admin',
          reviewed_at: new Date(),
        },
      },
      { new: true },
    ).lean();

    if (!claimed) {
      return res.status(409).json({
        error: 'This submission is already being posted. Refresh and try again.',
      });
    }

    try {
      const result = await postValidatedAllocation(claimed, preview, req);
      res.json({ success: true, posted: true, result });
    } catch (error) {
      console.error('[forms/intake/allocation-post]', error);
      await FormIntakeSubmission.findByIdAndUpdate(
        submission._id,
        {
          $set: {
            posting_status: 'failed',
            review_status: 'needs_review',
            posting_error: error.message,
          },
        },
      );
      res.status(409).json({
        error: error.message || 'Failed to post payment allocation.',
      });
    }
  },
);

module.exports = router;
