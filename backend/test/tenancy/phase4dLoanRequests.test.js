// Phase 4D isolation proof for /api/forms/loan-request: public submission
// tenant isolation (malicious org selectors rejected), alpha-only member
// matching, admin read/workbench/review/conversion isolation, and E2E flow.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4dTestApp, stopPhase4dTestApp } = require('./helpers/phase4dTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4dTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4dTestApp();
});

// ─── Helper to post a form request ───────────────────────────────────────────

function postFormRequest(baseUrl, body, formSecret, extraHeaders = {}) {
  const headers = { 'x-form-secret': formSecret, 'Content-Type': 'application/json' };
  Object.assign(headers, extraHeaders);
  return fetch(`${baseUrl}/api/forms/loan-request`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).then(async (res) => {
    let parsed = null;
    try { parsed = await res.json(); } catch { /* ok */ }
    return { status: res.status, body: parsed };
  });
}

// ─── Public POST tenant isolation ────────────────────────────────────────────

test('31. public POST with malicious org selectors lands ONLY in alpha tenant', async () => {
  const defaultReqCountBefore = await app.defaultModels.LoanRequestSubmission.countDocuments();
  const betaReqCountBefore = await app.beta.LoanRequestSubmission.countDocuments();

  // The payload includes organization_id: 'org_beta' — must be completely ignored.
  const { status, body } = await postFormRequest(app.baseUrl, {
    memberName: 'Tenant Alpha Form Member',
    amountRequested: 200000,
    requestedDate: `${app.CURRENT_FY}-07-01`,
    submittedAt: `${app.CURRENT_FY}-07-01T10:00:00Z`,
    committeeApproved: true,
    oathAccepted: true,
    // malicious selectors — must have NO effect
    organization_id: 'org_beta',
    organizationId: 'org_beta',
  }, app.TEST_FORM_SECRET, {
    'x-organization-id': 'org_beta',
    'X-Organization-Id': 'org_beta',
  });

  assert.equal(status, 201, `Public POST failed: ${JSON.stringify(body)}`);
  assert.equal(body.staged, true);

  // Submission landed in ALPHA, not default or beta
  const alphaReq = await app.alpha.LoanRequestSubmission.findOne({ source_id: body.request?.source_id });
  assert.ok(alphaReq, 'submission must be in alpha LoanRequestSubmission');

  // Default DB count unchanged (sentinel still has records from setup)
  assert.equal(
    await app.defaultModels.LoanRequestSubmission.countDocuments(),
    defaultReqCountBefore,
    'default DB LoanRequestSubmission count must not change'
  );
  // Beta unchanged
  assert.equal(
    await app.beta.LoanRequestSubmission.countDocuments(),
    betaReqCountBefore,
    'beta must be untouched'
  );

  // Save for later tests
  app._publicSubmissionSourceId = body.request?.source_id;
  app._publicSubmissionId = alphaReq?._id?.toString();
});

test('32. default same-name Member is ignored; alpha Member is matched', async () => {
  // The default DB now has a member named EXACTLY 'Tenant Alpha Form Member'
  // (defaultSameNameMember fixture) as well as the original sentinel with a different name.
  // The match must come from alpha's Member collection, not the default DB.
  const alphaReq = await app.alpha.LoanRequestSubmission.findOne({ source_id: app._publicSubmissionSourceId });
  assert.ok(alphaReq, 'submission must exist in alpha');

  // Hard assert: must be matched (not unmatched or ambiguous)
  assert.equal(alphaReq.match_status, 'matched',
    `Expected match_status 'matched' but got '${alphaReq.match_status}'`);

  // Must match the ALPHA form member (numeric id from alpha counter), not the default DB member
  assert.equal(
    Number(alphaReq.matched_member_id),
    app.alphaFormMember.id,
    `matched_member_id ${alphaReq.matched_member_id} must equal alphaFormMember.id ${app.alphaFormMember.id}`
  );

  // Must NOT match the default DB same-name member (numeric id 9999, distinct from alpha counter)
  assert.notEqual(
    Number(alphaReq.matched_member_id),
    app.defaultSameNameMember.id,
    `matched_member_id ${alphaReq.matched_member_id} must not equal defaultSameNameMember.id ${app.defaultSameNameMember.id}`
  );

  // Must NOT match the original default sentinel member
  assert.notEqual(
    String(alphaReq.matched_member_id),
    app.sentinelMember._id?.toString(),
    'must not match the default sentinel member'
  );
});

