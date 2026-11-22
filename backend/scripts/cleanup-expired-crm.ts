import pg from 'pg';

const registryUrl = process.env.APP_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
if (!registryUrl) throw new Error('APP_DATABASE_URL is required');

type PlanCode = 'standard' | 'plus';
type PolicyRow = {
  plan_code: PlanCode; record_type: 'lead' | 'appointment' | 'waitlist';
  record_status: string; delete_enabled: boolean; retention_days: number | null;
};
type Tenant = { tenant_id: string; database_name: string; plan_code: PlanCode };
type TenantPolicy = Record<string, number | null>;

const statuses = [
  'lead:open', 'lead:closed', 'appointment:reserved', 'appointment:cancelled',
  'waitlist:waiting', 'waitlist:rejected', 'waitlist:closed', 'waitlist:scheduled_without_booking',
];

function databaseUrl(name: string): string {
  const url = new URL(registryUrl!); url.pathname = '/' + name; return url.toString();
}
function expectedDatabaseName(id: string): string { return 'biz_' + id.replace(/-/g, '').slice(0, 24); }
async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 5000 });
  await client.connect(); return client;
}
function getDays(row: PolicyRow | undefined): number | null {
  if (!row) throw new Error('Retention policy is incomplete; refusing cleanup.');
  if (!row.delete_enabled) return null;
  if (!Number.isInteger(row.retention_days) || !row.retention_days || row.retention_days < 1 || row.retention_days > 3650) {
    throw new Error('Invalid retention period; refusing cleanup.');
  }
  return row.retention_days;
}
function policyFor(plan: PlanCode, rows: PolicyRow[]): TenantPolicy {
  const byKey = new Map(rows.filter(r => r.plan_code === plan).map(r => [r.record_type + ':' + r.record_status, r]));
  const get = (key: string) => byKey.get(key);
  for (const key of statuses) if (!get(key)) throw new Error('Missing retention policy ' + plan + '/' + key + '; no data will be deleted.');
  return {
    leadOpen: getDays(get('lead:open')), leadClosed: getDays(get('lead:closed')),
    appointmentReserved: getDays(get('appointment:reserved')), appointmentCancelled: getDays(get('appointment:cancelled')),
    waitlistWaiting: getDays(get('waitlist:waiting')), waitlistRejected: getDays(get('waitlist:rejected')),
    waitlistClosed: getDays(get('waitlist:closed')), waitlistScheduled: getDays(get('waitlist:scheduled_without_booking')),
  };
}

