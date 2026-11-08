import test from 'node:test';
import assert from 'node:assert/strict';
import { isTenantMigrationAuthorizedWithoutBackup } from '../src/tenantMigrationPolicy';

test('a verified backup authorizes tenant migrations', () => {
  assert.equal(isTenantMigrationAuthorizedWithoutBackup({ backupConfirmed: true }), true);
});

test('explicit workflow_dispatch approval authorizes all pending migrations', () => {
  assert.equal(isTenantMigrationAuthorizedWithoutBackup({
    backupConfirmed: false,
    githubEventName: 'workflow_dispatch',
    proceedWithoutBackup: 'true',
  }), true);
});

test('workflow_dispatch approval is not accepted on automatic push runs', () => {
  assert.equal(isTenantMigrationAuthorizedWithoutBackup({
    backupConfirmed: false,
    githubEventName: 'push',
    proceedWithoutBackup: 'true',
  }), false);
});

test('the Railway operator flag authorizes the deployment migration run', () => {
  assert.equal(isTenantMigrationAuthorizedWithoutBackup({
    backupConfirmed: false,
    railwayAllowWithoutBackup: 'true',
  }), true);
});

test('migration is blocked when neither backup nor explicit approval is present', () => {
  assert.equal(isTenantMigrationAuthorizedWithoutBackup({ backupConfirmed: false }), false);
});
