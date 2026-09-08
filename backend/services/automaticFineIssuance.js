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

const AUTOMATION_START = { month: 3, year: 2026 }; // FY2026/2027 onward only.
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

function periodOrder(month, year) {
  return Number(year) * 100 + Number(month);
}

function nextPeriod(month, year) {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

function eligiblePeriods(now) {
  const periods = [];
  let cursor = { ...AUTOMATION_START };
  const current = { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
  let safety = 0;

  while (periodOrder(cursor.month, cursor.year) <= periodOrder(current.month, current.year) && safety < 240) {
    safety += 1;
    const deadline = getContributionDeadline(cursor.month, cursor.year);
    if (now > deadline) {
      periods.push({
        ...cursor,
        fiscal_year: getFiscalYear(cursor.month, cursor.year),
        deadline,
      });
    }
    cursor = nextPeriod(cursor.month, cursor.year);
  }

  return periods;
}

function memberOwesPeriod(member, month, year) {
  if (!member?.join_date) return true;
  const joined = new Date(`${member.join_date}T12:00:00Z`);
  if (Number.isNaN(joined.getTime())) return true;
  return periodOrder(joined.getUTCMonth() + 1, joined.getUTCFullYear()) <= periodOrder(month, year);
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

  // A fully paid month is only classified as late when the stored payment dates
  // prove that the full target had not been settled by the 5th. We do not guess
  // historical timing where paid_date is missing.
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
    const loanFy = Number(loan.fiscal_year || getFiscalYear(
      new Date(`${loan.issued_date || dateKey(now)}T12:00:00Z`).getUTCMonth() + 1,
      new Date(`${loan.issued_date || dateKey(now)}T12:00:00Z`).getUTCFullYear(),
    ));
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

async function contributionArrearsSinceFY2026(member, contributions, periods, now, rulesCache) {
  let total = 0;
  for (const period of periods) {
    if (!memberOwesPeriod(member, period.month, period.year)) continue;
    if (now <= period.deadline) continue;
    const rules = rulesCache.get(period.fiscal_year) || await getRulesForFY(period.fiscal_year);
    rulesCache.set(period.fiscal_year, rules);
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

async function logFineEmail({ member, batchKey, subject, status, info, failureReason, source }) {
  return CommunicationLog.create({
    member_id: member.id,
    recipient_email: String(member.email || '').trim().toLowerCase(),
    type: 'fine_notice',
    period_key: batchKey,
    subject,
    status,
    provider_message_id: info?.messageId || null,
    sent_at: ['sent', 'mocked'].includes(status) ? new Date() : null,
    failure_reason: failureReason || null,
    source_entity_type: 'automatic_late_fine_batch',
    source_entity_id: batchKey,
    created_by: source || 'system:auto-late-fines',
  });
}

async function runAutomaticFineIssuance(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const source = options.source || 'system:auto-late-fines';
  const portalUrl = String(options.portalUrl || process.env.PORTAL_URL || process.env.WEB_ORIGIN || '').replace(/\/$/, '');
  const periods = eligiblePeriods(now);

  if (!periods.length) {
    return {
      ok: true,
      scanned_at: now.toISOString(),
      automation_start: '2026-03',
      fines_created: 0,
      members_notified: 0,
      message: 'No FY2026/2027-or-later contribution period has reached its late-fine date yet.',
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
  const allFines = [...existingFines];
  const rulesCache = new Map();
  const newlyIssued = new Map();
  const scanDetails = [];

  for (const member of members) {
    for (const period of periods) {
      if (!memberOwesPeriod(member, period.month, period.year)) continue;

      const rules = rulesCache.get(period.fiscal_year) || await getRulesForFY(period.fiscal_year);
      rulesCache.set(period.fiscal_year, rules);
      if (!rules.late_fine_enabled) continue;

      const target = Number(rules.contribution_amount || 0);
      const settlement = settlementForPeriod(
        contributions,
        member.id,
        period.month,
        period.year,
        target,
        period.deadline,
      );
      const shouldFine = settlement.outstanding > 0 || settlement.fully_paid_late;
      if (!shouldFine) continue;

      const existingPeriodFine = allFines.find((fine) => Number(fine.member_id) === Number(member.id)
        && fineMatchesContributionPeriod(fine, period.month, period.year));
      if (existingPeriodFine) {
        scanDetails.push({
          member_id: member.id,
          month: period.month,
          year: period.year,
          action: 'skipped_existing_fine',
          fine_id: existingPeriodFine.id,
        });
        continue;
      }

      const fineCalc = calculateOneTimeFine(
        rules,
        target,
        period.month,
        period.year,
        period.fiscal_year,
      );
      if (!fineCalc || Number(fineCalc.amount || 0) <= 0) continue;

      const reconciliationKey = `auto-late:${member.id}:${periodKey(period.month, period.year)}`;
      let fine;
      try {
        fine = await Fine.create({
          id: await getNextId('fine_id'),
          member_id: member.id,
          amount: Number(fineCalc.amount),
          reason: fineCalc.reason,
          year: period.fiscal_year,
          contribution_month: period.month,
          contribution_year: period.year,
          status: 'unpaid',
          review_required: false,
          reconciliation_key: reconciliationKey,
          notes: settlement.outstanding > 0
            ? `Automatically issued after contribution deadline ${dateKey(period.deadline)}. Outstanding contribution: TZS ${settlement.outstanding.toLocaleString('en-US')}.`
            : `Automatically issued after contribution deadline ${dateKey(period.deadline)}. Contribution was completed after the deadline.`,
        });
      } catch (error) {
        if (error?.code === 11000) {
          scanDetails.push({
            member_id: member.id,
            month: period.month,
            year: period.year,
            action: 'skipped_duplicate_race',
          });
          continue;
        }
        throw error;
      }

      const plainFine = fine.toObject();
      allFines.push(plainFine);
      if (!newlyIssued.has(member.id)) newlyIssued.set(member.id, []);
      newlyIssued.get(member.id).push({
        ...plainFine,
        contribution_target: target,
        contribution_recorded: settlement.total_paid,
        contribution_outstanding: settlement.outstanding,
        paid_after_deadline: settlement.fully_paid_late,
        deadline: dateKey(period.deadline),
      });
      scanDetails.push({
        member_id: member.id,
        month: period.month,
        year: period.year,
        action: 'fine_created',
        fine_id: plainFine.id,
      });
    }
  }

  const results = [];
  for (const member of members) {
    const memberFines = (newlyIssued.get(member.id) || []).sort((a, b) =>
      periodOrder(a.contribution_month, a.contribution_year)
        - periodOrder(b.contribution_month, b.contribution_year));
    if (!memberFines.length) continue;

    const contributionArrears = await contributionArrearsSinceFY2026(
      member,
      contributions,
      periods,
      now,
      rulesCache,
    );
    const unpaidFineTotal = allFines
      .filter((item) => Number(item.member_id) === Number(member.id) && item.status === 'unpaid')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const loanOutstanding = await outstandingLoanBalance(loans, repayments, member.id, now, rulesCache);
    const totalOwed = contributionArrears + unpaidFineTotal + loanOutstanding;

    const fineLines = memberFines.map((fine) => {
      const monthState = fine.contribution_outstanding > 0
        ? `contribution outstanding TZS ${Number(fine.contribution_outstanding).toLocaleString('en-US')}`
        : 'contribution completed after deadline';
      return `${periodLabel(fine.contribution_month, fine.contribution_year)} — fine TZS ${Number(fine.amount || 0).toLocaleString('en-US')} (${monthState})`;
    });

    const notificationMessage = `${memberFines.length === 1 ? 'Late contribution fine issued' : 'Late contribution fines issued'}: ${fineLines.join('; ')}. Total currently owed to the club: TZS ${totalOwed.toLocaleString('en-US')}.`;
    const notificationResult = await createNotificationIfNew({
      memberId: member.id,
      message: notificationMessage,
      dueDate: memberFines.map((fine) => fine.deadline).sort().at(-1) || null,
    });

    const batchKey = `auto-fines:${member.id}:${memberFines
      .map((fine) => periodKey(fine.contribution_month, fine.contribution_year))
      .join(',')}`;
    let emailStatus = 'skipped';
    let emailReason = null;

    if (!member.email) {
      emailReason = 'Member has no email address';
    } else {
      const alreadySent = await CommunicationLog.findOne({
        member_id: member.id,
        type: 'fine_notice',
        period_key: batchKey,
        status: { $in: ['sent', 'mocked'] },
      }).lean();

      if (alreadySent) {
        emailStatus = 'existing';
      } else {
        const subject = memberFines.length === 1
          ? `Checkpoint late contribution fine — ${periodLabel(memberFines[0].contribution_month, memberFines[0].contribution_year)}`
          : `Checkpoint late contribution fines — ${memberFines.length} months`;
        const message = [
          `Checkpoint has applied ${memberFines.length === 1 ? 'a late contribution fine' : `${memberFines.length} late contribution fines`} after checking contribution months from FY2026/2027 onward.`,
          '',
          'Fine(s) issued in this assessment:',
          ...fineLines.map((line) => `• ${line}`),
          '',
          'Your current amounts owed to the club:',
          `Contribution arrears from FY2026/2027 onward: TZS ${contributionArrears.toLocaleString('en-US')}`,
          `Unpaid fines: TZS ${unpaidFineTotal.toLocaleString('en-US')}`,
          `Outstanding loan balance: TZS ${loanOutstanding.toLocaleString('en-US')}`,
          `TOTAL CURRENTLY OWED TO THE CLUB: TZS ${totalOwed.toLocaleString('en-US')}`,
          '',
          'A contribution is due through the 5th of the following month. Checkpoint does not create a second fine where that contribution month already has a fine recorded.',
          '',
          'If you already made a payment that has not yet been posted, send the payment reference to the administrator for verification.',
        ].join('\n');

        try {
          const info = await sendMemberMessage(member, {
            subject,
            message,
            portalUrl: portalUrl ? `${portalUrl}/contributions` : null,
          });
          emailStatus = info.mocked ? 'mocked' : 'sent';
          await logFineEmail({ member, batchKey, subject, status: emailStatus, info, source });
        } catch (error) {
          emailStatus = 'failed';
          emailReason = error.message;
          await logFineEmail({
            member,
            batchKey,
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
      fines_issued: memberFines.map((fine) => ({
        fine_id: fine.id,
        month: fine.contribution_month,
        year: fine.contribution_year,
        amount: fine.amount,
        deadline: fine.deadline,
        contribution_target: fine.contribution_target,
        contribution_recorded: fine.contribution_recorded,
        contribution_outstanding: fine.contribution_outstanding,
        paid_after_deadline: fine.paid_after_deadline,
      })),
      contribution_arrears_since_fy2026: contributionArrears,
      unpaid_fines: unpaidFineTotal,
      outstanding_loan_balance: loanOutstanding,
      total_owed: totalOwed,
      notification: notificationResult.created ? 'created' : 'existing',
      email: emailStatus,
      email_reason: emailReason,
    });
  }

  const latestPeriod = periods[periods.length - 1];
  return {
    ok: true,
    scanned_at: now.toISOString(),
    automation_start: '2026-03',
    latest_eligible_period: latestPeriod
      ? { month: latestPeriod.month, year: latestPeriod.year, deadline: dateKey(latestPeriod.deadline) }
      : null,
    periods_checked: periods.map((period) => ({
      month: period.month,
      year: period.year,
      deadline: dateKey(period.deadline),
    })),
    historical_before_fy2026_untouched: true,
    smtp_configured: isConfigured,
    fines_created: [...newlyIssued.values()].reduce((sum, rows) => sum + rows.length, 0),
    members_notified: results.length,
    notifications_created: results.filter((row) => row.notification === 'created').length,
    emails_sent: results.filter((row) => row.email === 'sent').length,
    emails_mocked: results.filter((row) => row.email === 'mocked').length,
    emails_failed: results.filter((row) => row.email === 'failed').length,
    scan_details: scanDetails,
    results,
  };
}

module.exports = {
  AUTOMATION_START,
  eligiblePeriods,
  runAutomaticFineIssuance,
};
