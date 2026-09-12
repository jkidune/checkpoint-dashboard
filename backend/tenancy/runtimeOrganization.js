// Phase 3 runtime organization allowlist.
//
// A registered Organization in the control plane is NOT automatically an
// enabled runtime tenant. Control-plane registration != runtime
// activation.
//
// Until every financial route has been migrated to req.tenantModels (a
// later phase), enabling a second runtime tenant would be unsafe: those
// routes still query the default/legacy connection directly, which today
// happens to be the exact same physical database as this one approved
// organization. Activating a second tenant before that migration would
// silently let one tenant's authenticated identity operate against
// another tenant's — or nobody's — actual financial data.
//
// This is a stable internal constant, not runtime-configurable input, and
// it must stay that way: it is never read from an environment variable,
// request, header, or database record that a deploy-time operator or a
// client could influence. Removing this single-tenant restriction is
// explicitly future work (see docs/multitenancy-architecture.md, Phase 4+:
// route-by-route tenant model migration).

const PHASE_3_RUNTIME_ORGANIZATION_ID = 'org_checkpoint_investors';

function isRuntimeOrganizationAllowed(organizationId) {
  return organizationId === PHASE_3_RUNTIME_ORGANIZATION_ID;
}

module.exports = { PHASE_3_RUNTIME_ORGANIZATION_ID, isRuntimeOrganizationAllowed };
