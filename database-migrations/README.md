# Database migration directories

This directory contains legacy, one-off migrations for the original/central database schema. These files are **not automatically applied to each business-specific tenant database**.

For per-tenant schema changes:
- Add a numbered file matching `backend/migrations/tenant-NNN-name.sql`.
- Keep it additive and safe for existing rows.
- Apply it through `backend/src/tenantMigrations.ts`, which records successful migrations in each tenant database.
- Update `backend/migrations/tenant-schema.sql` for newly created tenant databases as well.
- Do not run legacy SQL against Railway or tenant databases without reviewing the target database and obtaining explicit approval.

The `migrate-tenant-schemas` command preflights all mapped tenant databases first. It performs a dry run by default. Actual changes require the explicit environment flag `APPLY_TENANT_MIGRATIONS=true` after a suitable backup and approval.
