import type pg from 'pg';

type DbClient = pg.Client | pg.PoolClient;

/**
 * Ensure the per-business CRM retention policy exists after the tenant's
 * business row has been copied into its dedicated database. Tenant migrations
 * run before provisioning inserts that row, so migration 006 alone cannot
 * seed it for newly-created databases.
 */
export async function ensureCrmRetentionPolicy(db: DbClient, tenantId: string): Promise<void> {
  await db.query(
    `INSERT INTO public.crm_retention_policy (tenant_id, policy_started_at, legacy_grace_until)
     SELECT id, now(), now() + interval '30 days'
       FROM public.businesses
      WHERE id = $1
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  );

  // Also initialize legacy leads when this helper is used after copying an
  // existing business into a fresh tenant database.
  await db.query(
    `UPDATE public.leads l
        SET retention_closed_at = CASE
              WHEN l.status IN ('rejected', 'cancelled', 'completed')
                THEN COALESCE(l.retention_closed_at, p.policy_started_at)
              ELSE l.retention_closed_at
            END,
            retention_expires_at = CASE
              WHEN l.status IN ('rejected', 'cancelled', 'completed')
                THEN GREATEST(COALESCE(l.retention_closed_at, p.policy_started_at) + interval '30 days', p.legacy_grace_until)
              ELSE GREATEST(l.created_at + interval '60 days', p.legacy_grace_until)
            END
       FROM public.crm_retention_policy p
      WHERE l.tenant_id = p.tenant_id
        AND l.tenant_id = $1
        AND l.retention_expires_at IS NULL`,
    [tenantId],
  );
}
