const fs = require('fs');

const sourcePath = process.argv[2];
const apiBase = String(process.env.CHECKPOINT_API_BASE_URL || '').replace(/\/$/, '');
const username = process.env.CHECKPOINT_ADMIN_USERNAME || process.env.CHECKPOINT_ADMIN_USER || 'admin';
const password = process.env.CHECKPOINT_ADMIN_PASSWORD;
const shouldApply = process.env.APPLY_RECONCILIATION === 'true';

if (!sourcePath || !apiBase || !password) {
  console.error('Usage: CHECKPOINT_API_BASE_URL=... CHECKPOINT_ADMIN_PASSWORD=... node scripts/applyReconciliationV2.js <reconciliation-v2.json>');
  process.exit(2);
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${path}: ${body.error || JSON.stringify(body)}`);
  return body;
}

(async () => {
  const login = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };
  const preview = await request('/reconciliation/preview', {
    method: 'POST', headers, body: JSON.stringify(source),
  });
  console.log('Preview:');
  console.log(JSON.stringify(preview, null, 2));

  if (!shouldApply) {
    console.log('\nDry run only. Set APPLY_RECONCILIATION=true after reviewing the preview.');
    return;
  }

  const applied = await request('/reconciliation/apply', {
    method: 'POST', headers, body: JSON.stringify(source),
  });
  console.log('\nApply result:');
  console.log(JSON.stringify(applied, null, 2));

  const summary = await request('/summary', { headers });
  const expected = source.financial_position;
  const actual = summary.financial_overview;
  const checks = [
    ['cash_at_bank', actual.cash_at_bank, expected.confirmed_mkoba_cash_tzs],
    ['investment_assets', actual.investment_assets, expected.itrust_investment_at_cost_tzs],
    ['loans_outstanding', actual.loans_outstanding, expected.working_net_loan_balance_tzs],
    ['total_group_assets', actual.total_group_assets, expected.total_recorded_assets_tzs],
  ].map(([name, value, target]) => ({ name, actual: value, expected: target, status: value === target ? 'OK' : 'FAIL' }));
  console.table(checks);
  if (checks.some(check => check.status === 'FAIL')) process.exitCode = 1;
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