test('33. default same source_id does NOT trigger alpha duplicate detection', async () => {
  // The default DB sentinel LoanRequestSubmission has source_id 'loan-request:default-db-sentinel'
  // which is a different source_id. A second submission with the same payload as test 31
  // should be detected as a duplicate in ALPHA (same source_id computation), not because
  // of the default DB sentinel.
  const { status, body } = await postFormRequest(app.baseUrl, {
    memberName: 'Tenant Alpha Form Member',
    amountRequested: 200000,
    requestedDate: `${app.CURRENT_FY}-07-01`,
    submittedAt: `${app.CURRENT_FY}-07-01T10:00:00Z`,
    committeeApproved: true,
    oathAccepted: true,
    organization_id: 'org_beta', // ignored
  }, app.TEST_FORM_SECRET);

  // Second submission with same payload → alpha duplicate detected, 200 with duplicate flag
  assert.equal(status, 200);
  assert.equal(body.duplicate_submission, true);
  assert.ok(body.request, 'duplicate response must include the existing request');
});

// ─── Tenant resolution status contract ──────────────────────────────────────

test('33a. invalid FORM_SECRET → 401; tenant resolution never runs (even when org is suspended)', async () => {
  // formAuth middleware fires before resolveApprovedRuntimeTenant.
  // The org is explicitly suspended here so that — if formAuth were incorrectly bypassed —
  // tenant resolution would return 403. Getting 401 proves formAuth gates the route first.
  const { getOrganizationModel } = require('../../tenancy/organizationRegistry');
  const OrgModel = await getOrganizationModel();

  await OrgModel.findOneAndUpdate(
    { organization_id: 'org_checkpoint_investors' },
    { $set: { status: 'suspended' } }
  );

  let caughtStatus;
  try {
    const { status } = await postFormRequest(app.baseUrl, {
      memberName: 'Tenant Alpha Form Member',
      amountRequested: 100000,
      requestedDate: `${app.CURRENT_FY}-07-01`,
    }, 'WRONG-SECRET-INVALID');
    caughtStatus = status;
  } finally {
    await OrgModel.findOneAndUpdate(
      { organization_id: 'org_checkpoint_investors' },
      { $set: { status: 'active' } }
    );
  }
  assert.equal(caughtStatus, 401, `Expected 401 for invalid form secret (org suspended), got ${caughtStatus}`);
});

test('33b. suspended organization → 403 (TenantResolutionError status preserved)', async () => {
  // Temporarily set org_checkpoint_investors to 'suspended'.
  // resolveApprovedRuntimeTenant() will throw TenantResolutionError(403).
  // The route must forward that 403, not convert it to 500.
  const { getOrganizationModel } = require('../../tenancy/organizationRegistry');
  const OrgModel = await getOrganizationModel();

  await OrgModel.findOneAndUpdate(
    { organization_id: 'org_checkpoint_investors' },
    { $set: { status: 'suspended' } }
  );

  let caughtStatus;
  try {
    const { status } = await postFormRequest(app.baseUrl, {
      memberName: 'Tenant Alpha Form Member',
      amountRequested: 100000,
      requestedDate: `${app.CURRENT_FY}-07-01`,
    }, app.TEST_FORM_SECRET);
    caughtStatus = status;
  } finally {
    // Always restore to active so subsequent tests are not affected
    await OrgModel.findOneAndUpdate(
      { organization_id: 'org_checkpoint_investors' },
      { $set: { status: 'active' } }
    );
  }
  assert.equal(caughtStatus, 403,
    `Expected 403 for suspended org, got ${caughtStatus} — TenantResolutionError status code was not preserved`);
});

