const fs = require('fs');

const reconciliationPath = process.argv[2];
const apiBase = (process.env.CHECKPOINT_API_BASE_URL || '').replace(/\/$/, '');
const adminUser = process.env.CHECKPOINT_ADMIN_USER || 'admin';
const adminPassword = process.env.CHECKPOINT_ADMIN_PASSWORD;

if (!reconciliationPath || !apiBase || !adminPassword) {
  console.error('Usage: CHECKPOINT_API_BASE_URL=... CHECKPOINT_ADMIN_PASSWORD=... node scripts/auditReconciliation.js <reconciliation.json>');
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reconciliationPath, 'utf8'));

const currentNameOverrides = new Map(Object.entries({
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

const aliasMap = new Map(
  source.member_alias_map.map((item) => [normalizeName(item.input_name), item.canonical_member])
);

for (const [input, canonical] of currentNameOverrides) aliasMap.set(input, canonical);
for (const item of source.members) aliasMap.set(normalizeName(item.member), item.member);

function canonicalName(value) {
  return aliasMap.get(normalizeName(value)) || value;
}

function periodParts(period) {
  const [monthName, yearText] = period.split(' ');
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ].indexOf(monthName) + 1;
  return { month, year: Number(yearText) };
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.error || ''}`);
  return payload;
}

function desiredLoans() {
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

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { username: adminUser, password: adminPassword },
  });
  const token = login.token;

  const [members, loans, fines, summary] = await Promise.all([
    request('/members', { token }),
    request('/loans', { token }),
    request('/summary/fines', { token }),
    request('/summary', { token }),
  ]);

  const memberDetails = await Promise.all(
    members.map((member) => request(`/members/${member.id}`, { token }))
  );

  const dbMembersByCanonical = new Map(
    memberDetails.map((member) => [canonicalName(member.name), member])
  );
  const sourceNames = new Set(source.members.map((member) => member.member));

  const contributionDiffs = [];
  let desiredContributionTotal = 0;
  let currentContributionTotalForMatchedMembers = 0;

  for (const ledger of source.contribution_ledgers) {
    for (const sourceMember of ledger.members) {
      const dbMember = dbMembersByCanonical.get(sourceMember.member);
      for (const monthEntry of sourceMember.months) {
        const { month, year } = periodParts(monthEntry.period);
        const desired = Number(monthEntry.amount_tzs || 0);
        const current = dbMember
          ? dbMember.contributions
              .filter((item) => item.month === month && item.year === year)
              .reduce((sum, item) => sum + item.amount, 0)
          : 0;

        desiredContributionTotal += desired;
        if (dbMember) currentContributionTotalForMatchedMembers += current;
        if (desired !== current) {
          contributionDiffs.push({
            member: sourceMember.member,
            period: monthEntry.period,
            desired,
            current,
            delta: desired - current,
            action: dbMember ? (current ? 'update_existing_month_total' : 'create_month') : 'create_historical_member_then_month',
          });
        }
      }
    }
  }

  const sourceLoans = desiredLoans();
  const matchedLoanIds = new Set();
  const loanDiffs = sourceLoans.map((desired) => {
    const canonical = canonicalName(desired.member);
    const dbMember = dbMembersByCanonical.get(canonical);
    const matches = loans.filter((loan) => (
      dbMember
      && loan.member_id === dbMember.id
      && loan.issued_date === desired.issue_date
    ));
    const current = matches.length === 1
      ? matches[0]
      : matches.find((loan) => loan.principal === desired.principal);

    if (!current) {
      return {
        member: canonical,
        loan_number: desired.loan_number,
        issue_date: desired.issue_date,
        action: dbMember ? 'create_loan_and_repayment_snapshot' : 'create_historical_member_then_loan',
        desired: {
          principal: desired.principal,
          interest_rate: desired.interest_rate,
          interest_amount: desired.interest,
          total_repaid: desired.total_repayments,
          balance: desired.current_balance,
          status: desired.desired_status,
          fiscal_year: desired.fiscal_year,
        },
      };
    }

    matchedLoanIds.add(current.id);
    const differences = {};
    const fields = {
      principal: [current.principal, desired.principal],
      interest_rate: [current.interest_rate, desired.interest_rate],
      interest_amount: [current.interest_amount, desired.interest],
      total_repaid: [current.total_repaid, desired.total_repayments],
      balance: [current.balance, desired.current_balance],
      status: [current.status, desired.desired_status],
      fiscal_year: [current.fiscal_year, desired.fiscal_year],
    };
    for (const [field, [currentValue, desiredValue]] of Object.entries(fields)) {
      if (currentValue !== desiredValue) differences[field] = { current: currentValue, desired: desiredValue };
    }

    return Object.keys(differences).length
      ? {
          member: canonical,
          loan_id: current.id,
          loan_number: desired.loan_number,
          issue_date: desired.issue_date,
          action: 'update_loan_and_repayment_snapshot',
          differences,
        }
      : null;
  }).filter(Boolean);

  const fineDiffs = source.members.map((sourceMember) => {
    const dbMember = dbMembersByCanonical.get(sourceMember.member);
    const memberFines = dbMember ? fines.filter((fine) => fine.member_id === dbMember.id) : [];
    const currentPaid = memberFines.filter((fine) => fine.status === 'paid').reduce((sum, fine) => sum + fine.amount, 0);
    const currentUnpaid = memberFines.filter((fine) => fine.status === 'unpaid').reduce((sum, fine) => sum + fine.amount, 0);
    const desiredPaid = sourceMember.fines.all_years_paid_tzs;
    const desiredUnpaid = sourceMember.fines.source_unpaid_fines_tzs;
    if (currentPaid === desiredPaid && currentUnpaid === desiredUnpaid) return null;
    return {
      member: sourceMember.member,
      current_paid: currentPaid,
      desired_paid: desiredPaid,
      current_unpaid: currentUnpaid,
      desired_unpaid: desiredUnpaid,
      action: 'review_fine_snapshot_before_update',
    };
  }).filter(Boolean);

  const report = {
    source: {
      schema_version: source.schema_version,
      generated_on: source.generated_on,
      reporting_cutoff: source.club.reporting_cutoff,
    },
    production: {
      member_count: members.length,
      contribution_count: memberDetails.reduce((sum, member) => sum + member.contributions.length, 0),
      loan_count: loans.length,
      fine_count: fines.length,
      summary,
    },
    members: {
      missing_in_production: [...sourceNames].filter((name) => !dbMembersByCanonical.has(name)),
      unmatched_production: memberDetails
        .filter((member) => !sourceNames.has(canonicalName(member.name)))
        .map((member) => member.name),
      canonical_matches: memberDetails.map((member) => ({
        production_name: member.name,
        canonical_name: canonicalName(member.name),
        member_id: member.id,
      })),
    },
    contributions: {
      desired_total: desiredContributionTotal,
      current_total_for_matched_members: currentContributionTotalForMatchedMembers,
      difference_count: contributionDiffs.length,
      differences: contributionDiffs,
    },
    loans: {
      desired_count: sourceLoans.length,
      current_count: loans.length,
      difference_count: loanDiffs.length,
      differences: loanDiffs,
      unmatched_production: loans
        .filter((loan) => !matchedLoanIds.has(loan.id))
        .map((loan) => ({
          id: loan.id,
          member_name: loan.member_name,
          issued_date: loan.issued_date,
          principal: loan.principal,
        })),
    },
    fines: {
      difference_count: fineDiffs.length,
      differences: fineDiffs,
    },
    blocked_from_automatic_posting: source.pending_review,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
