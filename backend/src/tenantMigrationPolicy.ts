/**
 * Enforces the one-time tenant-004 no-backup exception.
 * Returns true when at least one tenant still needs tenant-004, false when
 * every tenant already has it. Any other pending migration remains a hard stop.
 */
export function hasAllowedNoBackupMigrationPending(
  pendingByTenant: string[][],
  targetMigration: string,
): boolean {
  let targetPending = false;
  for (const pending of pendingByTenant) {
    const unexpected = pending.filter((migration) => migration !== targetMigration);
    if (unexpected.length) {
      throw new Error('Refusing no-backup migration: other pending migration(s): ' + unexpected.join(', ') + '.');
    }
    if (pending.includes(targetMigration)) targetPending = true;
  }
  return targetPending;
}