// ─── Source_id real collision test ───────────────────────────────────────────

test('33c. source_id only in default DB does NOT prevent alpha from creating a new record', async () => {
  const collisionSourceId = 'phase4d-default-only-source-collision';

  // Default DB already has this source_id (from setup fixture defaultCollisionSubmission)
  const defaultRecord = await app.defaultModels.LoanRequestSubmission.findOne({ source_id: collisionSourceId }).lean();
  assert.ok(defaultRecord, 'default DB must have the collision source_id fixture');
  assert.equal(defaultRecord.amount_requested, 99999, 'default fixture amount must match setup value');

  // Alpha must NOT have this source_id
  const alphaRecordBefore = await app.alpha.LoanRequestSubmission.findOne({ source_id: collisionSourceId }).lean();
  assert.ok(!alphaRecordBefore, 'alpha must NOT have this source_id before the test');

  // POST #1: alpha creates a new record (source_id exists in default but not in alpha)
  const { status: s1, body: b1 } = await postFormRequest(app.baseUrl, {
    memberName: 'Tenant Alpha Form Member',
    amountRequested: 150000,
    requestedDate: `${app.CURRENT_FY}-09-01`,
    submittedAt: `${app.CURRENT_FY}-09-01T08:00:00Z`,
    sourceId: collisionSourceId,
  }, app.TEST_FORM_SECRET);
  assert.equal(s1, 201, `POST #1 should create a new alpha record, got: ${JSON.stringify(b1)}`);
  assert.equal(b1.staged, true);

  // Alpha now has this source_id
  const alphaRecordAfter = await app.alpha.LoanRequestSubmission.findOne({ source_id: collisionSourceId }).lean();
  assert.ok(alphaRecordAfter, 'alpha must now have the submission after POST #1');

  // POST #2: same payload → alpha detects its OWN duplicate (not cross-DB)
  const { status: s2, body: b2 } = await postFormRequest(app.baseUrl, {
    memberName: 'Tenant Alpha Form Member',
    amountRequested: 150000,
    requestedDate: `${app.CURRENT_FY}-09-01`,
    submittedAt: `${app.CURRENT_FY}-09-01T08:00:00Z`,
    sourceId: collisionSourceId,
  }, app.TEST_FORM_SECRET);
  assert.equal(s2, 200, `POST #2 should detect alpha duplicate, got: ${JSON.stringify(b2)}`);
  assert.equal(b2.duplicate_submission, true, 'second POST must be flagged as duplicate');

  // Default DB record must be unchanged (amount 99999, not overwritten)
  const defaultRecordAfter = await app.defaultModels.LoanRequestSubmission.findOne({ source_id: collisionSourceId }).lean();
  assert.equal(defaultRecordAfter.amount_requested, 99999, 'default DB record must remain unchanged');
});

// ─── 11000 race-recovery proofs ──────────────────────────────────────────────

