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

function periodStart(month, year) {
  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

function nextPeriod(month, year) {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

function parseMemberStart(member, memberContributions, now) {
  if (member.join_date) {
    const join = new Date(`${member.join_date}T12:00:00Z`);
    if (!Number.isNaN(join.getTime())) {
      return { month: join.getUTCMonth() + 1, year: join.getUTCFullYear() };
    }
  }

  if (memberContributions.length) {
    const first = [...memberContributions].sort((a, b) => {
      const aKey = Number(a.year || 0) * 100 + Number(a.month || 0);
      const bKey = Number(b.year || 0) * 100 + Number(b.month || 0);
      return aKey - bKey;
    })[0];
    return { month: Number(first.month), year: Number(first.year) };
  }

  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  const currentFy = getFiscalYear(currentMonth, currentYear);
  return { month: 3, year: currentFy };
}

function contributionPaid(contributions, memberId, month, year) {
  return contributions
    .filter((row) => Number(row.member_id) === Number(memberId)
      && Number(row.month) === Number(month)
      && Number(row.year) === Number(year))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
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
    const rules = rulesCache.get(Number(loan.fiscal_year)) || await getRulesForFY(Number(loan.fiscal_year));
    rulesCache.set(Number(loan.fiscal_year), rules);
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
    source_entity_type: 'automatic_late_fine_batch',
    source_entity_id: period,
    created_by: source || 'system:auto-late-fines',
  });
}

