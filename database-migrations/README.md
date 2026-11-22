# Database migration directories

This directory contains legacy, one-off migrations for the original/central database schema. These files are **not automatically applied to each business-specific tenant database**.

For per-tenant schema changes:
- Add a numbered file matching `backend/migrations/tenant-NNN-name.sql`.
- Keep it additive and safe for existing rows.
- Apply it through `backend/src/tenantMigrations.ts`, which records successful migrations in each tenant database.
- Update `backend/migrations/tenant-schema.sql` for newly created tenant databases as well.
- Do not run legacy SQL against Railway or tenant databases without reviewing the target database and obtaining explicit approval.

The `migrate-tenant-schemas` command preflights all mapped tenant databases first. It performs a dry run by default. Actual changes require both `APPLY_TENANT_MIGRATIONS=true` and `TENANT_MIGRATION_BACKUP_CONFIRMED=true`, after a restorable backup has been verified and explicit approval has been granted.


## Central Platform Registry migrations

- Central Registry migrations live in `backend/migrations/000_tenant_registry.sql`, `backend/migrations/001_platform_accounts_subscriptions.sql`, `backend/migrations/002_platform_content_and_messages.sql`, and `backend/migrations/003_platform_retention_policies.sql`.
- Migration 003 creates the super-admin-controlled retention matrix by plan/type/status. `standard` (Basic) defaults to 60 days for open CRM leads, 30 days for closed CRM leads, and one day for ended/cancelled appointments and expired/closed waitlist entries. `plus` defaults to no automatic deletion. These values are editable in `/platform-admin/retention`; runtime reads the central policy table.
- They are **not run during API startup or Railway restarts**. The API's `prestart` migration hook has been removed.
- Run them only through the manual GitHub Actions workflow **Platform registry migrations**. The workflow takes a database preflight, serializes concurrent runs with a PostgreSQL advisory lock, and records completed files in `public.platform_registry_schema_migrations`.
- If there are no pending Registry migrations, the workflow exits without changing the database and without requiring backup approval.
- If changes are pending, each workflow run requires one explicit choice: confirm a restorable Registry backup was created and verified, or explicitly approve proceeding without a backup. The no-backup approval is scoped to that single manual run; automatic pushes/deployments cannot authorize it.
- The workflow uses the privileged `DATABASE_ADMIN_URL` connection but forces its database name to match `SUPERADMIN_DATABASE_URL`, preventing an accidental migration of the default `postgres` database.
- Do not run these SQL files manually or reintroduce them into `prestart`. New Registry schema changes must be added to the controlled migration list and the migration ledger.
