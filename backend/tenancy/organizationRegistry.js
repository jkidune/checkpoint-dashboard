// The single, trusted access point for organization records.
//
// Nothing outside this file should import controlModels.js directly to
// touch the Organization collection. Centralizing access here is what lets
// tenantConnection.js's safety guarantee hold: a database name can only
// ever reach `useDb()` after passing through one of these lookups (or the
// bootstrap script, which also goes through here to create the record).

const { getControlConnection } = require('./controlDb');
const { getControlModels } = require('./controlModels');

async function getOrganizationModel() {
  const connection = await getControlConnection();
  const { Organization } = getControlModels(connection);
  return Organization;
}

async function getOrganizationById(organizationId) {
  if (!organizationId) return null;
  const Organization = await getOrganizationModel();
  return Organization.findOne({ organization_id: organizationId }).lean();
}

async function getOrganizationBySlug(slug) {
  if (!slug) return null;
  const Organization = await getOrganizationModel();
  return Organization.findOne({ slug: String(slug).toLowerCase() }).lean();
}

async function getOrganizationByDatabaseName(databaseName) {
  if (!databaseName) return null;
  const Organization = await getOrganizationModel();
  return Organization.findOne({ database_name: databaseName }).lean();
}

async function listActiveOrganizations() {
  const Organization = await getOrganizationModel();
  return Organization.find({ status: 'active' }).lean();
}

/**
 * Creates exactly one organization registry document. Used only by the
 * legacy bootstrap script today; a future self-serve provisioning flow
 * would also go through here rather than touching controlModels.js
 * directly.
 */
async function createOrganization(data) {
  const Organization = await getOrganizationModel();
  const doc = await Organization.create(data);
  return doc.toObject();
}

module.exports = {
  getOrganizationModel,
  getOrganizationById,
  getOrganizationBySlug,
  getOrganizationByDatabaseName,
  listActiveOrganizations,
  createOrganization,
};