async function runAutomaticFineIssuance(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const onlyFy = options.fiscalYear == null ? null : Number(options.fiscalYear);
  const source = options.source || 'system:auto-late-fines';
  const portalUrl = String(options.portalUrl || process.env.PORTAL_URL || process.env.WEB_ORIGIN || '').replace(/\/$/, '');

  const [members, contributions, loans, repayments, existingFines] = await Promise.all([
    Member.find({ status: 'active' }).lean(),
    Contribution.find().lean(),
    Loan.find().lean(),
    Repayment.find().lean(),
    Fine.find().lean(),
  ]);

  const rulesCache = new Map();
  const allFines = [...existingFines];
  const newByMember = new Map();
  const overdueContributionRows = new Map();

  for (const member of members) {
    const memberContributions = contributions.filter((row) => Number(row.member_id) === Number(member.id));
    let cursor = parseMemberStart(member, memberContributions, now);
    const current = { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
    const overdueRows = [];
    let safety = 0;

    while (periodStart(cursor.month, cursor.year) <= periodStart(current.month, current.year) && safety < 180) {
      safety += 1;
      const deadline = getContributionDeadline(cursor.month, cursor.year);
      const fy = getFiscalYear(cursor.month, cursor.year);
      const rules = rulesCache.get(fy) || await getRulesForFY(fy);
      rulesCache.set(fy, rules);
      const target = Number(rules.contribution_amount || 0);
      const paid = contributionPaid(contributions, member.id, cursor.month, cursor.year);
      const outstanding = Math.max(0, target - paid);

      if (now > deadline && outstanding > 0) {
        overdueRows.push({
          month: cursor.month,
          year: cursor.year,
          fiscal_year: fy,
          target,
          paid,
          outstanding,
          deadline: dateKey(deadline),
        });

        const fyMatches = onlyFy == null || fy === onlyFy;
        const existingPeriodFine = allFines.find((fine) => Number(fine.member_id) === Number(member.id)
          && fineMatchesContributionPeriod(fine, cursor.month, cursor.year));

        if (fyMatches && rules.late_fine_enabled && !existingPeriodFine) {
          const fineCalc = calculateOneTimeFine(rules, target, cursor.month, cursor.year, fy);
          if (fineCalc && Number(fineCalc.amount || 0) > 0) {
            const reconciliationKey = `auto-late:${member.id}:${periodKey(cursor.month, cursor.year)}`;
            const fine = await Fine.create({
              id: await getNextId('fine_id'),
              member_id: member.id,
              amount: Number(fineCalc.amount),
              reason: fineCalc.reason,
              year: fy,
              contribution_month: cursor.month,
              contribution_year: cursor.year,
              status: 'unpaid',
              review_required: false,
              reconciliation_key: reconciliationKey,
              notes: `Automatically issued after contribution deadline ${dateKey(deadline)}. Outstanding contribution at assessment: TZS ${outstanding.toLocaleString('en-US')}.`,
            });
            const plain = fine.toObject();
            allFines.push(plain);
            if (!newByMember.has(member.id)) newByMember.set(member.id, []);
            newByMember.get(member.id).push({ ...plain, contribution_outstanding: outstanding, deadline: dateKey(deadline) });
          }
        }
      }

      cursor = nextPeriod(cursor.month, cursor.year);
    }

    overdueContributionRows.set(member.id, overdueRows);
  }

  const results = [];
  for (const member of members) {
    const newFines = newByMember.get(member.id) || [];
    if (!newFines.length) continue;

    const contributionArrears = (overdueContributionRows.get(member.id) || [])
      .reduce((sum, row) => sum + Number(row.outstanding || 0), 0);
    const unpaidFineTotal = allFines
      .filter((fine) => Number(fine.member_id) === Number(member.id) && fine.status === 'unpaid')
      .reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
    const loanOutstanding = await outstandingLoanBalance(loans, repayments, member.id, now, rulesCache);
    const totalOwed = contributionArrears + unpaidFineTotal + loanOutstanding;

    const fineLines = newFines
      .sort((a, b) => Number(a.contribution_year) - Number(b.contribution_year)
        || Number(a.contribution_month) - Number(b.contribution_month))
      .map((fine) => `${periodLabel(fine.contribution_month, fine.contribution_year)} — fine TZS ${Number(fine.amount || 0).toLocaleString('en-US')} (contribution outstanding TZS ${Number(fine.contribution_outstanding || 0).toLocaleString('en-US')})`);

    const notificationMessage = `Late contribution fine${newFines.length === 1 ? '' : 's'} issued: ${fineLines.join('; ')}. Total currently owed to the club: TZS ${totalOwed.toLocaleString('en-US')}.`;
    const notificationResult = await createNotificationIfNew({
      memberId: member.id,
      message: notificationMessage,
      dueDate: newFines.map((fine) => fine.deadline).sort().at(-1) || null,
    });

    let emailStatus = 'skipped';
    let emailReason = null;
    const batchKey = `auto-fines:${member.id}:${newFines
      .map((fine) => periodKey(fine.contribution_month, fine.contribution_year))
      .sort()
      .join(',')}`;
    const existingEmail = await CommunicationLog.findOne({
      member_id: member.id,
      type: 'fine_notice',
      period_key: batchKey,
      status: { $in: ['sent', 'mocked'] },
    }).lean();

    if (existingEmail) {
      emailStatus = 'existing';
    } else if (!member.email) {
      emailReason = 'Member has no email address';
    } else {
      const subject = newFines.length === 1
        ? `Checkpoint late contribution fine — ${periodLabel(newFines[0].contribution_month, newFines[0].contribution_year)}`
        : `Checkpoint late contribution fines — ${newFines.length} months`;
      const message = [
        `Checkpoint has automatically applied ${newFines.length === 1 ? 'a late contribution fine' : `${newFines.length} late contribution fines`} because the contribution deadline on the 5th of the following month passed without full payment.`,
        '',
        'Fine(s) issued:',
        ...fineLines.map((line) => `• ${line}`),
        '',
        'Your current amounts owed to the club:',
        `Contribution arrears: TZS ${contributionArrears.toLocaleString('en-US')}`,
        `Unpaid fines: TZS ${unpaidFineTotal.toLocaleString('en-US')}`,
        `Outstanding loan balance: TZS ${loanOutstanding.toLocaleString('en-US')}`,
        `TOTAL CURRENTLY OWED TO THE CLUB: TZS ${totalOwed.toLocaleString('en-US')}`,
        '',
        'Please review your Checkpoint account. If a contribution was already paid but has not yet been posted, contact the administrator with the payment reference before making another payment.',
      ].join('\n');

      try {
        const info = await sendMemberMessage(member, {
          subject,
          message,
          portalUrl: portalUrl ? `${portalUrl}/contributions` : null,
        });
        emailStatus = info.mocked ? 'mocked' : 'sent';
        await logFineEmail({ member, period: batchKey, subject, status: emailStatus, info, source });
      } catch (error) {
        emailStatus = 'failed';
        emailReason = error.message;
        await logFineEmail({ member, period: batchKey, subject, status: 'failed', failureReason: error.message, source });
      }
    }

    results.push({
      member_id: member.id,
      member_name: member.name,
      fines_issued: newFines.map((fine) => ({
        fine_id: fine.id,
        month: fine.contribution_month,
        year: fine.contribution_year,
        amount: fine.amount,
        deadline: fine.deadline,
      })),
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
    fine_window: 'A contribution remains payable through the 5th of the following month; the automatic fine is applied after that deadline has passed (normally the 6th daily scan).',
    smtp_configured: isConfigured,
    fines_created: [...newByMember.values()].reduce((sum, rows) => sum + rows.length, 0),
    members_notified: results.length,
    notifications_created: results.filter((row) => row.notification === 'created').length,
    emails_sent: results.filter((row) => row.email === 'sent').length,
    emails_mocked: results.filter((row) => row.email === 'mocked').length,
    emails_failed: results.filter((row) => row.email === 'failed').length,
    results,
  };
}

module.exports = {
  runAutomaticFineIssuance,
};
