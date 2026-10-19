-- =====================================================================
-- 001_schema.sql  (v2, aligned with SYSTEM_SPEC.md)
-- Target: PostgreSQL 15+ on Railway (needs ON DELETE SET NULL (col) support)
-- Tenant model: every business IS a tenant (tenant_id = businesses.id)
-- Isolation: RLS keyed on session variable app.current_tenant
--
-- ROLES (never run the app as `postgres`; superusers bypass RLS):
--   postgres        -> migrations only
--   app_runtime     -> public site + seller management (RLS enforced)
--   app_superadmin  -> Super Admin panel only (BYPASSRLS, separate pool)
--
-- If you already ran the v1 file, uncomment the reset block below first.
-- =====================================================================

-- ---- OPTIONAL RESET (destroys v1 data) ------------------------------
-- DROP TABLE IF EXISTS public.lead_notes, public.lead_items, public.leads,
--   public.portfolio_images, public.products, public.media_assets,
--   public.business_domains, public.access_tokens, public.businesses CASCADE;
-- DROP SCHEMA IF EXISTS app CASCADE;
-- ---------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'CHANGE_ME_RUNTIME'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin') THEN
    CREATE ROLE app_superadmin LOGIN PASSWORD 'CHANGE_ME_SUPERADMIN'
      NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Helper schema, domain, functions
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

-- Israeli phone in normalized E.164 form (app must normalize before insert):
--   mobile +9725XXXXXXXX | landline +972[2,3,4,8,9]XXXXXXX | VoIP +9727XXXXXXXX
DO $$
BEGIN
  CREATE DOMAIN app.il_phone AS text
    CHECK (VALUE ~ '^\+972(5[0-9]{8}|[23489][0-9]{7}|7[0-9]{8})$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tenant bound to the current transaction. Unset => NULL => fail-closed.
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------

-- 3.1 Businesses (tenants). Public URL: /biz/<slug>
CREATE TABLE IF NOT EXISTS public.businesses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE
                   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 63),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended', 'archived')),
  whatsapp_number  app.il_phone,               -- seller number for Route A
  phone            app.il_phone,
  email            text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- "About Us": shown ONLY if non-NULL. Store NULL, never an empty string.
  about_text       text CHECK (about_text IS NULL OR length(btrim(about_text)) > 0),
  locale           text NOT NULL DEFAULT 'he-IL',
  timezone         text NOT NULL DEFAULT 'Asia/Jerusalem',
  config           jsonb NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(config) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Spec 3.2: seller may show both order routes or only one (never zero)
  CONSTRAINT chk_whatsapp_route_needs_number
    CHECK ((config #>> '{order_flow,whatsapp_enabled}') IS DISTINCT FROM 'true'
           OR whatsapp_number IS NOT NULL),
  CONSTRAINT chk_at_least_one_order_route
    CHECK (NOT ((config #>> '{order_flow,whatsapp_enabled}') = 'false'
            AND (config #>> '{order_flow,site_inquiry_enabled}') = 'false'))
);

-- 3.2 Media assets (spec section 5): protected storage tied to tenant_id
CREATE TABLE IF NOT EXISTS public.media_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_key       text NOT NULL UNIQUE,
  original_filename text,
  mime_type         text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes        integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),  -- 10MB max
  width             integer CHECK (width  IS NULL OR width  > 0),
  height            integer CHECK (height IS NULL OR height > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- Object key must live under this tenant's prefix: "<tenant_id>/..."
  CONSTRAINT chk_storage_key_tenant_prefix
    CHECK (left(storage_key, 37) = tenant_id::text || '/')
);

-- 3.3 Catalog: fixed-price product, or service by quote (price_agorot IS NULL)
CREATE TABLE IF NOT EXISTS public.products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'service')),
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  description     text,
  price_agorot    integer CHECK (price_agorot IS NULL OR price_agorot >= 0),  -- ILS x100; NULL = quote
  image_asset_id  uuid,                                                      -- exactly one image
  requires_appointment boolean NOT NULL DEFAULT false,
  appointment_duration_minutes smallint NOT NULL DEFAULT 30
    CHECK (appointment_duration_minutes IN (15, 30, 45, 60, 90, 120, 180, 240)),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, image_asset_id)
    REFERENCES public.media_assets (tenant_id, id) ON DELETE SET NULL (image_asset_id)
);

-- 3.4 Portfolio gallery: application limit is 7 images total. The DB keeps positions 1..10
-- temporarily so legacy rows above 7 can be reviewed and removed manually; never delete them automatically.
--     No rows => component not rendered (decided by app from row count).
CREATE TABLE IF NOT EXISTS public.portfolio_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
  alt_text    text,
  caption     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_id),
  CONSTRAINT uq_portfolio_position UNIQUE (tenant_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.media_assets (tenant_id, id) ON DELETE CASCADE
);

