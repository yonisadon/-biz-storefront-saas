import pg from 'pg';

const registryUrl = process.env.APP_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
if (!registryUrl) throw new Error('APP_DATABASE_URL is required');

function databaseUrl(databaseName: string): string {
  const url = new URL(registryUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
function expectedDatabaseName(tenantId: string): string {
  return `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
}
async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function main() {
  // Railway cron schedules are UTC. The service can be scheduled for both
  // possible UTC hours that correspond to 01:00 in Israel; this guard makes
  // only the matching local-hour run perform the cleanup.
  const expectedLocalHour = process.env.CRM_CLEANUP_LOCAL_HOUR;
  if (expectedLocalHour) {
    const timeZone = process.env.CRM_CLEANUP_TIMEZONE || 'Asia/Jerusalem';
    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    if (localHour !== expectedLocalHour) {
      console.log(`CRM cleanup skipped: local hour in ${timeZone} is ${localHour}; expected ${expectedLocalHour}.`);
      return;
    }
  }

  const apply = process.argv.includes('--apply');
  const registry = await connect(registryUrl!);
  let totalLeadsDeleted = 0;
  let totalLeadsWouldDelete = 0;
  let totalAppointmentsToUnlink = 0;
  let totalAppointmentsDeleted = 0;
  let totalAppointmentsWouldDelete = 0;
  let totalWaitlistDeleted = 0;
  let totalWaitlistWouldDelete = 0;
  let totalLinkedWaitlistDeleted = 0;
  let totalLinkedWaitlistWouldDelete = 0;
  try {
    const result = await registry.query(
      'SELECT tenant_id, database_name FROM app.tenant_databases ORDER BY tenant_id',
    );
    const tenants = result.rows as { tenant_id: string; database_name: string }[];

    // Preflight every tenant before deleting anything from any tenant.
    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) {
        throw new Error(`Unexpected database mapping for tenant ${tenant.tenant_id}; refusing CRM cleanup.`);
      }
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        const required = await db.query(
          `SELECT
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='retention_expires_at') AS has_deadline,
             EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_tenant_id_lead_id_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (lead_id)%') AS preserves_appointments,
             to_regclass('public.waitlist_entries') IS NOT NULL AS has_waitlist,
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='appointment_id') AS has_waitlist_appointment_link,
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='status_changed_at') AS has_appointment_status_changed_at,
             EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.waitlist_entries') AND conname='waitlist_entries_tenant_appointment_fkey') AS has_waitlist_appointment_fk`,
        );
        if (!required.rows[0]?.has_deadline || !required.rows[0]?.preserves_appointments ||
            !required.rows[0]?.has_waitlist || !required.rows[0]?.has_waitlist_appointment_link ||
            !required.rows[0]?.has_appointment_status_changed_at || !required.rows[0]?.has_waitlist_appointment_fk) {
          throw new Error(`Required CRM/waitlist lifecycle migrations are incomplete for ${tenant.database_name}; no tenant rows were deleted.`);
        }
      } finally {
        await db.end();
      }
    }
    console.log(`CRM/waitlist cleanup preflight passed for ${tenants.length} tenant database(s).`);

    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) {
        throw new Error(`Unexpected database mapping for tenant ${tenant.tenant_id}; refusing CRM cleanup.`);
      }
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        await db.query('BEGIN');
        await db.query(
          "SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '30000', true)",
          [tenant.tenant_id],
        );
        // Expiring a CRM lead only detaches its lead_id from surviving appointments.
        // Appointment rows are deleted separately below only after their end_at has passed.
        const expired = await db.query(
          `SELECT count(*)::int AS n
             FROM public.leads
            WHERE retention_expires_at IS NOT NULL
              AND retention_expires_at <= now()`,
        );
        const expiredAppointments = await db.query(
          `SELECT count(*)::int AS n FROM public.appointments WHERE (status = 'reserved' AND end_at <= now() - interval '24 hours') OR (status = 'cancelled' AND status_changed_at <= now() - interval '24 hours')`,
        );
        const linkedWaitlistToDelete = await db.query(
          `SELECT count(*)::int AS n
             FROM public.waitlist_entries w
             JOIN public.appointments a ON a.id = w.appointment_id AND a.tenant_id = w.tenant_id
            WHERE w.status = 'closed' AND a.status = 'reserved' AND a.end_at <= now() - interval '24 hours'`,
        );
        const expiredWaitlist = await db.query(
          `SELECT count(*)::int AS n
             FROM public.waitlist_entries w
             JOIN public.businesses b ON b.id = w.tenant_id
            WHERE w.tenant_id = app.current_tenant_id()
              AND (
                (w.status = 'waiting'
                  AND ((w.preferred_date + COALESCE(w.preferred_time, TIME '23:59:59')) AT TIME ZONE b.timezone) <= now() - interval '24 hours')
                OR (w.status IN ('rejected', 'scheduled_without_booking') AND w.updated_at <= now() - interval '24 hours')
                OR (w.status = 'closed' AND w.appointment_id IS NULL AND w.updated_at <= now() - interval '24 hours')
                OR (w.status = 'closed' AND w.appointment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.appointments a
                     WHERE a.id = w.appointment_id AND a.tenant_id = w.tenant_id
                       AND a.status = 'reserved' AND a.end_at <= now() - interval '24 hours'
                ))
              )`,
        );
        const willUnlink = await db.query(
          `SELECT count(*)::int AS n
             FROM public.appointments a
             JOIN public.leads l ON l.id = a.lead_id
            WHERE l.retention_expires_at IS NOT NULL
              AND l.retention_expires_at <= now()
              AND a.status = 'reserved'`,
        );
        let deletedCount = 0;
        let appointmentsDeletedCount = 0;
        let waitlistDeletedCount = 0;
        let linkedWaitlistDeletedCount = 0;
        if (apply) {
          const deleted = await db.query(
            `DELETE FROM public.leads
              WHERE retention_expires_at IS NOT NULL
                AND retention_expires_at <= now()
              RETURNING id`,
          );
          deletedCount = deleted.rowCount ?? 0;
          const linkedWaitlistDeleted = await db.query(
            `DELETE FROM public.waitlist_entries w
              USING public.appointments a
              WHERE a.id = w.appointment_id
                AND a.tenant_id = w.tenant_id
                AND a.status = 'reserved'
                AND a.end_at <= now() - interval '24 hours'
                AND w.status = 'closed'
              RETURNING w.id`,
          );
          linkedWaitlistDeletedCount = linkedWaitlistDeleted.rowCount ?? 0;
          const appointmentsDeleted = await db.query(
            `DELETE FROM public.appointments WHERE (status = 'reserved' AND end_at <= now() - interval '24 hours') OR (status = 'cancelled' AND status_changed_at <= now() - interval '24 hours') RETURNING id`,
          );
          appointmentsDeletedCount = appointmentsDeleted.rowCount ?? 0;
          const waitlistDeleted = await db.query(
            `DELETE FROM public.waitlist_entries w
              WHERE w.tenant_id = app.current_tenant_id()
                AND (
                  (w.status = 'waiting' AND EXISTS (
                    SELECT 1 FROM public.businesses b
                     WHERE b.id = w.tenant_id
                       AND ((w.preferred_date + COALESCE(w.preferred_time, TIME '23:59:59')) AT TIME ZONE b.timezone) <= now() - interval '24 hours'
                  ))
                  OR (w.status IN ('rejected', 'scheduled_without_booking') AND w.updated_at <= now() - interval '24 hours')
                  OR (w.status = 'closed' AND w.appointment_id IS NULL AND w.updated_at <= now() - interval '24 hours')
                )
              RETURNING w.id`,
          );
          waitlistDeletedCount = waitlistDeleted.rowCount ?? 0;
        }
        await db.query('COMMIT');
        const expiredCount = Number(expired.rows[0]?.n ?? 0);
        const unlinkCount = Number(willUnlink.rows[0]?.n ?? 0);
        totalLeadsDeleted += deletedCount;
        totalLeadsWouldDelete += expiredCount;
        const appointmentsExpiredCount = Number(expiredAppointments.rows[0]?.n ?? 0);
        const waitlistExpiredCount = Number(expiredWaitlist.rows[0]?.n ?? 0);
        totalAppointmentsToUnlink += unlinkCount;
        totalAppointmentsDeleted += appointmentsDeletedCount;
        totalAppointmentsWouldDelete += appointmentsExpiredCount;
        totalWaitlistDeleted += waitlistDeletedCount;
        totalWaitlistWouldDelete += waitlistExpiredCount;
        totalLinkedWaitlistDeleted += linkedWaitlistDeletedCount;
        totalLinkedWaitlistWouldDelete += Number(linkedWaitlistToDelete.rows[0]?.n ?? 0);
        console.log(`${tenant.database_name}: ${apply ? `deleted ${deletedCount}` : `would delete ${expiredCount}`} CRM lead(s); ${apply ? `deleted ${appointmentsDeletedCount}` : `would delete ${appointmentsExpiredCount}`} expired appointment(s); ${apply ? `closed ${waitlistClosedCount}` : `would close ${Number(scheduledWaitlistToClose.rows[0]?.n ?? 0)}`} scheduled waitlist request(s); ${apply ? `deleted ${waitlistDeletedCount}` : `would delete ${waitlistExpiredCount}`} expired waitlist request(s); ${apply ? 'unlinked' : 'would unlink'} ${unlinkCount} reserved appointment(s) from expired CRM leads.`);
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw new Error(`CRM cleanup failed for ${tenant.database_name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await db.end();
      }
    }
    console.log(`Retention cleanup complete. Mode: ${apply ? 'APPLY' : 'DRY_RUN'}; tenants: ${tenants.length}; CRM leads deleted: ${totalLeadsDeleted}; expired CRM leads found: ${totalLeadsWouldDelete}; expired appointments deleted: ${totalAppointmentsDeleted}; expired appointments found: ${totalAppointmentsWouldDelete}; waitlist requests deleted: ${totalWaitlistDeleted}; expired waitlist requests found: ${totalWaitlistWouldDelete}; linked waitlist requests deleted: ${totalLinkedWaitlistDeleted}; linked waitlist requests to delete: ${totalLinkedWaitlistWouldDelete}; ${apply ? 'appointments unlinked' : 'appointments to unlink'} from expired leads: ${totalAppointmentsToUnlink}.`);
  } finally {
    await registry.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