test('33d. race-condition 11000: winning writer inserted first → 200 with non-null request', async () => {
  // Simulate: another writer won the race between the pre-check findOne and create().
  // The intercepted create() actually inserts the record first, then throws 11000,
  // proving that the route's 11000 handler returns the real existing record instead
  // of a false 200 with request: null.
  const raceSourceId = 'phase4d-race-recovery-11000-test';

  // Precondition: alpha must not already have this source_id
  const before = await app.alpha.LoanRequestSubmission.findOne({ source_id: raceSourceId }).lean();
  assert.ok(!before, 'alpha must not have this source_id before the race test');

  const origCreate = app.alpha.LoanRequestSubmission.create;
  try {
    app.alpha.LoanRequestSubmission.create = async function interceptedCreate(...args) {
      // Step 1: actually insert the record so the recovery findOne will find it
      await origCreate.apply(app.alpha.LoanRequestSubmission, args);
      // Step 2: simulate the race loser: throw 11000 as if another writer won
      const err = new Error('E11000 duplicate key error (simulated race)');
      err.code = 11000;
      throw err;
    };

    const { status, body } = await postFormRequest(app.baseUrl, {
      memberName: 'Tenant Alpha Form Member',
      amountRequested: 180000,
      requestedDate: `${app.CURRENT_FY}-08-01`,
      committeeApproved: true,
      oathAccepted: true,
      sourceId: raceSourceId,
    }, app.TEST_FORM_SECRET);

    assert.equal(status, 200, `Expected 200 (race recovery), got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true, 'success must be true');
    assert.equal(body.duplicate_submission, true, 'duplicate_submission must be true');
    assert.ok(body.request !== null && body.request !== undefined,
      `request must be non-null in race-recovery response, got: ${JSON.stringify(body.request)}`);
    assert.equal(body.request.source_id, raceSourceId,
      `request.source_id must equal the race source_id`);
  } finally {
    app.alpha.LoanRequestSubmission.create = origCreate;
  }

  // Exactly one alpha record with this source_id (the one the intercepted create() inserted)
  const alphaCount = await app.alpha.LoanRequestSubmission.countDocuments({ source_id: raceSourceId });
  assert.equal(alphaCount, 1, 'exactly one alpha record must exist for the race source_id');

  // Default DB untouched (no record with this source_id)
  const defaultRecord = await app.defaultModels.LoanRequestSubmission.findOne({ source_id: raceSourceId }).lean();
  assert.ok(!defaultRecord, 'default DB must not have the race source_id record');

  // Beta untouched
  assert.equal(
    await app.beta.LoanRequestSubmission.countDocuments(),
    app.betaCountsBefore.loanRequest,
    'beta must be untouched after race-recovery test'
  );
});

test('33e. unverifiable 11000 (record never inserted) → 500, not false 200', async () => {
  // Simulate: create() throws 11000 WITHOUT actually inserting any record.
  // The route's recovery findOne returns null → must return 500, not 200 with request: null.
  const unverifiableSourceId = 'phase4d-unverifiable-11000-test';

  // Precondition: alpha must not already have this source_id
  const before = await app.alpha.LoanRequestSubmission.findOne({ source_id: unverifiableSourceId }).lean();
  assert.ok(!before, 'alpha must not have this source_id before the unverifiable test');

  const origCreate = app.alpha.LoanRequestSubmission.create;
  try {
    app.alpha.LoanRequestSubmission.create = async function interceptedCreate() {
      // Throw 11000 without inserting anything — simulates a genuine uniqueness failure
      // with no surviving record in alpha (e.g., error before the write landed)
      const err = new Error('E11000 duplicate key error (simulated unverifiable)');
      err.code = 11000;
      throw err;
    };

    const { status, body } = await postFormRequest(app.baseUrl, {
      memberName: 'Tenant Alpha Form Member',
      amountRequested: 160000,
      requestedDate: `${app.CURRENT_FY}-08-15`,
      committeeApproved: true,
      oathAccepted: true,
      sourceId: unverifiableSourceId,
    }, app.TEST_FORM_SECRET);

    assert.equal(status, 500,
      `Expected 500 for unverifiable 11000, got ${status}: ${JSON.stringify(body)}`);
    // Explicitly guard: must NOT be a false 200 duplicate success with request: null
    assert.notEqual(status, 200, 'must not return 200 for an unverifiable duplicate');
  } finally {
    app.alpha.LoanRequestSubmission.create = origCreate;
  }

  // Alpha must have no record with this source_id (the intercepted create never inserted)
  const alphaCount = await app.alpha.LoanRequestSubmission.countDocuments({ source_id: unverifiableSourceId });
  assert.equal(alphaCount, 0, 'alpha must have no record for the unverifiable source_id');
});

test('34. tenant_beta untouched after all public submissions', async () => {
  assert.equal(
    await app.beta.LoanRequestSubmission.countDocuments(),
    app.betaCountsBefore.loanRequest,
    'beta LoanRequestSubmission count must be unchanged'
  );
});

// ─── Admin list/workbench isolation ─────────────────────────────────────────

test('35. admin GET /api/forms/loan-request uses alpha LoanRequestSubmissions only', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/forms/loan-request', app.adminToken);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));

  // The default DB sentinel has source_id 'loan-request:default-db-sentinel' — must not appear
  const sourceIds = body.map((r) => r.source_id);
  assert.ok(!sourceIds.includes('loan-request:default-db-sentinel'), 'default DB sentinel submission must not appear');

  // Our alpha submission must appear
  if (app._publicSubmissionSourceId) {
    assert.ok(sourceIds.includes(app._publicSubmissionSourceId), 'alpha submission must appear in admin list');
  }
});

test('36. workbench uses alpha financial data; default sentinel absent', async () => {
  assert.ok(app._publicSubmissionId, 'publicSubmissionId must be set from test 31');
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/forms/loan-request/${app._publicSubmissionId}/workbench`,
    app.adminToken
  );
  assert.equal(status, 200);
  assert.ok(body.request);
  assert.ok(body.assessment);

  // Eligibility must come from alpha (12 × 75000 = 900000 contributions), not default sentinel (9999999)
  if (body.request.match_status === 'matched' && body.assessment.eligibility) {
    assert.equal(body.assessment.eligibility.total_contributions, 900000,
      'eligibility must use alpha contributions');
    assert.notEqual(body.assessment.eligibility.total_contributions, 9999999 + 900000,
      'default sentinel contributions must not be included');
  }
});

test('37. review/acceptance uses alpha data', async () => {
  assert.ok(app._publicSubmissionId, 'publicSubmissionId must be set from test 31');

  // First, reject it to ensure review endpoint works
  const { status: rejectStatus } = await patchJson(
    app.baseUrl,
    `/api/forms/loan-request/${app._publicSubmissionId}/review`,
    { status: 'rejected', note: 'Phase 4D test rejection' },
    app.adminToken
  );
  assert.ok([200, 409].includes(rejectStatus));

  // Then set back to pending
  const { status: pendingStatus } = await patchJson(
    app.baseUrl,
    `/api/forms/loan-request/${app._publicSubmissionId}/review`,
    { status: 'pending' },
    app.adminToken
  );
  assert.ok([200, 409].includes(pendingStatus));

  // Try to accept — may be blocked if member matching failed or assessment fails
  const { status: acceptStatus, body: acceptBody } = await patchJson(
    app.baseUrl,
    `/api/forms/loan-request/${app._publicSubmissionId}/review`,
    { status: 'accepted' },
    app.adminToken
  );
  // If blocked (409), that's fine — the assessment used alpha data
  if (acceptStatus === 409) {
    assert.ok(acceptBody.assessment, 'blocked accept must include assessment from alpha data');
    // No sentinel fine should block it (only alpha blocking items)
    const unpaidFineTotals = (acceptBody.assessment.unpaid_fines || []).map((f) => f.amount);
    assert.ok(!unpaidFineTotals.includes(8888888), 'default sentinel fine must not appear in assessment blockers');
  } else {
    assert.equal(acceptStatus, 200);
    app._acceptedSubmissionId = app._publicSubmissionId;
  }
});

// ─── Conversion isolation ─────────────────────────────────────────────────────

test('38. conversion creates alpha pending Loan; no disbursement Transaction; LoanRequestSubmission updated in alpha', async () => {
  // Create a fresh submission that we can accept and convert
  const freshSubmission = await app.alpha.LoanRequestSubmission.create({
    source_id: `loan-request:phase4d-convert-test-${Date.now()}`,
    member_name: app.alphaFormMember.name,
    matched_member_id: app.alphaFormMember.id,
    match_status: 'matched',
    amount_requested: 200000,
    requested_date: `${app.CURRENT_FY}-08-01`,
    committee_approved: true,
    oath_accepted: true,
    review_status: 'pending',
  });
  const submissionId = freshSubmission._id.toString();

  // Accept it — must succeed; the fixture member is eligible (clean slate, fully contributed)
  const { status: acceptStatus, body: acceptBody } = await patchJson(
    app.baseUrl,
    `/api/forms/loan-request/${submissionId}/review`,
    { status: 'accepted' },
    app.adminToken
  );
  assert.equal(acceptStatus, 200, `Accept failed unexpectedly: ${JSON.stringify(acceptBody)}`);

  const defaultLoanCountBefore = await app.defaultModels.Loan.countDocuments();
  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();
  const alphaLoanCountBefore = await app.alpha.Loan.countDocuments();

  // Convert — must succeed since we just accepted it
  const { status, body } = await postJson(
    app.baseUrl,
    `/api/forms/loan-request/${submissionId}/convert`,
    {},
    app.adminToken
  );
  assert.equal(status, 201, `Convert failed unexpectedly: ${JSON.stringify(body)}`);

  assert.ok(body.loan, 'conversion must return the created loan');
  assert.equal(body.loan.status, 'pending');
  assert.equal(body.loan.disbursed, false);

  // loan_id from alpha counter
  assert.ok(body.loan.id < app.DEFAULT_DB_COUNTER_POISON, `loan_id ${body.loan.id} must come from alpha counter`);

  // Loan in alpha, not default DB
  const alphaLoan = await app.alpha.Loan.findOne({ id: body.loan.id });
  assert.ok(alphaLoan, 'converted loan must exist in alpha');
  assert.equal(alphaLoan.status, 'pending');

  // No disbursement Transaction created (pending loan, not yet activated)
  const alphaLoanTx = await app.alpha.Transaction.findOne({
    type: 'loan_disbursement',
    member_id: app.alphaFormMember.id,
  });
  assert.ok(!alphaLoanTx, 'no disbursement Transaction should exist after conversion (pending loan)');

  // Default DB untouched
  assert.equal(await app.defaultModels.Loan.countDocuments(), defaultLoanCountBefore,
    'default DB loan count must not change');
  assert.equal(await app.defaultModels.Transaction.countDocuments(), defaultTxCountBefore,
    'default DB transaction count must not change');

  // LoanRequestSubmission updated in alpha
  const updatedReq = await app.alpha.LoanRequestSubmission.findById(submissionId).lean();
  assert.equal(updatedReq.review_status, 'converted');
  assert.equal(updatedReq.linked_loan_id, body.loan.id);

  app._convertedSubmissionId = submissionId;
  app._convertedLoanId = body.loan.id;
});

// ─── E2E: full submission → activation flow ──────────────────────────────────

test('39. E2E: public submission → accept → convert → activate → alpha active loan; default/beta untouched', async () => {
  // Step 1: Create a fresh E2E member (no active loans, fully contributed — eligible)
  const e2eMember = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha E2E Member',
    email: 'alpha-e2e-member@example.com',
    status: 'active',
    join_date: `${app.CURRENT_FY}-03-01`,
  });
  await app.seedFullFiscalYearContributions(e2eMember.id);

  const defaultLoanCountBefore = await app.defaultModels.Loan.countDocuments();
  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();
  const betaLoanCountBefore = await app.beta.Loan.countDocuments();
  const betaTxCountBefore = await app.beta.Transaction.countDocuments();

  // Step 2: Public submission (simulating Google Form)
  const submissionPayload = {
    memberName: e2eMember.name,
    amountRequested: 200000,
    requestedDate: `${app.CURRENT_FY}-09-01`,
    submittedAt: `${app.CURRENT_FY}-09-01T09:00:00Z`,
    committeeApproved: true,
    oathAccepted: true,
    disbursementPhone: '0712345678',
    purpose: 'E2E test loan',
  };
  const { status: s1, body: b1 } = await postFormRequest(
    app.baseUrl,
    submissionPayload,
    app.TEST_FORM_SECRET
  );
  assert.equal(s1, 201, `Public POST failed: ${JSON.stringify(b1)}`);
  assert.equal(b1.staged, true);

  const alphaSubmission = await app.alpha.LoanRequestSubmission.findOne({
    source_id: b1.request?.source_id
  }).lean();
  assert.ok(alphaSubmission, 'submission must exist in alpha');
  const submissionId = alphaSubmission._id.toString();

  // Step 3: Admin accepts
  const { status: s3, body: b3 } = await patchJson(
    app.baseUrl,
    `/api/forms/loan-request/${submissionId}/review`,
    { status: 'accepted' },
    app.adminToken
  );
  assert.equal(s3, 200, `Accept failed: ${JSON.stringify(b3)}`);

  // Step 4: Convert → pending loan
  const { status: s4, body: b4 } = await postJson(
    app.baseUrl,
    `/api/forms/loan-request/${submissionId}/convert`,
    {},
    app.adminToken
  );
  assert.equal(s4, 201, `Convert failed: ${JSON.stringify(b4)}`);
  const pendingLoanId = b4.loan.id;
  assert.equal(b4.loan.status, 'pending');
  assert.equal(b4.loan.disbursed, false);

  // Assert no disbursement Transaction yet (loan is still pending)
  const earlyTx = await app.alpha.Transaction.findOne({
    type: 'loan_disbursement',
    member_id: e2eMember.id,
  }).lean();
  assert.ok(!earlyTx, 'no disbursement Transaction must exist after conversion (loan is pending)');

  // Step 5: Activate (handled by loanActivationHotfix.js)
  const { status: s5, body: b5 } = await patchJson(
    app.baseUrl,
    `/api/loans/${pendingLoanId}`,
    { status: 'active' },
    app.adminToken
  );
  assert.equal(s5, 200, `Activation failed: ${JSON.stringify(b5)}`);
  assert.equal(b5.status, 'active');
  assert.equal(b5.disbursed, true);
  assert.ok(b5.approval_assessment, 'must include approval_assessment');
  assert.equal(b5.approval_assessment.eligible, true);

  // Alpha loan is active
  const activeLoan = await app.alpha.Loan.findOne({ id: pendingLoanId }).lean();
  assert.ok(activeLoan, 'loan must be in alpha');
  assert.equal(activeLoan.status, 'active');
  assert.equal(activeLoan.disbursed, true);

  // Exactly one disbursement Transaction in alpha
  const allTx = await app.alpha.Transaction.find({
    type: 'loan_disbursement',
    member_id: e2eMember.id,
  }).lean();
  assert.equal(allTx.length, 1, 'exactly one disbursement transaction must exist after activation');
  assert.ok(allTx[0].id < app.DEFAULT_DB_COUNTER_POISON, 'transaction_id from alpha counter');

  // Default DB untouched throughout
  assert.equal(await app.defaultModels.Loan.countDocuments(), defaultLoanCountBefore,
    'default DB loan count must be unchanged');
  assert.equal(await app.defaultModels.Transaction.countDocuments(), defaultTxCountBefore,
    'default DB transaction count must be unchanged');

  // Beta untouched throughout
  assert.equal(await app.beta.Loan.countDocuments(), betaLoanCountBefore,
    'beta loan count must be unchanged');
  assert.equal(await app.beta.Transaction.countDocuments(), betaTxCountBefore,
    'beta transaction count must be unchanged');
});