-- 3.5 Leads / Orders (spec section 3)
--     whatsapp_initiated = Route A, pending_approval = Route B (initial statuses).
--     approved/rejected/completed/cancelled = seller workflow (ASSUMPTION, see notes).
CREATE TABLE IF NOT EXISTS public.leads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name           text CHECK (customer_name IS NULL OR length(btrim(customer_name)) > 0),
  customer_phone          app.il_phone,
  customer_email          text CHECK (customer_email IS NULL
                                      OR customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  message                 text,
  submission_channel      text NOT NULL CHECK (submission_channel IN ('whatsapp', 'site')),
  status                  text NOT NULL
                          CHECK (status IN ('whatsapp_initiated', 'pending_approval',
                                            'approved', 'rejected', 'completed', 'cancelled')),
  estimated_total_agorot  integer CHECK (estimated_total_agorot IS NULL OR estimated_total_agorot >= 0),
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- 3.6 Selected products/services + quantities (snapshot of name/price at submit time)
CREATE TABLE IF NOT EXISTS public.lead_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id            uuid NOT NULL,
  product_id         uuid,
  item_name          text NOT NULL,
  unit_price_agorot  integer CHECK (unit_price_agorot IS NULL OR unit_price_agorot >= 0),  -- NULL = quote
  quantity           integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.leads (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products (tenant_id, id) ON DELETE SET NULL (product_id)
);

-- 3.7 Seller notes on leads (spec 2.2 lists "notes" as isolated data)
CREATE TABLE IF NOT EXISTS public.lead_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.leads (tenant_id, id) ON DELETE CASCADE
);

