#!/usr/bin/env node
// Registers the pre-existing Checkpoint Investors Club as the first
// ("legacy") organization in the control database, WITHOUT touching any of
// its existing financial collections.
//
// Defaults to a dry run. Pass --apply to actually write the registry
// document.
//
//   node scripts/bootstrap-legacy-organization.js            (dry run)
//   node scripts/bootstrap-legacy-organization.js --apply    (writes)
//
// This script only ever reads connection metadata (which database the
// existing MONGO_URI connected to) — it never queries Member, Contribution,
// Loan, Fine, or any other tenant collection, and it never writes to the
// tenant database. The only write this script can ever perform is a single
// insert into the control database's `organizations` collection.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db/mongoose');
const { getControlConnection, CONTROL_DB_NAME } = require('../tenancy/controlDb');
const { getControlModels } = require('../tenancy/controlModels');
const { resolveLegacyTenantDatabaseName } = require('../tenancy/legacyTenant');

// Stable identity reserved for the existing club. See
// docs/multitenancy-architecture.md for why these values were chosen.
const LEGACY_ORGANIZATION = {
  organization_id: 'org_checkpoint_investors',
  name: 'Checkpoint Investors Club',
  slug: 'checkpoint-investors-club',
  legacy: true,
  status: 'active',
  country: 'Tanzania',
  currency: 'TZS',
  timezone: 'Africa/Dar_es_Salaam',
};

/**
 * Runs the bootstrap logic and returns a result object instead of touching
 * process.exit/console — that's what makes this testable in-process. The
 * CLI entry point at the bottom of this file is a thin wrapper around this.
 *
 * @param {{ apply?: boolean }} [options]
 */
async function run({ apply = false } = {}) {
  const baseConnection = await connectDB();
  const tenantDatabaseName = resolveLegacyTenantDatabaseName(baseConnection.connection);

  const proposedOrganization = {
    ...LEGACY_ORGANIZATION,
    database_name: tenantDatabaseName,
  };

  const controlConnection = await getControlConnection();
  const { Organization } = getControlModels(controlConnection);

  const [existingById, existingByDatabaseName, existingBySlug] = await Promise.all([
    Organization.findOne({ organization_id: proposedOrganization.organization_id }).lean(),
    Organization.findOne({ database_name: proposedOrganization.database_name }).lean(),
    Organization.findOne({ slug: proposedOrganization.slug }).lean(),
  ]);

  // "Identical" means the two identity-critical fields already line up: the
  // same organization_id is already mapped to the same database_name. Minor
  // metadata (name/country/etc.) drifting later is not this script's
  // concern — it only ever creates, never updates.
  const alreadyRegistered =
    existingById && existingById.database_name === proposedOrganization.database_name;

  if (alreadyRegistered) {
    return {
      mode: apply ? 'apply' : 'dry_run',
      status: 'already_registered',
      controlDatabaseName: CONTROL_DB_NAME,
      tenantDatabaseName,
      proposedOrganization,
      existingOrganization: existingById,
      conflicts: [],
    };
  }

  const conflicts = [];
  if (existingById && existingById.database_name !== proposedOrganization.database_name) {
    conflicts.push(
      `organization_id "${proposedOrganization.organization_id}" is already registered against ` +
      `database_name "${existingById.database_name}"`
    );
  }
  if (existingByDatabaseName && existingByDatabaseName.organization_id !== proposedOrganization.organization_id) {
    conflicts.push(
      `database_name "${proposedOrganization.database_name}" is already registered to organization_id ` +
      `"${existingByDatabaseName.organization_id}"`
    );
  }
  if (existingBySlug && existingBySlug.organization_id !== proposedOrganization.organization_id) {
    conflicts.push(
      `slug "${proposedOrganization.slug}" is already registered to organization_id ` +
      `"${existingBySlug.organization_id}"`
    );
  }

  if (conflicts.length > 0) {
    return {
      mode: apply ? 'apply' : 'dry_run',
      status: 'aborted',
      controlDatabaseName: CONTROL_DB_NAME,
      tenantDatabaseName,
      proposedOrganization,
      conflicts,
    };
  }

  if (!apply) {
    return {
      mode: 'dry_run',
      status: 'would_create',
      controlDatabaseName: CONTROL_DB_NAME,
      tenantDatabaseName,
      proposedOrganization,
      conflicts: [],
    };
  }

  const created = await Organization.create(proposedOrganization);

  return {
    mode: 'apply',
    status: 'created',
    controlDatabaseName: CONTROL_DB_NAME,
    tenantDatabaseName,
    proposedOrganization,
    organization: created.toObject(),
    conflicts: [],
  };
}

function printResult(result) {
  const modeLabel = result.mode === 'apply' ? 'APPLY' : 'DRY RUN';
  console.log(`Mode: ${modeLabel}`);
  console.log('');
  console.log('Existing tenant database:');
  console.log(`  ${result.tenantDatabaseName}`);
  console.log('');
  console.log('Control database:');
  console.log(`  ${result.controlDatabaseName}`);
  console.log('');
  console.log('Proposed organization:');
  console.log(`  organization_id: ${result.proposedOrganization.organization_id}`);
  console.log(`  name:            ${result.proposedOrganization.name}`);
  console.log(`  slug:            ${result.proposedOrganization.slug}`);
  console.log(`  database_name:   ${result.proposedOrganization.database_name}`);
  console.log(`  legacy:          ${result.proposedOrganization.legacy}`);
  console.log(`  status:          ${result.proposedOrganization.status}`);
  console.log('');

  switch (result.status) {
    case 'already_registered':
      console.log('Result: already_registered');
      console.log('No changes applied.');
      break;
    case 'would_create':
      console.log('Result: would_create');
      console.log('No changes applied. Re-run with --apply to create this organization record.');
      break;
    case 'created':
      console.log('Result: created');
      console.log(`Organization document _id: ${result.organization._id}`);
      break;
    case 'aborted':
      console.error('Result: ABORTED — a conflicting organization/database mapping already exists.');
      console.error("Refusing to guess which registry entry is correct — resolve the conflict manually.");
      for (const conflict of result.conflicts) {
        console.error(`  - ${conflict}`);
      }
      break;
    default:
      break;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await run({ apply });
  printResult(result);
  await mongoose.disconnect();
  process.exitCode = result.status === 'aborted' ? 1 : 0;
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Bootstrap failed:', err.message);
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected — nothing to clean up
    }
    process.exitCode = 1;
  });
}

module.exports = { run, LEGACY_ORGANIZATION };
