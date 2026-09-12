// Canonical, connection-scoped auto-increment counter.
//
// Replaces mongoose-sequence, which is incompatible with Mongoose v7+.
// Uses a single "auto_counters" collection to safely track the last ID per
// model — same as before Phase 2, EXCEPT that the Counter model and every
// getNextId() function are now always bound to one specific connection,
// never to the global `mongoose` singleton implicitly.
//
// CRITICAL INVARIANT (multi-tenancy): a tenant's `auto_counters` collection
// must live inside that tenant's own database. getNextId() allocates from
// whatever connection it was created for — pass it the default connection
// and you get the legacy behavior exactly as before; pass it a tenant
// connection and that tenant gets its own, entirely independent sequence
// space. There is no shared/global Counter anywhere in this module.

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false, collection: 'auto_counters' }
);

/**
 * Returns the Counter model registered on the given connection, reusing an
 * already-registered one instead of re-registering (never throws
 * OverwriteModelError).
 *
 * @param {import('mongoose').Connection} connection
 */
function getCounterModel(connection) {
  return connection.models.Counter || connection.model('Counter', counterSchema);
}

// Connection-scoped cache: WeakMap keyed by the Connection object itself,
// so it never grows unbounded and never outlives the connection it's keyed
// on (garbage-collected along with it). This is the "safe connection-scoped
// cache" the tenancy architecture calls for, as opposed to an ever-growing
// plain Map keyed by something like a database name string.
const getNextIdCache = new WeakMap();

/**
 * Builds a getNextId(name) function whose Counter documents live in the
 * same database as `connection`. Two different connections' getNextId
 * functions never share sequence state, by construction — each closes over
 * its own connection's Counter model. Repeated calls for the same
 * connection return the exact same function instance.
 *
 * @param {import('mongoose').Connection} connection
 * @returns {(name: string) => Promise<number>}
 */
function createGetNextId(connection) {
  if (getNextIdCache.has(connection)) {
    return getNextIdCache.get(connection);
  }

  const Counter = getCounterModel(connection);

  const getNextId = async function getNextId(name) {
    const counter = await Counter.findByIdAndUpdate(
      name,
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true }
    );
    return counter.seq;
  };

  getNextIdCache.set(connection, getNextId);
  return getNextId;
}

/**
 * Attaches a pre('save') auto-increment hook to `schema` using the given
 * connection-bound getNextId(). Most existing routes pre-compute `id` via
 * getNextId() directly before calling .create(), so this hook mainly exists
 * as a fallback for any document saved without an id already set — but it
 * must still draw from the *same* counter space those routes use, which is
 * why `getNextId` is always passed in explicitly rather than imported from
 * a fixed module-level default.
 *
 * @param {import('mongoose').Schema} schema
 * @param {string} counterName
 * @param {(name: string) => Promise<number>} getNextId
 */
function addAutoIncrement(schema, counterName, getNextId) {
  schema.pre('save', async function attachAutoIncrementId() {
    if (this.isNew && (this.id === undefined || this.id === null)) {
      this.id = await getNextId(counterName);
    }
  });
}

module.exports = { counterSchema, getCounterModel, createGetNextId, addAutoIncrement };
