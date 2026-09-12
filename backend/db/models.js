// Default/legacy connection compatibility layer.
//
// Field/index/default definitions live in ./tenantSchemas.js (the one
// canonical source). This file's only job is BINDING: it takes those
// schema definitions and registers them as Mongoose models on the
// application's default connection (`mongoose.connection` — the same
// connection ./mongoose.js's connectDB() establishes against MONGO_URI),
// then exports them exactly as before Phase 2.
//
// Existing routes that do `require('../db/models')` get back the exact
// same shape they always have — same model names, same collection names,
// same getNextId() behavior, same indexes. Nothing about existing runtime
// behavior changes.
//
// `bindCoreModels(connection)` is also exported so the tenant model
// registry (backend/tenancy/tenantModels.js) can bind these same schema
// definitions onto a *different* connection — one per tenant — without
// duplicating a single field, default, or index anywhere.

const mongoose = require('mongoose');
const { createGetNextId, getCounterModel } = require('./counter');
const { createCoreTenantSchemas } = require('./tenantSchemas');

/**
 * Binds every core tenant-owned model to `connection` and returns them,
 * along with a getNextId() function and Counter model scoped to that same
 * connection. Safe to call more than once for the same connection — model
 * registration reuses `connection.models` instead of re-registering.
 *
 * @param {import('mongoose').Connection} connection
 */
function bindCoreModels(connection) {
  const getNextId = createGetNextId(connection);
  const Counter = getCounterModel(connection);
  const schemas = createCoreTenantSchemas({ getNextId });

  const Member = connection.models.Member || connection.model('Member', schemas.memberSchema);
  const Contribution =
    connection.models.Contribution || connection.model('Contribution', schemas.contributionSchema);
  const Loan = connection.models.Loan || connection.model('Loan', schemas.loanSchema);
  // Export key is "Repayment" but the model/collection name has always been
  // "LoanRepayment" — preserved exactly for collection-name parity.
  const Repayment = connection.models.LoanRepayment || connection.model('LoanRepayment', schemas.repaymentSchema);
  const Transaction =
    connection.models.Transaction || connection.model('Transaction', schemas.transactionSchema);
  const User = connection.models.User || connection.model('User', schemas.userSchema);
  const Fine = connection.models.Fine || connection.model('Fine', schemas.fineSchema);
  const WelfareEvent =
    connection.models.WelfareEvent || connection.model('WelfareEvent', schemas.welfareSchema);
  const FyRules = connection.models.FyRules || connection.model('FyRules', schemas.fyRulesSchema);
  const Expense = connection.models.Expense || connection.model('Expense', schemas.expenseSchema);
  const Investment =
    connection.models.Investment || connection.model('Investment', schemas.investmentSchema);
  const NavUpdate = connection.models.NavUpdate || connection.model('NavUpdate', schemas.navUpdateSchema);
  const Notification =
    connection.models.Notification || connection.model('Notification', schemas.notificationSchema);
  const ReconciliationRun =
    connection.models.ReconciliationRun ||
    connection.model('ReconciliationRun', schemas.reconciliationRunSchema);
  const AuditSourceRecord =
    connection.models.AuditSourceRecord ||
    connection.model('AuditSourceRecord', schemas.auditSourceRecordSchema);

  return {
    getNextId,
    Counter,
    Member,
    Contribution,
    Loan,
    Repayment,
    Transaction,
    User,
    Fine,
    WelfareEvent,
    FyRules,
    Expense,
    Investment,
    NavUpdate,
    Notification,
    ReconciliationRun,
    AuditSourceRecord,
  };
}

// Default/legacy compatibility exports — bound to the application's
// default connection, exactly as before Phase 2. `mongoose.connection` is
// the same default Connection object `mongoose.connect()` (called from
// ./mongoose.js) resolves against, whether or not it has connected yet at
// the time this module is first required (model registration does not
// require an active connection).
const defaultModels = bindCoreModels(mongoose.connection);

module.exports = {
  ...defaultModels,
  bindCoreModels,
};