async function main() {
  const expectedLocalHour = process.env.CRM_CLEANUP_LOCAL_HOUR;
  if (expectedLocalHour !== undefined && expectedLocalHour !== '') {
    const expected = Number(expectedLocalHour);
    if (!Number.isInteger(expected) || expected < 0 || expected > 23) throw new Error('CRM_CLEANUP_LOCAL_HOUR must be an hour from 0 to 23.');
    const zone = process.env.CRM_CLEANUP_TIMEZONE || 'Asia/Jerusalem';
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (localHour !== expected) {
      console.log('CRM cleanup skipped: local hour in ' + zone + ' is ' + String(localHour).padStart(2, '0') + '; expected ' + String(expected).padStart(2, '0') + '.');
      return;
    }
  }

  const apply = process.argv.includes('--apply');
  const registry = await connect(registryUrl!);
  let leadsDeleted = 0, leadsFound = 0, appointmentsDeleted = 0, appointmentsFound = 0;
  let waitlistDeleted = 0, waitlistFound = 0, appointmentsToUnlink = 0;
  try {
    const tenantResult = await registry.query(
      'SELECT td.tenant_id, td.database_name, app.get_tenant_plan_code(td.tenant_id) AS plan_code FROM app.tenant_databases td ORDER BY td.tenant_id',
    );
    const policyResult = await registry.query(
      'SELECT plan_code, record_type, record_status, delete_enabled, retention_days FROM public.platform_retention_policies',
    );
    const tenants = tenantResult.rows as Tenant[];
    const rows = policyResult.rows as PolicyRow[];
    const policies = new Map<PlanCode, TenantPolicy>([
      ['standard', policyFor('standard', rows)], ['plus', policyFor('plus', rows)],
    ]);

    // Check every tenant before the first destructive operation.
    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) throw new Error('Unexpected tenant database mapping; refusing cleanup.');
      if (tenant.plan_code !== 'standard' && tenant.plan_code !== 'plus') throw new Error('Unsupported tenant plan; refusing cleanup.');
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        const check = await db.query(
          "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='retention_closed_at') AS has_closed_at, " +
          "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_tenant_id_lead_id_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (lead_id)%') AS preserves_appointments, " +
          "to_regclass('public.waitlist_entries') IS NOT NULL AS has_waitlist, " +
          "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='appointment_id') AS has_waitlist_link, " +
          "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='preferred_time') AS has_preferred_time, " +
          "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='status_changed_at') AS has_status_changed_at, " +
          "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.waitlist_entries') AND conname='waitlist_entries_tenant_appointment_fkey') AS has_waitlist_fk",
        );
        const c = check.rows[0];
        if (!c?.has_closed_at || !c?.preserves_appointments || !c?.has_waitlist || !c?.has_waitlist_link ||
            !c?.has_preferred_time || !c?.has_status_changed_at || !c?.has_waitlist_fk) {
          throw new Error('Required configurable-retention migrations are incomplete for ' + tenant.database_name + '; no tenant rows were deleted.');
        }
      } finally { await db.end(); }
    }
    console.log('Retention cleanup preflight passed for ' + tenants.length + ' tenant database(s).');

    for (const tenant of tenants) {
      const p = policies.get(tenant.plan_code);
      if (!p) throw new Error('No retention policy for tenant plan; refusing cleanup.');
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '30000', true)", [tenant.tenant_id]);

        const leadWhere = "(status IN ('rejected','cancelled','completed') AND $1::int IS NOT NULL AND retention_closed_at IS NOT NULL AND retention_closed_at + ($1::int * interval '1 day') <= now()) " +
          "OR (status NOT IN ('rejected','cancelled','completed') AND $2::int IS NOT NULL AND created_at + ($2::int * interval '1 day') <= now())";
        const leadParams = [p.leadClosed, p.leadOpen];
        const leadCount = await db.query('SELECT count(*)::int AS n FROM public.leads WHERE ' + leadWhere, leadParams);

        const appointmentWhere = "(status = 'reserved' AND $1::int IS NOT NULL AND end_at + ($1::int * interval '1 day') <= now()) " +
          "OR (status = 'cancelled' AND $2::int IS NOT NULL AND status_changed_at + ($2::int * interval '1 day') <= now())";
        const appointmentParams = [p.appointmentReserved, p.appointmentCancelled];
        const appointmentCount = await db.query('SELECT count(*)::int AS n FROM public.appointments WHERE ' + appointmentWhere, appointmentParams);

        const waitlistWhere = "(w.status = 'waiting' AND $1::int IS NOT NULL AND ((w.preferred_date + COALESCE(w.preferred_time, TIME '23:59:59')) AT TIME ZONE b.timezone) + ($1::int * interval '1 day') <= now()) " +
          "OR (w.status = 'rejected' AND $2::int IS NOT NULL AND w.updated_at + ($2::int * interval '1 day') <= now()) " +
          "OR (w.status = 'closed' AND $3::int IS NOT NULL AND (CASE WHEN a.id IS NULL THEN w.updated_at WHEN a.status = 'reserved' THEN a.end_at WHEN a.status = 'cancelled' THEN a.status_changed_at ELSE w.updated_at END) + ($3::int * interval '1 day') <= now()) " +
          "OR (w.status = 'scheduled_without_booking' AND $4::int IS NOT NULL AND w.updated_at + ($4::int * interval '1 day') <= now())";
        const waitlistParams = [p.waitlistWaiting, p.waitlistRejected, p.waitlistClosed, p.waitlistScheduled];
        const waitlistFrom = 'public.waitlist_entries w JOIN public.businesses b ON b.id = w.tenant_id LEFT JOIN public.appointments a ON a.id = w.appointment_id AND a.tenant_id = w.tenant_id WHERE w.tenant_id = app.current_tenant_id() AND (' + waitlistWhere + ')';
        const waitlistCount = await db.query('SELECT count(*)::int AS n FROM ' + waitlistFrom, waitlistParams);

        const unlinkCount = await db.query(
          "SELECT count(*)::int AS n FROM public.appointments a JOIN public.leads l ON l.id = a.lead_id " +
          "WHERE a.status = 'reserved' AND ((l.status IN ('rejected','cancelled','completed') AND $1::int IS NOT NULL AND l.retention_closed_at IS NOT NULL AND l.retention_closed_at + ($1::int * interval '1 day') <= now()) " +
          "OR (l.status NOT IN ('rejected','cancelled','completed') AND $2::int IS NOT NULL AND l.created_at + ($2::int * interval '1 day') <= now()))",
          leadParams,
        );

        let tenantLeadsDeleted = 0, tenantAppointmentsDeleted = 0, tenantWaitlistDeleted = 0;
        if (apply) {
          const deletedWaitlist = await db.query(
            'DELETE FROM public.waitlist_entries w WHERE w.id IN (' +
            'SELECT w2.id FROM public.waitlist_entries w2 JOIN public.businesses b ON b.id = w2.tenant_id ' +
            'LEFT JOIN public.appointments a ON a.id = w2.appointment_id AND a.tenant_id = w2.tenant_id ' +
            'WHERE w2.tenant_id = app.current_tenant_id() AND (' + waitlistWhere.replaceAll('w.', 'w2.') + ')) RETURNING w.id',
            waitlistParams,
          );
          tenantWaitlistDeleted = deletedWaitlist.rowCount ?? 0;
          const deletedAppointments = await db.query('DELETE FROM public.appointments WHERE ' + appointmentWhere + ' RETURNING id', appointmentParams);
          tenantAppointmentsDeleted = deletedAppointments.rowCount ?? 0;
          const deletedLeads = await db.query('DELETE FROM public.leads WHERE ' + leadWhere + ' RETURNING id', leadParams);
          tenantLeadsDeleted = deletedLeads.rowCount ?? 0;
        }
        await db.query('COMMIT');

        const foundLeads = Number(leadCount.rows[0]?.n ?? 0);
        const foundAppointments = Number(appointmentCount.rows[0]?.n ?? 0);
        const foundWaitlist = Number(waitlistCount.rows[0]?.n ?? 0);
        const unlink = Number(unlinkCount.rows[0]?.n ?? 0);
        leadsDeleted += tenantLeadsDeleted; leadsFound += foundLeads;
        appointmentsDeleted += tenantAppointmentsDeleted; appointmentsFound += foundAppointments;
        waitlistDeleted += tenantWaitlistDeleted; waitlistFound += foundWaitlist;
        appointmentsToUnlink += unlink;
        console.log(tenant.database_name + ' (' + tenant.plan_code + '): ' +
          (apply ? 'deleted ' + tenantLeadsDeleted : 'would delete ' + foundLeads) + ' lead(s); ' +
          (apply ? 'deleted ' + tenantAppointmentsDeleted : 'would delete ' + foundAppointments) + ' appointment(s); ' +
          (apply ? 'deleted ' + tenantWaitlistDeleted : 'would delete ' + foundWaitlist) + ' waitlist request(s); ' +
          unlink + ' appointment(s) will be detached from expired CRM leads.');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw new Error('Retention cleanup failed for ' + tenant.database_name + ': ' + (error instanceof Error ? error.message : String(error)));
      } finally { await db.end(); }
    }
    console.log('Retention cleanup complete. Mode: ' + (apply ? 'APPLY' : 'DRY_RUN') +
      '; tenants: ' + tenants.length + '; leads deleted/found: ' + leadsDeleted + '/' + leadsFound +
      '; appointments deleted/found: ' + appointmentsDeleted + '/' + appointmentsFound +
      '; waitlist deleted/found: ' + waitlistDeleted + '/' + waitlistFound +
      '; appointments to unlink: ' + appointmentsToUnlink + '.');
  } finally { await registry.end(); }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
