-- Run once against the existing central/registry database before deploying the new backend.
-- This registry maps each business ID to its dedicated database on the same Railway PostgreSQL service.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.tenant_databases (
  tenant_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  database_name text NOT NULL UNIQUE
    CHECK (database_name ~ '^biz_[a-f0-9]{24}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA app TO app_runtime, app_superadmin;
GRANT SELECT ON app.tenant_databases TO app_runtime, app_superadmin;
GRANT INSERT, UPDATE, DELETE ON app.tenant_databases TO app_superadmin;
COMMIT;
