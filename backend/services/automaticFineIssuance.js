const {
  Member,
  Contribution,
  Loan,
  Repayment,
  Fine,
  Notification,
  getNextId,
} = require('../db/models');
const { CommunicationLog } = require('../db/communicationModels');
const { getRulesForFY } = require('../routes/rules');
const {
  getFiscalYear,
  getContributionDeadline,
  calculateOneTimeFine,
  fineMatchesContributionPeriod,
} = require('./contributionFinePolicy');
const { isConfigured, sendMemberMessage } = require('../utils/memberMailer');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function periodKey(month, year) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function periodLabel(month, year) {
  return `${MONTH_NAMES[month] || month} ${year}`;
}

function previousContributionPeriod(now) {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function fiscalYearPeriods(fy) {
  return [
    ...Array.from({ length: 10 }, (_, index) => ({ month: index + 3, year: fy })),
    { month: 1, year: fy + 1 },
    { month: 2, year: fy + 1 },
  ];
}

function memberOwesPeriod(member, month, year) {
  if (!member?.join_date) return true;
  const joined = new Date(`${member.join_date}T12:00:00Z`);
  if (Number.isNaN(joined.getTime())) return true;
  const joinPeriod = joined.getUTCFullYear() * 100 + joined.getUTCMonth() + 1;
  const requestedPeriod = Number(year) * 100 + Number(month);
  return joinPeriod <= requestedPeriod;
}

function contributionRows(contributions, memberId, month, year) {
  return contributions.filter((row) => Number(row.member_id) === Number(memberId)
    && Number(row.month) === Number(month)
    && Number(row.year) === Number(year));
}

function settlementForPeriod(contributions, memberId, month, year, target, deadline) {
  const rows = contributionRows(contributions, memberId, month, year);
  const totalPaid = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outstanding = Math.max(0, Number(target || 0) - totalPaid);

  // If the contribution is already fully paid, it is only treated as late when
  // the recorded payment dates prove the full target was not settled by the 5th.
  // Missing historical paid_date values are never guessed.
  const datedRows = rows.map((row) => {
    if (!row.paid_date) return { row, paidAt: null };
    const paidAt = new Date(`${row.paid_date}T12:00:00Z`);
    return { row, paidAt: Number.isNaN(paidAt.getTime()) ? null : paidAt };
  });
  const completeDating = rows.length > 0 && datedRows.every((item) => item.paidAt);
  const paidByDeadline = completeDating
    ? datedRows
      .filter((item) => item.paidAt <= deadline)
      .reduce((sum, item) => sum + Number(item.row.amount || 0), 0)
    : null;
  const fullyPaidLate = totalPaid >= Number(target || 0)
    && completeDating
    && paidByDeadline < Number(target || 0);

  return {
    total_paid: totalPaid,
    outstanding,
    fully_paid_late: fullyPaidLate,
  };
}

function monthsDiff(startValue, endValue) {
  const start = new Date(`${startValue}T12:00:00Z`);
  const end = endValue instanceof Date ? endValue : new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0,
    ((end.getUTCFullYear() - start.getUTCFullYear()) * 12)
      - start.getUTCMonth()
      + end.getUTCMonth());
}

async function outstandingLoanBalance(loans, repayments, memberId, now, rulesCache) {
  let total = 0;
  for (const loan of loans.filter((row) => Number(row.member_id) === Number(memberId)
    && ['active', 'overdue'].includes(row.status)
    && row.disbursed !== false)) {
    const loanFy = Number(loan.fiscal_year);
    const rules = rulesCache.get(loanFy) || await getRulesForFY(loanFy);
    rulesCache.set(loanFy, rules);
    const repaid = repayments
      .filter((row) => Number(row.loan_id) === Number(loan.id))
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    let penalty = 0;
    const repaymentMonths = Number(rules.loan_repayment_months || 0);
    const monthsActive = loan.issued_date ? monthsDiff(loan.issued_date, now) : 0;
    if (rules.overdue_penalty_enabled && repaymentMonths > 0 && monthsActive > repaymentMonths) {
      penalty = Math.round(
        Number(loan.principal || 0)
          * Number(rules.overdue_penalty_rate || 0)
          * (monthsActive - repaymentMonths),
      );
    }

    total += Math.max(0, Number(loan.principal || 0) + penalty - repaid);
  }
  return total;
}

async function currentContributionArrears(member, contributions, now, rulesCache) {
  const currentFy = getFiscalYear(now.getUTCMonth() + 1, now.getUTCFullYear());
  let total = 0;

  for (const period of fiscalYearPeriods(currentFy)) {
    if (!memberOwesPeriod(member, period.month, period.year)) continue;
    const deadline = getContributionDeadline(period.month, period.year);
    if (now <= deadline) continue;
    const fy = getFiscalYear(period.month, period.year);
    const rules = rulesCache.get(fy) || await getRulesForFY(fy);
    rulesCache.set(fy, rules);
    const target = Number(rules.contribution_amount || 0);
    const paid = contributionRows(contributions, member.id, period.month, period.year)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    total += Math.max(0, target - paid);
  }

  return total;
}

