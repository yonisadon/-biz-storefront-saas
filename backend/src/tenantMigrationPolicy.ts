export interface TenantMigrationApproval {
  backupConfirmed: boolean;
  githubEventName?: string;
  proceedWithoutBackup?: string;
  railwayAllowWithoutBackup?: string;
}

/**
 * A verified backup always authorizes migration. Without one, an explicit
 * GitHub workflow_dispatch input or the Railway operator flag is required.
 * The GitHub input is intentionally ignored for automatic push runs.
 */
export function isTenantMigrationAuthorizedWithoutBackup(
  approval: TenantMigrationApproval,
): boolean {
  return approval.backupConfirmed ||
    (approval.githubEventName === 'workflow_dispatch' &&
      approval.proceedWithoutBackup === 'true') ||
    approval.railwayAllowWithoutBackup === 'true';
}
