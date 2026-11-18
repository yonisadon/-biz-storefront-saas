export interface PlatformRegistryMigrationApproval {
  backupConfirmed: boolean;
  githubEventName?: string;
  proceedWithoutBackup?: string;
}

/**
 * Registry migrations may run only after a verified backup or an explicit,
 * one-time approval supplied through a manual workflow_dispatch run.
 * Automatic push/deploy events can never authorize a no-backup migration.
 */
export function isPlatformRegistryMigrationAuthorized(
  approval: PlatformRegistryMigrationApproval,
): boolean {
  return approval.backupConfirmed ||
    (approval.githubEventName === 'workflow_dispatch' &&
      approval.proceedWithoutBackup === 'true');
}