-- 3.8 Seller management links: /manage/<secure-access-token>
--     Only the SHA-256 of the token is stored; plaintext is shown once at issue time.
CREATE TABLE IF NOT EXISTS public.access_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  label         text,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3.9 Custom domains (Super Admin managed)
CREATE TABLE IF NOT EXISTS public.business_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  domain       text NOT NULL UNIQUE
               CHECK (domain = lower(domain)
                      AND domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'),
  is_verified  boolean NOT NULL DEFAULT false,
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. Indexes (tenant-scoped)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_tenant_active
  ON public.products (tenant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status_created
  ON public.leads (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created
  ON public.leads (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_items_tenant_lead
  ON public.lead_items (tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_notes_tenant_lead
  ON public.lead_notes (tenant_id, lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant
  ON public.media_assets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_tenant
  ON public.access_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_domains_tenant
  ON public.business_domains (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_domains_one_primary
  ON public.business_domains (tenant_id) WHERE is_primary;

-- ---------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['businesses','products','leads','lead_notes','portfolio_images']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. Row-Level Security
-- ---------------------------------------------------------------------
-- 6.1 Standard tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','leads','lead_items','lead_notes',
                           'media_assets','portfolio_images']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO app_runtime
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())', t);
  END LOOP;
END $$;

-- 6.2 Businesses: a session sees only its own business row
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.businesses;
CREATE POLICY tenant_isolation ON public.businesses
  FOR ALL TO app_runtime
  USING      (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

-- 6.3 Domains: tenant may read its own; writes are Super Admin only
ALTER TABLE public.business_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_domains FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_read ON public.business_domains;
CREATE POLICY tenant_read ON public.business_domains
  FOR SELECT TO app_runtime
  USING (tenant_id = app.current_tenant_id());

-- 6.4 Access tokens: RLS on, NO policy for app_runtime => denied outright.
--     Only the SECURITY DEFINER resolver below can look tokens up.
ALTER TABLE public.access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_tokens FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 7. Controlled cross-tenant entry points
--    SECURITY DEFINER runs as the migration owner (postgres = superuser on
--    Railway, so RLS does not block it). Each exposes the minimum needed.
-- ---------------------------------------------------------------------

-- Public site /biz/<slug>
CREATE OR REPLACE FUNCTION app.resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.businesses
  WHERE slug = lower(p_slug) AND status = 'active'
$$;

-- Custom domain -> tenant (verified domains of active businesses only)
CREATE OR REPLACE FUNCTION app.resolve_tenant_by_domain(p_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT d.tenant_id
  FROM public.business_domains d
  JOIN public.businesses b ON b.id = d.tenant_id
  WHERE d.domain = lower(p_host) AND d.is_verified AND b.status = 'active'
$$;

-- Seller link /manage/<token>. The APP hashes the token (SHA-256) so the
-- plaintext never reaches the DB or its logs. Returns NULL if invalid,
-- expired, revoked, or the business is not active.
CREATE OR REPLACE FUNCTION app.resolve_tenant_by_token(p_token_sha256 bytea)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_token_id uuid;
  v_tenant   uuid;
BEGIN
  SELECT t.id, t.tenant_id INTO v_token_id, v_tenant
  FROM public.access_tokens t
  JOIN public.businesses b ON b.id = t.tenant_id
  WHERE t.token_hash = p_token_sha256
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND b.status = 'active';

  IF v_token_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.access_tokens
     SET last_used_at = now()
   WHERE id = v_token_id
     AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

  RETURN v_tenant;
END $$;

-- Super Admin: create a business with consistent order-flow defaults
CREATE OR REPLACE FUNCTION app.create_business(
  p_slug             text,
  p_name             text,
  p_whatsapp_number  text  DEFAULT NULL,
  p_config           jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.businesses (slug, name, whatsapp_number, config)
  VALUES (
    lower(p_slug),
    p_name,
    p_whatsapp_number,
    jsonb_build_object(
      'version', 1,
      'order_flow', jsonb_build_object(
        'whatsapp_enabled',     p_whatsapp_number IS NOT NULL,
        'site_inquiry_enabled', true)
    ) || COALESCE(p_config, '{}'::jsonb)
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION app.resolve_tenant_by_slug(text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_domain(text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_token(bytea)        FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_business(text, text, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_slug(text)   TO app_runtime;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_domain(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_token(bytea) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.create_business(text, text, text, jsonb) TO app_superadmin;

-- ---------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO app_runtime, app_superadmin;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_runtime, app_superadmin;

-- 8.1 app_runtime (least privilege; column-level where it matters)
--     slug/status are NOT seller-editable (public links must stay stable).
GRANT SELECT ON public.businesses TO app_runtime;
GRANT UPDATE (name, whatsapp_number, phone, email, about_text, config)
  ON public.businesses TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products          TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets      TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_images  TO app_runtime;

-- Customer data is immutable for the seller; only the workflow status changes.
GRANT SELECT, INSERT ON public.leads TO app_runtime;
GRANT UPDATE (status) ON public.leads TO app_runtime;
GRANT DELETE ON public.leads TO app_runtime; -- seller deletion of their own tenant's inquiries
GRANT SELECT, INSERT ON public.lead_items TO app_runtime;

GRANT SELECT, INSERT, DELETE ON public.lead_notes TO app_runtime;
GRANT UPDATE (body) ON public.lead_notes TO app_runtime;

GRANT SELECT ON public.business_domains TO app_runtime;
-- access_tokens: intentionally no grants for app_runtime.

-- 8.2 app_superadmin (RLS-bypassing; use from the Super Admin panel only)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_superadmin;

COMMIT;

-- =====================================================================
-- APP CONTRACT (every request, inside a transaction):
--
--   BEGIN;
--   SELECT set_config('app.current_tenant', '<tenant-uuid>', true);  -- true = LOCAL
--   ... queries ...
--   COMMIT;
--
-- Public site:  app.resolve_tenant_by_slug('slug')  or  ..._by_domain(host)
-- Seller panel: app.resolve_tenant_by_token(sha256(token_from_url))
-- Issue token (Super Admin): generate >=32 random bytes in the app, show the
--   plaintext once, INSERT INTO access_tokens (tenant_id, token_hash) VALUES (..., sha256(token)).
-- Always use LOCAL set_config with pooling so tenant context never leaks.
-- =====================================================================

-- =====================================================================
-- OPTIONAL SMOKE TEST (as app_superadmin to seed, app_runtime to verify)
--
--   -- as app_superadmin:
--   SELECT app.create_business('demo-a', 'Demo A', '+972501234567');
--   SELECT app.create_business('demo-b', 'Demo B');
--
--   -- as app_runtime:
--   BEGIN;
--   SELECT set_config('app.current_tenant', app.resolve_tenant_by_slug('demo-a')::text, true);
--   INSERT INTO products (tenant_id, name, price_agorot) VALUES (app.current_tenant_id(), 'Item A', 15000);
--   INSERT INTO leads (tenant_id, customer_name, customer_phone, submission_channel, status)
--     VALUES (app.current_tenant_id(), 'Dana', '+972521234567', 'site', 'pending_approval');
--   SELECT count(*) FROM products;                      -- 1
--   INSERT INTO products (tenant_id, name)
--     VALUES (app.resolve_tenant_by_slug('demo-b'), 'Evil');   -- ERROR: violates RLS
--   ROLLBACK;
--   SELECT count(*) FROM products;                      -- 0 (no tenant => fail-closed)
-- =====================================================================

-- Keep the tenant template aligned with the incremental migrations currently used
-- by the live application (002_allow_whatsapp_leads_without_contact,
-- 003_service_appointment_requests, 004_appointment_duration).
BEGIN;
ALTER TABLE public.leads
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_appointment boolean NOT NULL DEFAULT false;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes smallint NOT NULL DEFAULT 30;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_appointment_duration_minutes_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_appointment_duration_minutes_check
  CHECK (appointment_duration_minutes IN (15, 30, 45, 60, 90, 120, 180, 240));
COMMIT;
