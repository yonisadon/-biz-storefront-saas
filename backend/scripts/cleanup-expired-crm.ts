import pg from 'pg';

const registryUrl = process.env.APP_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
if (!registryUrl) throw new Error('APP_DATABASE_URL is required');

type PlanCode = 'standard' | 'plus';
type PolicyRow = {
  plan_code: PlanCode; record_type: 'lead' | 'appointment' | 'waitlist' | 'push';
  record_status: string; delete_enabled: boolean; retention_days: number | null;
};
type Tenant = { tenant_id: string; database_name: string; plan_code: PlanCode };
type TenantPolicy = Record<string, number | null>;

const statuses = [
  'lead:open', 'lead:closed', 'appointment:reserved', 'appointment:cancelled',
  'waitlist:waiting', 'waitlist:rejected', 'waitlist:closed', 'waitlist:scheduled_without_booking', 'push:completed',
];

function databaseUrl(name: string): string {
  const url = new URL(registryUrl!); url.pathname = '/' + name; return url.toString();
}
function expectedDatabaseName(id: string): string { return 'biz_' + id.replace(/-/g, '').slice(0, 24); }
const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
  '57P03', '08001', '08006',
]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(url: string, label: string): Promise<pg.Client> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      if (attempt > 1) console.log('Connected to ' + label + ' after ' + attempt + ' attempts.');
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === maxAttempts) {
        console.error('Database connection failed for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + (code ?? 'unknown') + ').');
        throw error;
      }
      const delayMs = Math.min(1000 * attempt, 5000);
      console.warn('Database connection not ready for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + code + '); retrying in ' + delayMs + 'ms.');
      await sleep(delayMs);
    }
  }
  throw new Error('PostgreSQL connection did not become available for ' + label + '.');
}

