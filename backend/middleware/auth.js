const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'checkpoint_secret_2026';

const { PHASE_3_RUNTIME_ORGANIZATION_ID } = require('../tenancy/runtimeOrganization');
const { resolveRuntimeTenant, TenantResolutionError } = require('../tenancy/resolveRuntimeTenant');

// Temporary Phase 3 migration compatibility: tokens issued before
// organization_id existed on the JWT payload are still accepted (their
// signature/expiry is still verified normally) and are treated as
// belonging to the sole Phase 3 runtime organization. This only ever
// applies to a token that verifies successfully and simply predates the
// organization_id claim — a token carrying an explicit, wrong
// organization_id never falls back to this; it is rejected on its own
// merits by the Phase 3 runtime allowlist.
//
// This should be turned off (set ALLOW_LEGACY_ORGLESS_TOKENS=false, or
// remove this fallback entirely in a later phase) once at least one full
// token TTL (currently 7 days — see routes/auth.js's jwt.sign expiresIn)
// has elapsed after this phase's deployment, so that every token in
// circulation is guaranteed to already carry organization_id.
const ALLOW_LEGACY_ORGLESS_TOKENS = process.env.ALLOW_LEGACY_ORGLESS_TOKENS !== 'false';

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // organization_id is read ONLY from the verified token payload — never
  // from req.body, req.query, or any request header. There is no code
  // path anywhere in this function that lets a client influence which
  // tenant a request resolves to.
  let organizationId = decoded.organization_id;

  if (organizationId === undefined || organizationId === null) {
    if (!ALLOW_LEGACY_ORGLESS_TOKENS) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    organizationId = PHASE_3_RUNTIME_ORGANIZATION_ID;
  }

  try {
    const { tenant, tenantModels } = await resolveRuntimeTenant(organizationId);
    req.user = { ...decoded, organization_id: organizationId };
    req.tenant = tenant; // { organization_id, name, slug, status } — no database_name
    req.tenantModels = tenantModels;
    next();
  } catch (err) {
    if (err instanceof TenantResolutionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[auth] unexpected tenant resolution error:', err);
    return res.status(503).json({ error: 'Tenant resolution is temporarily unavailable' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Lets the request through if the caller is an admin, or if the resource's
// member_id (resolved per-route via getMemberId) matches the caller's own.
function requireSelfOrAdmin(getMemberId) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    if (req.user?.member_id != null && req.user.member_id === getMemberId(req)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { authenticate, requireAdmin, requireSelfOrAdmin, JWT_SECRET };
