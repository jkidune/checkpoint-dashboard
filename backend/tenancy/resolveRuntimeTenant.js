// Resolves an organization_id into a safe request-facing tenant summary
// plus its tenant model bundle — the trusted path authentication and the
// unauthenticated auth flows both go through:
//
//   organization_id
//           -> Phase 3 runtime allowlist (runtimeOrganization.js)
//           -> organizationRegistry.getOrganizationById()   (control plane)
//           -> organization.status === 'active'
//           -> getTenantModels({ organization_id })          (Phase 2)
//
// Fail-closed throughout: any failure raises a TenantResolutionError with
// an explicit HTTP status rather than falling back to a different tenant,
// the default database, or a permissive default. Callers (middleware/auth.js,
// routes/auth.js) are expected to catch TenantResolutionError and respond
// with err.statusCode; anything else is an unexpected error.
//
// Status code policy (documented here so it stays consistent everywhere
// this module is used):
//   403  organization_id does not match the Phase 3 allowlist. This
//        covers both "a real, registered, different organization" (e.g. a
//        token claiming org_beta) and "an organization_id that doesn't
//        exist at all" — both are simply not the one approved tenant, and
//        collapsing them avoids leaking which organization_ids exist.
//   403  the approved organization exists but is not status: 'active'
//        (suspended / archived / provisioning).
//   503  the approved organization_id is missing from the registry
//        entirely, or the control plane / tenant connection could not be
//        reached — these are infrastructure/configuration failures, not
//        something wrong with the caller's credential.
//
// (401 for invalid/expired JWTs is handled one layer up, in
// middleware/auth.js, before this module is ever called.)

const { getOrganizationById } = require('./organizationRegistry');
const { getTenantModels } = require('./tenantModels');
const { PHASE_3_RUNTIME_ORGANIZATION_ID, isRuntimeOrganizationAllowed } = require('./runtimeOrganization');

class TenantResolutionError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'TenantResolutionError';
    this.statusCode = statusCode;
  }
}

/**
 * @param {string} organizationId
 * @returns {Promise<{ tenant: { organization_id: string, name: string, slug: string, status: string }, tenantModels: object }>}
 */
async function resolveRuntimeTenant(organizationId) {
  if (!isRuntimeOrganizationAllowed(organizationId)) {
    throw new TenantResolutionError(
      `Organization "${organizationId}" is not a permitted runtime tenant in this phase.`,
      403
    );
  }

  let organization;
  try {
    organization = await getOrganizationById(organizationId);
  } catch (err) {
    throw new TenantResolutionError('Tenant resolution is temporarily unavailable.', 503);
  }

  if (!organization) {
    // The one allowed organization_id isn't registered — a deployment/
    // configuration problem, not a credential problem.
    throw new TenantResolutionError('Tenant resolution is temporarily unavailable.', 503);
  }

  if (organization.status !== 'active') {
    throw new TenantResolutionError(
      `Organization "${organizationId}" is not active (status: ${organization.status}).`,
      403
    );
  }

  let tenantModels;
  try {
    tenantModels = await getTenantModels({ organization_id: organizationId });
  } catch (err) {
    throw new TenantResolutionError('Tenant resolution is temporarily unavailable.', 503);
  }

  return {
    tenant: {
      organization_id: organization.organization_id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
    },
    tenantModels,
  };
}

/**
 * Convenience for the unauthenticated auth flows (login, signup,
 * forgot-password, reset-password), which have no JWT yet to read an
 * organization_id from and must resolve the sole Phase 3 runtime
 * organization server-side instead.
 */
async function resolveApprovedRuntimeTenant() {
  return resolveRuntimeTenant(PHASE_3_RUNTIME_ORGANIZATION_ID);
}

module.exports = { resolveRuntimeTenant, resolveApprovedRuntimeTenant, TenantResolutionError };
