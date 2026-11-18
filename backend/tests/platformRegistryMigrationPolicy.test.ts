import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformRegistryMigrationAuthorized } from '../src/platformRegistryMigrationPolicy';

test('a verified backup authorizes a registry migration', () => {
  assert.equal(isPlatformRegistryMigrationAuthorized({ backupConfirmed: true }), true);
});

test('an explicit manual workflow approval authorizes a no-backup migration', () => {
  assert.equal(isPlatformRegistryMigrationAuthorized({
    backupConfirmed: false,
    githubEventName: 'workflow_dispatch',
    proceedWithoutBackup: 'true',
  }), true);
});

test('the no-backup approval is rejected for automatic push events', () => {
  assert.equal(isPlatformRegistryMigrationAuthorized({
    backupConfirmed: false,
    githubEventName: 'push',
    proceedWithoutBackup: 'true',
  }), false);
});

test('the migration is blocked when neither backup nor explicit approval exists', () => {
  assert.equal(isPlatformRegistryMigrationAuthorized({ backupConfirmed: false }), false);
});