async function createNotificationIfNew({ memberId, message, dueDate }) {
  const existing = await Notification.findOne({ member_id: memberId, type: 'fine_issued', message }).lean();
  if (existing) return { notification: existing, created: false };

  const notification = await Notification.create({
    id: await getNextId('notification_id'),
    member_id: memberId,
    type: 'fine_issued',
    message,
    due_date: dueDate || null,
    read: false,
    created_by: 'system:auto-late-fines',
  });
  return { notification: notification.toObject(), created: true };
}

async function logFineEmail({ member, period, subject, status, info, failureReason, source }) {
  return CommunicationLog.create({
    member_id: member.id,
    recipient_email: String(member.email || '').trim().toLowerCase(),
    type: 'fine_notice',
    period_key: period,
    subject,
    status,
    provider_message_id: info?.messageId || null,
    sent_at: ['sent', 'mocked'].includes(status) ? new Date() : null,
    failure_reason: failureReason || null,
    source_entity_type: 'automatic_late_fine',
    source_entity_id: period,
    created_by: source || 'system:auto-late-fines',
  });
}

async function runAutomaticFineIssuance(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const source = options.source || 'system:auto-late-fines';
  const portalUrl = String(options.portalUrl || process.env.PORTAL_URL || process.env.WEB_ORIGIN || '').replace(/\/$/, '');
  const period = previousContributionPeriod(now);
  const deadline = getContributionDeadline(period.month, period.year);
  const fy = getFiscalYear(period.month, period.year);

  // Prospective-only rule: each run examines only the immediately previous
  // contribution month. Older historical gaps are deliberately left untouched.
  if (now <= deadline) {
    return {
      ok: true,
      scanned_at: now.toISOString(),
      period,
      deadline: dateKey(deadline),
      fines_created: 0,
      members_notified: 0,
      message: `${periodLabel(period.month, period.year)} remains payable through ${dateKey(deadline)}. No fine is due yet.`,
      results: [],
    };
  }

  const rules = await getRulesForFY(fy);
  if (!rules.late_fine_enabled) {
    return {
      ok: true,
      scanned_at: now.toISOString(),
      period,
      deadline: dateKey(deadline),
      fines_created: 0,
      members_notified: 0,
      message: `Late fines are disabled for FY${fy}.`,
      results: [],
    };
  }

  const [members, contributions, loans, repayments, existingFines] = await Promise.all([
    Member.find({ status: 'active' }).lean(),
    Contribution.find().lean(),
    Loan.find().lean(),
    Repayment.find().lean(),
    Fine.find().lean(),
  ]);
  const rulesCache = new Map([[fy, rules]]);
  const allFines = [...existingFines];
  const results = [];

  for (const member of members) {
    if (!memberOwesPeriod(member, period.month, period.year)) continue;

    const target = Number(rules.contribution_amount || 0);
    const settlement = settlementForPeriod(
      contributions,
      member.id,
      period.month,
      period.year,
      target,
      deadline,
    );
    const shouldFine = settlement.outstanding > 0 || settlement.fully_paid_late;
    if (!shouldFine) continue;

    const existingPeriodFine = allFines.find((fine) => Number(fine.member_id) === Number(member.id)
      && fineMatchesContributionPeriod(fine, period.month, period.year));
    if (existingPeriodFine) continue;

    const fineCalc = calculateOneTimeFine(rules, target, period.month, period.year, fy);
    if (!fineCalc || Number(fineCalc.amount || 0) <= 0) continue;

    const reconciliationKey = `auto-late:${member.id}:${periodKey(period.month, period.year)}`;
    let fine;
    try {
      fine = await Fine.create({
        id: await getNextId('fine_id'),
        member_id: member.id,
        amount: Number(fineCalc.amount),
        reason: fineCalc.reason,
        year: fy,
        contribution_month: period.month,
        contribution_year: period.year,
        status: 'unpaid',
        review_required: false,
        reconciliation_key: reconciliationKey,
        notes: settlement.outstanding > 0
          ? `Automatically issued after contribution deadline ${dateKey(deadline)}. Outstanding contribution: TZS ${settlement.outstanding.toLocaleString('en-US')}.`
          : `Automatically issued after contribution deadline ${dateKey(deadline)}. Contribution was completed after the deadline.`,
      });
    } catch (error) {
      // The reconciliation key is unique. If overlapping cron runners race, the
      // second one simply observes the fine already created by the first.
      if (error?.code === 11000) continue;
      throw error;
    }

    const plainFine = fine.toObject();
    allFines.push(plainFine);

    const contributionArrears = await currentContributionArrears(
      member,
      contributions,
      now,
      rulesCache,
    );
    const unpaidFineTotal = allFines
      .filter((item) => Number(item.member_id) === Number(member.id) && item.status === 'unpaid')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const loanOutstanding = await outstandingLoanBalance(loans, repayments, member.id, now, rulesCache);
    const totalOwed = contributionArrears + unpaidFineTotal + loanOutstanding;

    const monthState = settlement.outstanding > 0
      ? `Contribution still outstanding: TZS ${settlement.outstanding.toLocaleString('en-US')}`
      : 'Contribution completed after the deadline';
    const notificationMessage = `${periodLabel(period.month, period.year)} late contribution fine issued: TZS ${Number(plainFine.amount || 0).toLocaleString('en-US')}. ${monthState}. Total currently owed to the club: TZS ${totalOwed.toLocaleString('en-US')}.`;
    const notificationResult = await createNotificationIfNew({
      memberId: member.id,
      message: notificationMessage,
      dueDate: dateKey(deadline),
    });

    const emailPeriodKey = `auto-fine:${member.id}:${periodKey(period.month, period.year)}`;
    let emailStatus = 'skipped';
    let emailReason = null;

    if (!member.email) {
      emailReason = 'Member has no email address';
    } else {
      const alreadySent = await CommunicationLog.findOne({
        member_id: member.id,
        type: 'fine_notice',
        period_key: emailPeriodKey,
        status: { $in: ['sent', 'mocked'] },
      }).lean();

      if (alreadySent) {
        emailStatus = 'existing';
      } else {
        const subject = `Checkpoint late contribution fine — ${periodLabel(period.month, period.year)}`;
        const message = [
          `A late contribution fine has been issued for ${periodLabel(period.month, period.year)} because the contribution deadline of ${dateKey(deadline)} was not met.`,
          '',
          `Monthly contribution target: TZS ${target.toLocaleString('en-US')}`,
          `Contribution recorded: TZS ${settlement.total_paid.toLocaleString('en-US')}`,
          `${monthState}`,
          `Fine issued: TZS ${Number(plainFine.amount || 0).toLocaleString('en-US')}`,
          '',
          'Your current amounts owed to the club:',
          `Contribution arrears: TZS ${contributionArrears.toLocaleString('en-US')}`,
          `Unpaid fines: TZS ${unpaidFineTotal.toLocaleString('en-US')}`,
          `Outstanding loan balance: TZS ${loanOutstanding.toLocaleString('en-US')}`,
          `TOTAL CURRENTLY OWED TO THE CLUB: TZS ${totalOwed.toLocaleString('en-US')}`,
          '',
          'Please review your Checkpoint account. If you already made a payment that has not yet been posted, send the payment reference to the administrator for verification.',
        ].join('\n');

        try {
          const info = await sendMemberMessage(member, {
            subject,
            message,
            portalUrl: portalUrl ? `${portalUrl}/contributions` : null,
          });
          emailStatus = info.mocked ? 'mocked' : 'sent';
          await logFineEmail({
            member,
            period: emailPeriodKey,
            subject,
            status: emailStatus,
            info,
            source,
          });
        } catch (error) {
          emailStatus = 'failed';
          emailReason = error.message;
          await logFineEmail({
            member,
            period: emailPeriodKey,
            subject,
            status: 'failed',
            failureReason: error.message,
            source,
          });
        }
      }
    }

    results.push({
      member_id: member.id,
      member_name: member.name,
      month: period.month,
      year: period.year,
      deadline: dateKey(deadline),
      fine_id: plainFine.id,
      fine_amount: plainFine.amount,
      contribution_target: target,
      contribution_recorded: settlement.total_paid,
      contribution_outstanding: settlement.outstanding,
      paid_after_deadline: settlement.fully_paid_late,
      contribution_arrears: contributionArrears,
      unpaid_fines: unpaidFineTotal,
      outstanding_loan_balance: loanOutstanding,
      total_owed: totalOwed,
      notification: notificationResult.created ? 'created' : 'existing',
      email: emailStatus,
      email_reason: emailReason,
    });
  }

  return {
    ok: true,
    scanned_at: now.toISOString(),
    period,
    deadline: dateKey(deadline),
    prospective_only: true,
    smtp_configured: isConfigured,
    fines_created: results.length,
    members_notified: results.length,
    notifications_created: results.filter((row) => row.notification === 'created').length,
    emails_sent: results.filter((row) => row.email === 'sent').length,
    emails_mocked: results.filter((row) => row.email === 'mocked').length,
    emails_failed: results.filter((row) => row.email === 'failed').length,
    message: `Checked only ${periodLabel(period.month, period.year)}. Historical contribution periods were not changed.`,
    results,
  };
}

module.exports = {
  runAutomaticFineIssuance,
};
