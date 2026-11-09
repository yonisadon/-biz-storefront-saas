import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPendingTenantMigrations } from '../src/tenantMigrations';

test('all migration files are pending when the migration ledger does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-migrations-'));
  try {
    writeFileSync(join(dir, 'tenant-007-calendar-only-bookings.sql'), 'SELECT 1;');
    const db = { query: async () => ({ rows: [{ table_name: null }] }) } as never;
    assert.deepEqual(await getPendingTenantMigrations(db, dir), ['tenant-007-calendar-only-bookings.sql']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no migration approval is needed when every migration is already recorded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-migrations-'));
  try {
    writeFileSync(join(dir, 'tenant-007-calendar-only-bookings.sql'), 'SELECT 1;');
    const db = {
      query: async (sql: string) => sql.includes('to_regclass')
        ? { rows: [{ table_name: 'tenant_schema_migrations' }] }
        : { rows: [{ version: 'tenant-007-calendar-only-bookings.sql' }] },
    } as never;
    assert.deepEqual(await getPendingTenantMigrations(db, dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only migrations absent from the ledger are returned as pending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-migrations-'));
  try {
    writeFileSync(join(dir, 'tenant-006-crm-retention.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'tenant-007-calendar-only-bookings.sql'), 'SELECT 1;');
    const db = {
      query: async (sql: string) => sql.includes('to_regclass')
        ? { rows: [{ table_name: 'tenant_schema_migrations' }] }
        : { rows: [{ version: 'tenant-006-crm-retention.sql' }] },
    } as never;
    assert.deepEqual(await getPendingTenantMigrations(db, dir), ['tenant-007-calendar-only-bookings.sql']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
