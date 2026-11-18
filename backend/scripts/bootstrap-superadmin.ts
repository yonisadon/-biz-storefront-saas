import pg from 'pg';

async function main() {
  const [rawEmail, confirmation] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!email || confirmation !== '--confirm-first-superadmin') {
    throw new Error('usage: npm run bootstrap-superadmin -- <verified-owner-email> --confirm-first-superadmin');
  }
  if (!process.env.SUPERADMIN_DATABASE_URL) {
    throw new Error('SUPERADMIN_DATABASE_URL is required; use the central platform Registry database only.');
  }

  const db = new pg.Client({
    connectionString: process.env.SUPERADMIN_DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  await db.connect();
  try {
    await db.query('BEGIN');

    const existingAdmins = await db.query(
      "SELECT count(*)::int AS count FROM public.platform_users WHERE role = 'super_admin' AND disabled_at IS NULL",
    );
    if (Number(existingAdmins.rows[0]?.count ?? 0) > 0) {
      throw new Error('A super-admin account already exists; first-admin bootstrap is permanently closed.');
    }

    const selected = await db.query(
      `SELECT id, email, role, email_verified_at, disabled_at
         FROM public.platform_users
        WHERE email = $1
        FOR UPDATE`,
      [email],
    );
    const user = selected.rows[0];
    if (!user) throw new Error('No registered account was found for this email. Register and verify the email first.');
    if (user.role !== 'owner') throw new Error('Only a regular owner account can be promoted.');
    if (!user.email_verified_at) throw new Error('The account email must be verified before promotion.');
    if (user.disabled_at) throw new Error('A disabled account cannot be promoted.');

    const linkedBusiness = await db.query(
      'SELECT 1 FROM public.platform_business_owners WHERE user_id = $1 LIMIT 1',
      [user.id],
    );
    if (linkedBusiness.rowCount) {
      throw new Error('The account already owns a business. Use a separate verified account for the platform administrator.');
    }

    await db.query(
      "UPDATE public.platform_users SET role = 'super_admin', updated_at = now() WHERE id = $1",
      [user.id],
    );
    await db.query(
      'UPDATE public.platform_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1',
      [user.id],
    );
    await db.query(
      `INSERT INTO public.platform_audit_log (actor_type, actor_user_id, actor_email, action, metadata)
       VALUES ('system', $1, $2, 'first_super_admin_bootstrapped', $3::jsonb)`,
      [user.id, email, JSON.stringify({ bootstrap: 'one_time_first_admin' })],
    );

    await db.query('COMMIT');
    process.stdout.write(`Promoted verified account ${email} to the first super_admin. Sign in at /login.\n`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  process.exitCode = 1;
});