// A successful TCP/PostgreSQL handshake is not enough on a waking Railway
// database: the first SQL statement can still fail while the service starts.
// Probe before acquiring the advisory lock so cleanup never begins half-ready.
async function connectReadyWithRetry(url: string, label: string): Promise<pg.Client> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await connectWithRetry(url, label);
    try {
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === maxAttempts) throw error;
      const delayMs = Math.min(1000 * attempt, 3000);
      console.warn('Database accepted a connection but is not ready for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + code + '); retrying in ' + delayMs + 'ms.');
      await sleep(delayMs);
    }
  }
  throw new Error('PostgreSQL did not become ready for ' + label + '.');
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
    pushHistory: getDays(get('push:completed')),
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
  const registry = await connectReadyWithRetry(registryUrl!, 'tenant registry');
  const tenantConnections = new Map<string, pg.Client>();
  let lockAcquired = false;
  let leadsDeleted = 0, leadsFound = 0, appointmentsDeleted = 0, appointmentsFound = 0;
  let waitlistDeleted = 0, waitlistFound = 0;
  let pushHistoryDeleted = 0, pushHistoryFound = 0;
  try {
    const lock = await registry.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [74122, 93002]);
    if (!lock.rows[0]?.locked) {
      console.log('CRM cleanup skipped: another cleanup run already holds the lock.');
      return;
    }
    lockAcquired = true;
    const tenantResult = await registry.query(
      'SELECT td.tenant_id, td.database_name, app.get_tenant_plan_code(td.tenant_id) AS plan_code FROM app.tenant_databases td JOIN public.businesses b ON b.id = td.tenant_id WHERE b.status = \'active\' ORDER BY td.tenant_id',
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
      let preflightPassed = false;
      for (let preflightAttempt = 1; preflightAttempt <= 3; preflightAttempt++) {
        const db = await connectWithRetry(databaseUrl(tenant.database_name), 'preflight for ' + tenant.database_name);
        tenantConnections.set(tenant.database_name, db);
        try {
  const check = await db.query(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='retention_closed_at') AS has_closed_at, " +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='retention_opened_at') AS has_opened_at, " +
            "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_tenant_id_lead_id_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (lead_id)%') AS preserves_appointments, " +
            "to_regclass('public.waitlist_entries') IS NOT NULL AS has_waitlist, " +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='appointment_id') AS has_waitlist_link, " +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='lead_id') AS has_waitlist_lead_link, " +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='preferred_time') AS has_preferred_time, " +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='status_changed_at') AS has_status_changed_at, " +
            "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.waitlist_entries') AND conname='waitlist_entries_tenant_appointment_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (appointment_id)%') AS has_waitlist_fk, " +
            "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.waitlist_entries') AND conname='waitlist_entries_tenant_lead_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (lead_id)%') AS preserves_waitlist_leads, " +
            "to_regclass('public.push_outbox') IS NOT NULL AS has_push_outbox, " +
            "to_regclass('public.push_deliveries') IS NOT NULL AS has_push_deliveries, " +
            "to_regclass('public.push_subscription_targets') IS NOT NULL AS has_push_targets, " +
            "to_regclass('public.push_target_link_capabilities') IS NOT NULL AS has_push_capabilities, " +
            "to_regclass('public.idx_push_outbox_processed_at') IS NOT NULL AS has_push_retention_index"
          );
          const c = check.rows[0];
          if (!c?.has_closed_at || !c?.has_opened_at || !c?.preserves_appointments || !c?.has_waitlist || !c?.has_waitlist_link ||
              !c?.has_preferred_time || !c?.has_status_changed_at || !c?.has_waitlist_fk || !c?.has_waitlist_lead_link || !c?.preserves_waitlist_leads ||
              !c?.has_push_outbox || !c?.has_push_deliveries || !c?.has_push_targets || !c?.has_push_capabilities || !c?.has_push_retention_index) {
            throw new Error('Required configurable-retention migrations are incomplete.');
          }
          preflightPassed = true;
          break;
        } catch (error) {
          await db.end().catch(() => {});
          tenantConnections.delete(tenant.database_name);
          const code = (error as { code?: string }).code;
          if (!code || !TRANSIENT_DB_CODES.has(code) || preflightAttempt === 3) {
            throw new Error('CRM cleanup preflight failed for ' + tenant.database_name + ': ' + (error instanceof Error ? error.message : String(error)));
          }
          const delayMs = Math.min(1000 * preflightAttempt, 3000);
          console.warn('Transient preflight failure for ' + tenant.database_name + ' (attempt ' + preflightAttempt + '/3; code ' + code + '); reconnecting in ' + delayMs + 'ms.');
          await sleep(delayMs);
        }
      }
      if (!preflightPassed) throw new Error('CRM cleanup preflight did not complete for ' + tenant.database_name + '.');
    }
    console.log('Retention cleanup preflight passed for ' + tenants.length + ' tenant database(s).');

    for (const tenant of tenants) {
      const p = policies.get(tenant.plan_code);
      if (!p) throw new Error('No retention policy for tenant plan; refusing cleanup.');
      const db = tenantConnections.get(tenant.database_name);
      if (!db) throw new Error('CRM cleanup connection missing after successful preflight for ' + tenant.database_name + '.');
      try {
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '30000', true)", [tenant.tenant_id]);

        const leadWhere = "(status IN ('rejected','cancelled','completed') AND $1::int IS NOT NULL AND retention_closed_at IS NOT NULL AND retention_closed_at + ($1::int * interval '1 day') <= now()) " +
          "OR (status NOT IN ('rejected','cancelled','completed') AND $2::int IS NOT NULL AND retention_opened_at IS NOT NULL AND retention_opened_at + ($2::int * interval '1 day') <= now())";
        const leadParams = [p.leadClosed, p.leadOpen];
        const leadCount = await db.query('SELECT count(*)::int AS n FROM public.leads WHERE ' + leadWhere, leadParams);

        // Do not remove a target while its outbox event or any delivery is still
        // pending/processing. Cancellation notifications must finish first.
        const appointmentWhere = "((a.status = 'reserved' AND $1::int IS NOT NULL AND a.end_at + ($1::int * interval '1 day') <= now()) " +
          "OR (a.status = 'cancelled' AND $2::int IS NOT NULL AND a.status_changed_at + ($2::int * interval '1 day') <= now())) " +
          "AND NOT EXISTS (SELECT 1 FROM public.push_outbox o WHERE o.tenant_id = app.current_tenant_id() AND o.target_type = 'appointment' AND o.target_id = a.id " +
          "AND (o.status IN ('pending','processing') OR EXISTS (SELECT 1 FROM public.push_deliveries d WHERE d.tenant_id = o.tenant_id AND d.outbox_id = o.id AND d.status IN ('pending','processing'))))";
        const appointmentParams = [p.appointmentReserved, p.appointmentCancelled];
        const appointmentCount = await db.query('SELECT count(*)::int AS n FROM public.appointments a WHERE ' + appointmentWhere, appointmentParams);

        const waitlistWhere = "((w.status = 'waiting' AND $1::int IS NOT NULL AND ((w.preferred_date + COALESCE(w.preferred_time, TIME '23:59:59')) AT TIME ZONE b.timezone) + ($1::int * interval '1 day') <= now()) " +
          "OR (w.status = 'rejected' AND $2::int IS NOT NULL AND w.updated_at + ($2::int * interval '1 day') <= now()) " +
          "OR (w.status = 'closed' AND $3::int IS NOT NULL AND w.updated_at + ($3::int * interval '1 day') <= now()) " +
          "OR (w.status = 'scheduled_without_booking' AND $4::int IS NOT NULL AND w.updated_at + ($4::int * interval '1 day') <= now())) " +
          "AND NOT EXISTS (SELECT 1 FROM public.push_outbox o WHERE o.tenant_id = app.current_tenant_id() AND o.target_type = 'waitlist' AND o.target_id = w.id " +
          "AND (o.status IN ('pending','processing') OR EXISTS (SELECT 1 FROM public.push_deliveries d WHERE d.tenant_id = o.tenant_id AND d.outbox_id = o.id AND d.status IN ('pending','processing'))))";
        const waitlistParams = [p.waitlistWaiting, p.waitlistRejected, p.waitlistClosed, p.waitlistScheduled];
        const waitlistFrom = 'public.waitlist_entries w JOIN public.businesses b ON b.id = w.tenant_id WHERE w.tenant_id = app.current_tenant_id() AND (' + waitlistWhere + ')';
        const waitlistCount = await db.query('SELECT count(*)::int AS n FROM ' + waitlistFrom, waitlistParams);

        // Keep completed Push history for the configured period. The explicit delivery guard
        // protects retries even if an event's outbox status is unexpectedly inconsistent.
        const pushHistoryWhere = "o.tenant_id = app.current_tenant_id() AND o.status = 'done' AND o.processed_at IS NOT NULL " +
          "AND $1::int IS NOT NULL AND o.processed_at <= now() - ($1::int * interval '1 day') " +
          "AND NOT EXISTS (SELECT 1 FROM public.push_deliveries d WHERE d.tenant_id = o.tenant_id " +
          "AND d.outbox_id = o.id AND d.status IN ('pending','processing'))";
        const pushHistoryCount = await db.query('SELECT count(*)::int AS n FROM public.push_outbox o WHERE ' + pushHistoryWhere, [p.pushHistory]);

        let tenantLeadsDeleted = 0, tenantAppointmentsDeleted = 0, tenantWaitlistDeleted = 0, tenantPushHistoryDeleted = 0;
        if (apply) {
          const deletedWaitlist = await db.query(
            'DELETE FROM public.waitlist_entries w WHERE w.id IN (' +
            'SELECT w2.id FROM public.waitlist_entries w2 JOIN public.businesses b ON b.id = w2.tenant_id ' +
            'WHERE w2.tenant_id = app.current_tenant_id() AND (' + waitlistWhere.replaceAll('w.', 'w2.') + ')) RETURNING w.id',
            waitlistParams,
          );
          const deletedWaitlistIds = deletedWaitlist.rows.map((row: { id: string }) => row.id);
          tenantWaitlistDeleted = deletedWaitlistIds.length;
          const deletedAppointments = await db.query(
            'DELETE FROM public.appointments a WHERE ' + appointmentWhere + ' RETURNING a.id',
            appointmentParams,
          );
          const deletedAppointmentIds = deletedAppointments.rows.map((row: { id: string }) => row.id);
          tenantAppointmentsDeleted = deletedAppointmentIds.length;

          // These tables intentionally have no FK to appointments/waitlist because
          // they must survive long enough to deliver cancellation/scheduling events.
          // Once retention is eligible and no delivery is pending, remove the now
          // useless target links and short-lived capabilities.
          if (deletedWaitlistIds.length) {
            await db.query(
              "DELETE FROM public.push_subscription_targets WHERE tenant_id = app.current_tenant_id() AND target_type = 'waitlist' AND target_id = ANY($1::uuid[])",
              [deletedWaitlistIds],
            );
            await db.query(
              "DELETE FROM public.push_target_link_capabilities WHERE tenant_id = app.current_tenant_id() AND target_type = 'waitlist' AND target_id = ANY($1::uuid[])",
              [deletedWaitlistIds],
            );
          }
          if (deletedAppointmentIds.length) {
            await db.query(
              "DELETE FROM public.push_subscription_targets WHERE tenant_id = app.current_tenant_id() AND target_type = 'appointment' AND target_id = ANY($1::uuid[])",
              [deletedAppointmentIds],
            );
            await db.query(
              "DELETE FROM public.push_target_link_capabilities WHERE tenant_id = app.current_tenant_id() AND target_type = 'appointment' AND target_id = ANY($1::uuid[])",
              [deletedAppointmentIds],
            );
          }
          const deletedPushHistory = await db.query('DELETE FROM public.push_outbox o WHERE ' + pushHistoryWhere + ' RETURNING o.id', [p.pushHistory]);
          tenantPushHistoryDeleted = deletedPushHistory.rowCount ?? 0;
          const deletedLeads = await db.query('DELETE FROM public.leads WHERE ' + leadWhere + ' RETURNING id', leadParams);
          tenantLeadsDeleted = deletedLeads.rowCount ?? 0;
        }
        await db.query('COMMIT');

        const foundLeads = Number(leadCount.rows[0]?.n ?? 0);
        const foundAppointments = Number(appointmentCount.rows[0]?.n ?? 0);
        const foundWaitlist = Number(waitlistCount.rows[0]?.n ?? 0);
        const foundPushHistory = Number(pushHistoryCount.rows[0]?.n ?? 0);
        leadsDeleted += tenantLeadsDeleted; leadsFound += foundLeads;
        appointmentsDeleted += tenantAppointmentsDeleted; appointmentsFound += foundAppointments;
        waitlistDeleted += tenantWaitlistDeleted; waitlistFound += foundWaitlist;
        pushHistoryDeleted += tenantPushHistoryDeleted; pushHistoryFound += foundPushHistory;
        console.log(tenant.database_name + ' (' + tenant.plan_code + '): ' +
          (apply ? 'deleted ' + tenantLeadsDeleted : 'would delete ' + foundLeads) + ' lead(s); ' +
          (apply ? 'deleted ' + tenantAppointmentsDeleted : 'would delete ' + foundAppointments) + ' appointment(s); ' +
          (apply ? 'deleted ' + tenantWaitlistDeleted : 'would delete ' + foundWaitlist) + ' waitlist request(s); ' +
          (apply ? 'deleted ' + tenantPushHistoryDeleted : 'would delete ' + foundPushHistory) + ' Push history event(s); ' +
          'Each record type is evaluated independently; foreign keys only detach links to deleted records.');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw new Error('CRM cleanup deletion failed for ' + tenant.database_name + ': ' + (error instanceof Error ? error.message : String(error)));
      }
    }
    console.log('Retention cleanup complete. Mode: ' + (apply ? 'APPLY' : 'DRY_RUN') +
      '; tenants: ' + tenants.length + '; leads deleted/found: ' + leadsDeleted + '/' + leadsFound +
      '; appointments deleted/found: ' + appointmentsDeleted + '/' + appointmentsFound +
      '; waitlist deleted/found: ' + waitlistDeleted + '/' + waitlistFound +
      '; Push history deleted/found: ' + pushHistoryDeleted + '/' + pushHistoryFound + '.');
      '; Push history deleted/found: ' + pushHistoryDeleted + '/' + pushHistoryFound + '.');
  } finally {
    await Promise.all([...tenantConnections.values()].map((db) => db.end().catch(() => {})));
    if (lockAcquired) {
      await registry.query('SELECT pg_advisory_unlock($1, $2)', [74122, 93002]).catch(() => {});
    }
    await registry.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
