type RlsQueryable = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
};

const rlsExpectations: Array<{ table: string; policy: string }> = [
  { table: 'businesses', policy: 'tenant_isolation' },
  { table: 'media_assets', policy: 'tenant_isolation' },
  { table: 'products', policy: 'tenant_isolation' },
  { table: 'product_images', policy: 'tenant_isolation' },
  { table: 'portfolio_images', policy: 'tenant_isolation' },
  { table: 'leads', policy: 'tenant_isolation' },
  { table: 'lead_items', policy: 'tenant_isolation' },
  { table: 'lead_notes', policy: 'tenant_isolation' },
  { table: 'appointments', policy: 'tenant_isolation' },
  { table: 'appointment_blocks', policy: 'tenant_isolation' },
  { table: 'business_domains', policy: 'tenant_read' },
  { table: 'access_tokens', policy: '' },
  { table: 'waitlist_entries', policy: 'tenant_isolation' },
  { table: 'google_calendar_connections', policy: 'tenant_isolation' },
  { table: 'google_calendar_oauth_states', policy: 'tenant_isolation' },
  { table: 'google_calendar_sync_jobs', policy: 'tenant_isolation' },
  { table: 'push_settings', policy: 'tenant_isolation' },
  { table: 'push_subscriptions', policy: 'tenant_isolation' },
  { table: 'push_target_link_capabilities', policy: 'tenant_isolation' },
  { table: 'push_subscription_targets', policy: 'tenant_isolation' },
  { table: 'push_device_consents', policy: 'tenant_isolation' },
  { table: 'push_outbox', policy: 'tenant_isolation' },
  { table: 'push_deliveries', policy: 'tenant_isolation' },
];

/** Fail closed if any tenant-owned table is missing FORCE RLS or its expected policy. */
export async function assertTenantRlsSecurity(db: RlsQueryable, databaseName: string): Promise<void> {
  const result = await db.query(
    `SELECT expected.table_name, expected.policy_name,
            c.relrowsecurity, c.relforcerowsecurity,
            CASE
              WHEN expected.policy_name = '' THEN NOT EXISTS (
                SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = expected.table_name
              )
              WHEN expected.policy_name = 'tenant_read' THEN EXISTS (
                SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = expected.table_name
                   AND p.policyname = expected.policy_name
                   AND p.roles::text[] @> ARRAY['app_runtime']::text[]
                   AND p.qual LIKE '%current_tenant_id%'
                   AND p.with_check IS NULL
              )
              ELSE EXISTS (
                SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = expected.table_name
                   AND p.policyname = expected.policy_name
                   AND p.roles::text[] @> ARRAY['app_runtime']::text[]
                   AND p.qual LIKE '%current_tenant_id%'
                   AND p.with_check LIKE '%current_tenant_id%'
              )
            END AS policy_ok
       FROM unnest($1::text[], $2::text[]) AS expected(table_name, policy_name)
       LEFT JOIN pg_class c
         ON c.relnamespace = 'public'::regnamespace
        AND c.relname = expected.table_name AND c.relkind = 'r'`,
    [rlsExpectations.map((item) => item.table), rlsExpectations.map((item) => item.policy)],
  );
  const failures = result.rows.filter((row: {
    relrowsecurity: boolean | null; relforcerowsecurity: boolean | null; policy_ok: boolean;
  }) => !row.relrowsecurity || !row.relforcerowsecurity || !row.policy_ok);
  if (result.rows.length !== rlsExpectations.length || failures.length) {
    const failedTables = failures.map((row: { table_name: string }) => row.table_name);
    throw new Error(`Postflight failed for ${databaseName}: RLS is missing or incorrectly scoped on ${failedTables.join(', ') || 'one or more tenant tables'}.`);
  }
}
