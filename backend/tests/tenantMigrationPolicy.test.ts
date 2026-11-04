import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAllowedNoBackupMigrationPending } from '../src/tenantMigrationPolicy';

const target = 'tenant-004-product-images-details.sql';

test('no-backup gate allows a no-op when tenant-004 is already applied everywhere', () => {
  assert.equal(hasAllowedNoBackupMigrationPending([[], [], []], target), false);
});

test('no-backup gate allows only the tenant-004 migration when it is pending', () => {
  assert.equal(hasAllowedNoBackupMigrationPending([[], [target], [target]], target), true);
});

test('no-backup gate still rejects any other pending migration', () => {
  assert.throws(
    () => hasAllowedNoBackupMigrationPending([[], ['tenant-005-another-change.sql']], target),
    /other pending migration/,
  );
});
