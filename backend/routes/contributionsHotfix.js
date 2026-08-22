const express = require('express');
const router = express.Router();
const {
  Contribution,
  Member,
  Transaction,
  Fine,
  Loan,
  Repayment,
  getNextId,
} = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRulesForFY } = require('./rules');
const {
  getFiscalYear,
  isContributionLate,
  calculateOneTimeFine,
  fineMatchesContributionPeriod,
  finePeriodQuery,
} = require('../services/contributionFinePolicy');

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

function calendarYearForFYMonth(month, fy) {
  return month >= 3 ? fy : fy + 1;
}

function periodIsOnOrBefore(month, year, date) {
  const currentYear = date.getUTCFullYear();
  const currentMonth = date.getUTCMonth() + 1;
  return year < currentYear || (year === currentYear && month <= currentMonth);
}

async function getExistingFine(memberId, month, year) {
  return Fine.findOne(finePeriodQuery(memberId, month, year)).lean();
}

// GET /api/contributions/fine-preview
// Percentage fines are ONE assessment per contribution month. They never grow
// again merely because another calendar month passes.
router.get('/fine-preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const { amount, month, year, paid_date, member_id } = req.query;
    if (!month || !year || !paid_date) return res.json({ penalty: 0, reason: null });

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const fy = getFiscalYear(m, y);
    const rules = await getRulesForFY(fy);

    if (!rules.late_fine_enabled || !isContributionLate(m, y, paid_date)) {
      return res.json({ penalty: 0, reason: null });
    }

    if (member_id) {
      const existingFine = await getExistingFine(parseInt(member_id, 10), m, y);
      if (existingFine) {
        return res.json({
          penalty: 0,
          reason: null,
          already_assessed: true,
          existing_fine_id: existingFine.id,
        });
      }
    }

    // A percentage fine is based on the configured monthly obligation, not on
    // how many months have elapsed and not on a smaller partial payment amount.
    const target = Number(rules.contribution_amount || amount || 0);
    const fine = calculateOneTimeFine(rules, target, m, y, fy);
    if (!fine) return res.json({ penalty: 0, reason: null });

    return res.json({
      penalty: fine.amount,
      rate: rules.late_fine_rate,
      fine_type: fine.fine_type,
      reason: fine.reason,
      one_time: true,
    });
  } catch (err) {
    console.error('fine-preview hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contributions
// Overrides the legacy create route so a period that was already fined cannot
// receive a duplicate fine when its contribution is eventually recorded.
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { member_id, amount, month, year, status, paid_date, mpesa_ref, notes } = req.body;
    if (!member_id || !amount || !month || !year) {
      return res.status(400).json({ error: 'member_id, amount, month, year required' });
    }

    const memberId = parseInt(member_id, 10);
    const mMonth = parseInt(month, 10);
    const mYear = parseInt(year, 10);
    const mAmount = parseInt(amount, 10);
    const pDate = paid_date || new Date().toISOString().split('T')[0];
    const fy = getFiscalYear(mMonth, mYear);

    const exists = await Contribution.findOne({ member_id: memberId, month: mMonth, year: mYear }).lean();
    if (exists) return res.status(409).json({ error: 'Contribution already recorded for this month/year' });

    const rules = await getRulesForFY(fy);
    let fine = null;

    if (rules.late_fine_enabled && (status || 'paid') === 'paid' && isContributionLate(mMonth, mYear, pDate)) {
      const existingFine = await getExistingFine(memberId, mMonth, mYear);
      if (!existingFine) {
        const target = Number(rules.contribution_amount || mAmount);
        const fineCalc = calculateOneTimeFine(rules, target, mMonth, mYear, fy);
        if (fineCalc) {
          fine = await Fine.create({
            id: await getNextId('fine_id'),
            member_id: memberId,
            amount: fineCalc.amount,
            reason: fineCalc.reason,
            year: fy,
            contribution_month: mMonth,
            contribution_year: mYear,
            status: 'unpaid',
          });
        }
      }
    }

    const contribution = await Contribution.create({
      id: await getNextId('contribution_id'),
      member_id: memberId,
      amount: mAmount,
      month: mMonth,
      year: mYear,
      status: status || 'paid',
      paid_date: pDate,
      mpesa_ref: mpesa_ref || null,
      notes: notes || null,
    });

    const member = await Member.findOne({ id: memberId }).lean();
    await Transaction.create({
      id: await getNextId('transaction_id'),
      member_id: memberId,
      amount: mAmount,
      type: 'contribution',
      description: `Monthly contribution — ${member ? member.name : ''} (FY${fy})`,
      reference: mpesa_ref || null,
      transaction_date: pDate,
    });

    res.status(201).json({ ...contribution.toObject(), fiscal_year: fy, fine_created: fine || null });
  } catch (err) {
    console.error('contribution create hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function computeBulkAllocation(memberId, totalAmount, paidDate) {
  const existingContribs = await Contribution.find({ member_id: memberId }).lean();
  const memberFines = await Fine.find({ member_id: memberId }).lean();
  const unpaidFines = memberFines
    .filter((fine) => fine.status === 'unpaid')
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const paidAt = new Date(`${paidDate}T12:00:00Z`);
  const currentFY = getFiscalYear(paidAt.getUTCMonth() + 1, paidAt.getUTCFullYear());
  const firstFY = Math.min(2025, currentFY);
  const outstandingPeriods = [];

  for (let fy = firstFY; fy <= currentFY; fy += 1) {
    const rules = await getRulesForFY(fy);
    const target = Number(rules.contribution_amount || 75000);

    for (const month of FY_MONTHS) {
      const year = calendarYearForFYMonth(month, fy);
      if (!periodIsOnOrBefore(month, year, paidAt)) continue;

      const existing = existingContribs.find(
        (contribution) => contribution.month === month && contribution.year === year,
      );
      const alreadyPaid = Number(existing?.amount || 0);
      const amountDue = Math.max(0, target - alreadyPaid);
      if (amountDue <= 0) continue;

      outstandingPeriods.push({
        month,
        year,
        fy,
        target,
        amount_due: amountDue,
        existing_contribution_id: existing?.id || null,
        existing_amount: alreadyPaid,
        existing_status: existing?.status || null,
        rules,
      });
    }
  }

  outstandingPeriods.sort((a, b) => a.year - b.year || a.month - b.month);

  const activeLoans = await Loan.find({ member_id: memberId, status: 'active' }).sort({ issued_date: 1 }).lean();
  let activeLoanInfo = null;
  if (activeLoans.length > 0) {
    const loan = activeLoans[0];
    const repayments = await Repayment.find({ loan_id: loan.id }).lean();
    const totalRepaid = repayments.reduce((sum, repayment) => sum + repayment.amount, 0);
    const outstanding = Math.max(0, loan.principal - totalRepaid);
    if (outstanding > 0) {
      activeLoanInfo = { loan_id: loan.id, loan_number: loan.loan_number, outstanding };
    }
  }

  let remaining = totalAmount;
  const contributions = [];
  const finesGenerated = [];
  const finesPaid = [];
  let loanRepayment = null;
  let partialContribution = null;

  // Contributions are allocated oldest first.
  for (const period of outstandingPeriods) {
    if (remaining < period.amount_due) break;
    remaining -= period.amount_due;

    const alreadyFined = memberFines.some((fine) =>
      fineMatchesContributionPeriod(fine, period.month, period.year),
    );
    let fine = null;
    if (!alreadyFined && isContributionLate(period.month, period.year, paidDate)) {
      const fineCalc = calculateOneTimeFine(
        period.rules,
        period.target,
        period.month,
        period.year,
        period.fy,
      );
      if (fineCalc) {
        fine = { ...fineCalc, month: period.month, year: period.year, fy: period.fy };
        finesGenerated.push(fine);
      }
    }

    contributions.push({ ...period, amount: period.amount_due, fine });
  }

  // New and existing fines are obligations, but only mark a fine paid when the
  // payment contains enough money to settle that fine in full. The schema has
  // no partial-fine-balance field, so silently marking a partial fine paid would
  // corrupt the ledger.
  const fineQueue = [
    ...finesGenerated.map((fine) => ({ ...fine, _isNew: true })),
    ...unpaidFines.map((fine) => ({ ...fine, _isNew: false })),
  ];

  let blockedByPartialFine = false;
  for (const fine of fineQueue) {
    if (remaining <= 0) break;
    if (remaining < fine.amount) {
      blockedByPartialFine = true;
      break;
    }
    remaining -= fine.amount;
    finesPaid.push({
      fine_id: fine._isNew ? null : fine.id,
      amount_applied: fine.amount,
      reason: fine.reason,
      month: fine.month || fine.contribution_month || null,
      year: fine.year || fine.contribution_year || null,
      _isNew: fine._isNew,
    });
  }

  if (!blockedByPartialFine && remaining > 0 && activeLoanInfo) {
    const amount = Math.min(remaining, activeLoanInfo.outstanding);
    remaining -= amount;
    loanRepayment = {
      loan_id: activeLoanInfo.loan_id,
      loan_number: activeLoanInfo.loan_number,
      amount,
      outstanding_before: activeLoanInfo.outstanding,
      outstanding_after: activeLoanInfo.outstanding - amount,
    };
  }

  const nextPeriod = outstandingPeriods[contributions.length];
  if (!blockedByPartialFine && remaining > 0 && !activeLoanInfo && nextPeriod) {
    const amount = Math.min(remaining, nextPeriod.amount_due);
    remaining -= amount;
    partialContribution = { ...nextPeriod, amount };
  }

  const member = await Member.findOne({ id: memberId }).lean();
  return {
    member_id: memberId,
    member_name: member?.name || '?',
    total_amount: totalAmount,
    paid_date: paidDate,
    contributions,
    fines_generated: finesGenerated,
    fines_paid: finesPaid,
    loan_repayment: loanRepayment,
    partial_contribution: partialContribution,
    unallocated_remainder: remaining,
    blocked_by_partial_fine: blockedByPartialFine,
    summary: {
      months_covered: contributions.length,
      contribution_total: contributions.reduce((sum, item) => sum + item.amount, 0),
      fines_total: finesGenerated.reduce((sum, fine) => sum + fine.amount, 0),
      fines_paid_total: finesPaid.reduce((sum, fine) => sum + fine.amount_applied, 0),
      loan_repayment_total: loanRepayment?.amount || 0,
      partial_total: partialContribution?.amount || 0,
      existing_unpaid_fines: unpaidFines.reduce((sum, fine) => sum + fine.amount, 0),
      active_loan_outstanding: activeLoanInfo?.outstanding || 0,
    },
  };
}

router.get('/bulk-payment-preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const { member_id, total_amount, paid_date } = req.query;
    if (!member_id || !total_amount) {
      return res.status(400).json({ error: 'member_id and total_amount required' });
    }
    const allocation = await computeBulkAllocation(
      parseInt(member_id, 10),
      parseInt(total_amount, 10),
      paid_date || new Date().toISOString().split('T')[0],
    );
    res.json(allocation);
  } catch (err) {
    console.error('bulk-payment-preview hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-payment', authenticate, requireAdmin, async (req, res) => {
  try {
    const { member_id, total_amount, paid_date, mpesa_ref, notes } = req.body;
    if (!member_id || !total_amount) {
      return res.status(400).json({ error: 'member_id and total_amount required' });
    }

    const memberId = parseInt(member_id, 10);
    const totalAmount = parseInt(total_amount, 10);
    const pDate = paid_date || new Date().toISOString().split('T')[0];
    const allocation = await computeBulkAllocation(memberId, totalAmount, pDate);
    const member = await Member.findOne({ id: memberId }).lean();
    const memberName = member?.name || '?';
    const createdFineIds = new Map();
    const created = {
      contributions: [],
      fines_generated: [],
      fines_paid: [],
      loan_repayment: null,
      partial_contribution: null,
    };

    for (const item of allocation.contributions) {
      let contribution;
      if (item.existing_contribution_id) {
        contribution = await Contribution.findOneAndUpdate(
          { id: item.existing_contribution_id },
          {
            $set: {
              amount: item.existing_amount + item.amount,
              status: item.existing_amount + item.amount >= item.target ? 'paid' : 'partial',
              paid_date: pDate,
              mpesa_ref: mpesa_ref || null,
              notes: notes ? `${notes} (bulk payment)` : 'Bulk payment',
            },
          },
          { returnDocument: 'after' },
        );
      } else {
        contribution = await Contribution.create({
          id: await getNextId('contribution_id'),
          member_id: memberId,
          amount: item.amount,
          month: item.month,
          year: item.year,
          status: item.amount >= item.target ? 'paid' : 'partial',
          paid_date: pDate,
          mpesa_ref: mpesa_ref || null,
          notes: notes ? `${notes} (bulk payment)` : 'Bulk payment',
        });
      }
      created.contributions.push(contribution);

      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: memberId,
        amount: item.amount,
        type: 'contribution',
        description: `Monthly contribution — ${memberName} (${item.month}/${item.year}, FY${item.fy}) [bulk]`,
        reference: mpesa_ref || null,
        transaction_date: pDate,
      });

      if (item.fine) {
        const existingFine = await getExistingFine(memberId, item.month, item.year);
        if (!existingFine) {
          const fine = await Fine.create({
            id: await getNextId('fine_id'),
            member_id: memberId,
            amount: item.fine.amount,
            reason: item.fine.reason,
            year: item.fy,
            contribution_month: item.month,
            contribution_year: item.year,
            status: 'unpaid',
          });
          created.fines_generated.push(fine);
          createdFineIds.set(`${item.month}-${item.year}`, fine.id);
        } else {
          createdFineIds.set(`${item.month}-${item.year}`, existingFine.id);
        }
      }
    }

    if (allocation.partial_contribution) {
      const item = allocation.partial_contribution;
      let contribution;
      if (item.existing_contribution_id) {
        contribution = await Contribution.findOneAndUpdate(
          { id: item.existing_contribution_id },
          {
            $set: {
              amount: item.existing_amount + item.amount,
              status: 'partial',
              paid_date: pDate,
              mpesa_ref: mpesa_ref || null,
              notes: notes ? `${notes} (partial bulk payment)` : 'Partial bulk payment',
            },
          },
          { returnDocument: 'after' },
        );
      } else {
        contribution = await Contribution.create({
          id: await getNextId('contribution_id'),
          member_id: memberId,
          amount: item.amount,
          month: item.month,
          year: item.year,
          status: 'partial',
          paid_date: pDate,
          mpesa_ref: mpesa_ref || null,
          notes: notes ? `${notes} (partial bulk payment)` : 'Partial bulk payment',
        });
      }
      created.partial_contribution = contribution;
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: memberId,
        amount: item.amount,
        type: 'contribution',
        description: `Partial contribution — ${memberName} (${item.month}/${item.year}, FY${item.fy}) [bulk]`,
        reference: mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    for (const payment of allocation.fines_paid) {
      let fineId = payment.fine_id;
      if (!fineId && payment._isNew && payment.month && payment.year) {
        fineId = createdFineIds.get(`${payment.month}-${payment.year}`);
      }
      if (!fineId && payment.month && payment.year) {
        const existing = await getExistingFine(memberId, payment.month, payment.year);
        fineId = existing?.id || null;
      }
      if (!fineId) throw new Error(`Unable to resolve fine record: ${payment.reason || 'unknown fine'}`);

      await Fine.findOneAndUpdate(
        { id: fineId },
        { $set: { status: 'paid', paid_date: pDate } },
      );
      created.fines_paid.push({ ...payment, fine_id: fineId });
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: memberId,
        amount: payment.amount_applied,
        type: 'fine_payment',
        description: `Fine payment — ${memberName} [bulk]`,
        reference: mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    if (allocation.loan_repayment?.amount > 0) {
      const repayment = await Repayment.create({
        id: await getNextId('repayment_id'),
        loan_id: allocation.loan_repayment.loan_id,
        amount: allocation.loan_repayment.amount,
        repayment_date: pDate,
        mpesa_ref: mpesa_ref || null,
        notes: notes ? `${notes} (bulk remainder)` : 'From bulk payment remainder',
      });
      created.loan_repayment = repayment;
      await Transaction.create({
        id: await getNextId('transaction_id'),
        member_id: memberId,
        amount: allocation.loan_repayment.amount,
        type: 'loan_repayment',
        description: `Loan repayment — ${memberName} (${allocation.loan_repayment.loan_number || `Loan #${allocation.loan_repayment.loan_id}`}) [bulk]`,
        reference: mpesa_ref || null,
        transaction_date: pDate,
      });
    }

    res.status(201).json({
      ok: true,
      allocation,
      created,
      message: `Bulk payment of TZS ${totalAmount.toLocaleString()} processed for ${memberName}.`,
    });
  } catch (err) {
    console.error('bulk-payment hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
