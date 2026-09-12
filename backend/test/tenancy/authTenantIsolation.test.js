// Proves every authentication data-access path — login, signup,
// change-password, set-email, forgot-password, reset-password — actually
// reads and writes only Tenant #1's (org_checkpoint_investors) collections,
// and that Tenant Beta's collections are never touched by any of it.
//
// Test order matters here (node:test runs a file's tests sequentially in
// declaration order): the login/signup/forgot-password/reset-password
// tests run first, in that order, because reset-password changes
// alpha_admin's password and forgot-password needs the account's original
// email; set-email (which changes that same account's email) runs last so
// nothing after it depends on the original address. change-password and
// set-email each use their own dedicated throwaway fixtures, independent
// of alpha_admin, specifically so they don't have to worry about this
// ordering at all.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { startAuthTestApp, stopAuthTestApp, TEST_JWT_SECRET } = require('./helpers/authTestApp');

const JWT_SECRET = TEST_JWT_SECRET;
let app;

before(async () => {
  app = await startAuthTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopAuthTestApp();
});

function signToken(claims) {
  return jwt.sign({ organization_id: 'org_checkpoint_investors', ...claims }, JWT_SECRET, { expiresIn: '1h' });
}

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${app.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('10 & 11. login authenticates against Tenant #1 User and resolves the display name from Tenant #1 Member', async () => {
  const { status, body } = await postJson('/api/auth/login', { username: 'alpha_admin', password: 'AlphaPass123' });
  assert.equal(status, 200);
  assert.equal(body.user.username, 'alpha_admin');
  assert.equal(body.user.name, 'Alpha Admin'); // from tenant_alpha's Member, never tenant_beta's
  assert.equal(body.user.organization_id, 'org_checkpoint_investors');
});

test('12 & 13. signup creates a User only in Tenant #1; Tenant Beta User collection is untouched', async () => {
  const betaCountBefore = await app.beta.User.countDocuments();

  const { status, body } = await postJson('/api/auth/signup', {
    email_or_phone: 'alpha-new@example.com',
    username: 'alpha_new_user',
    password: 'NewPass123',
  });
  assert.equal(status, 201);
  assert.equal(body.user.organization_id, 'org_checkpoint_investors');

  const alphaUser = await app.alpha.User.findOne({ username: 'alpha_new_user' }).lean();
  assert.ok(alphaUser);

  const betaUser = await app.beta.User.findOne({ username: 'alpha_new_user' }).lean();
  assert.equal(betaUser, null);

  const betaCountAfter = await app.beta.User.countDocuments();
  assert.equal(betaCountAfter, betaCountBefore);
});

test('16. forgot-password creates a PasswordResetToken only in Tenant #1', async () => {
  const alphaCountBefore = await app.alpha.PasswordResetToken.countDocuments();
  const betaCountBefore = await app.beta.PasswordResetToken.countDocuments();

  const res = await fetch(`${app.baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alpha-admin@example.com' }),
  });
  assert.equal(res.status, 200);

  const alphaCountAfter = await app.alpha.PasswordResetToken.countDocuments();
  const betaCountAfter = await app.beta.PasswordResetToken.countDocuments();
  assert.equal(alphaCountAfter, alphaCountBefore + 1);
  assert.equal(betaCountAfter, betaCountBefore);
});

test('17. reset-password resolves a token only against Tenant #1', async () => {
  const rawToken = 'test-raw-reset-token-alpha';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await app.alpha.PasswordResetToken.create({
    user_id: app.alphaAdminUser.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 60000),
  });

  const res = await fetch(`${app.baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: rawToken, new_password: 'AlphaResetPass1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const updatedAlphaUser = await app.alpha.User.findOne({ id: app.alphaAdminUser.id }).lean();
  assert.ok(bcrypt.compareSync('AlphaResetPass1', updatedAlphaUser.password_hash));

  // The same hash was never written anywhere in Beta's database.
  const betaTokenLookup = await app.beta.PasswordResetToken.findOne({ token_hash: tokenHash }).lean();
  assert.equal(betaTokenLookup, null);
});

test('18. the password-reset CommunicationLog record belongs only to Tenant #1', async () => {
  const alphaLog = await app.alpha.CommunicationLog.findOne({
    type: 'password_reset',
    recipient_email: 'alpha-admin@example.com',
  }).lean();
  assert.ok(alphaLog);

  const betaLog = await app.beta.CommunicationLog.findOne({ type: 'password_reset' }).lean();
  assert.equal(betaLog, null);
});

test('14. change-password modifies only the authenticated Tenant #1 User (dedicated fixture)', async () => {
  const cpUser = await app.alpha.User.create({
    id: await app.alpha.getNextId('user_id'),
    username: 'cp_test_user',
    password_hash: bcrypt.hashSync('OldPass123', 10),
    role: 'member',
    name: 'CP Test User',
  });
  const token = signToken({ id: cpUser.id, username: 'cp_test_user', role: 'member', member_id: null, name: 'CP Test User' });

  const betaHashBefore = (await app.beta.User.findOne({ username: 'beta_admin' }).lean()).password_hash;

  const res = await fetch(`${app.baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: 'OldPass123', new_password: 'NewPass456' }),
  });
  assert.equal(res.status, 200);

  const updated = await app.alpha.User.findOne({ id: cpUser.id }).lean();
  assert.ok(bcrypt.compareSync('NewPass456', updated.password_hash));

  const betaHashAfter = (await app.beta.User.findOne({ username: 'beta_admin' }).lean()).password_hash;
  assert.equal(betaHashAfter, betaHashBefore);
});

test('15. set-email modifies only Tenant #1 User/Member', async () => {
  const token = signToken({
    id: app.alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: app.alphaMember.id,
    name: 'Alpha Admin',
  });

  const betaMemberEmailBefore = (await app.beta.Member.findOne({ id: app.betaMember.id }).lean()).email;

  const res = await fetch(`${app.baseUrl}/api/auth/set-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: app.alphaAdminUser.id, email: 'alpha-admin-updated@example.com' }),
  });
  assert.equal(res.status, 200);

  const updatedUser = await app.alpha.User.findOne({ id: app.alphaAdminUser.id }).lean();
  assert.equal(updatedUser.email, 'alpha-admin-updated@example.com');
  const updatedMember = await app.alpha.Member.findOne({ id: app.alphaMember.id }).lean();
  assert.equal(updatedMember.email, 'alpha-admin-updated@example.com');

  const betaMemberEmailAfter = (await app.beta.Member.findOne({ id: app.betaMember.id }).lean()).email;
  assert.equal(betaMemberEmailAfter, betaMemberEmailBefore);
});

test('19. req.tenantModels.User.db.name points to the Tenant #1 database', async () => {
  const token = signToken({
    id: app.alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: app.alphaMember.id,
    name: 'Alpha Admin',
  });
  const res = await fetch(`${app.baseUrl}/__test/tenant-context`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.tenantModelsUserDbName, 'tenant_alpha');
});

test('20. req.tenant contains no database_name property', async () => {
  const token = signToken({
    id: app.alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: app.alphaMember.id,
    name: 'Alpha Admin',
  });
  const res = await fetch(`${app.baseUrl}/__test/tenant-context`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  assert.equal(body.tenant.database_name, undefined);
  assert.deepEqual(Object.keys(body.tenant).sort(), ['name', 'organization_id', 'slug', 'status']);
});
