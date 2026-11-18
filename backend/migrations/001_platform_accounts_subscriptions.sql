BEGIN;
-- Platform accounts, subscriptions and controlled business deletion.
-- Run only against the central registry database.
-- Legacy businesses without a subscription row remain unaffected.

CREATE TABLE IF NOT EXISTS public.platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  phone text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'super_admin')),
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_users_email_format CHECK (
    email = lower(btrim(email))
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  CONSTRAINT platform_users_phone_format CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT platform_users_password_hash_nonempty CHECK (length(password_hash) >= 40)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_users_email ON public.platform_users (email);

CREATE TABLE IF NOT EXISTS public.platform_user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('terms_of_use', 'privacy_policy', 'marketing_email', 'marketing_sms')),
  granted boolean NOT NULL,
  consent_version text NOT NULL,
  source text NOT NULL CHECK (source IN ('registration', 'account_settings')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_user_consents_latest
  ON public.platform_user_consents (user_id, consent_type, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_user_active
  ON public.platform_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.platform_email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_email_tokens_user_purpose
  ON public.platform_email_tokens (user_id, purpose, expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.platform_business_owners (
  user_id uuid PRIMARY KEY REFERENCES public.platform_users(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')),
  plan_code text NOT NULL DEFAULT 'standard',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_trial_dates CHECK (
    status <> 'trialing'
    OR (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at > trial_started_at)
  )
);
CREATE INDEX IF NOT EXISTS idx_platform_subscriptions_status_end
  ON public.platform_subscriptions (status, trial_ends_at, current_period_ends_at);

CREATE TABLE IF NOT EXISTS public.business_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  business_name text NOT NULL,
  business_slug text NOT NULL,
  database_name text CHECK (database_name IS NULL OR database_name ~ '^biz_[a-f0-9]{24}$'),
  storage_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(storage_keys) = 'array'),
  requested_by_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  requested_by_admin boolean NOT NULL DEFAULT false,
  reason text CHECK (reason IS NULL OR length(btrim(reason)) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_email text,
  review_note text CHECK (review_note IS NULL OR length(btrim(review_note)) <= 1000),
  completed_at timestamptz,
  backup_verified_at timestamptz,
  backup_reference text CHECK (backup_reference IS NULL OR length(btrim(backup_reference)) BETWEEN 8 AND 500),
  backup_verified_by text
);
ALTER TABLE public.business_deletion_requests
  ADD COLUMN IF NOT EXISTS backup_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS backup_reference text,
  ADD COLUMN IF NOT EXISTS backup_verified_by text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_deletion_one_pending
  ON public.business_deletion_requests (tenant_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_business_deletion_requests_status_date
  ON public.business_deletion_requests (status, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id bigserial PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('owner', 'super_admin', 'system')),
  actor_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  tenant_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_tenant_date
  ON public.platform_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_action_date
  ON public.platform_audit_log (action, created_at DESC);

-- Existing businesses without subscription rows retain their current access behavior.
CREATE OR REPLACE FUNCTION app.is_tenant_subscription_accessible(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN s.tenant_id IS NULL THEN b.status = 'active'
    WHEN b.status <> 'active' THEN false
    WHEN s.status = 'trialing' THEN s.trial_ends_at > now()
    WHEN s.status = 'active' THEN s.current_period_ends_at IS NULL OR s.current_period_ends_at > now()
    ELSE false
  END
  FROM public.businesses b
  LEFT JOIN public.platform_subscriptions s ON s.tenant_id = b.id
  WHERE b.id = p_tenant_id
$function$;

CREATE OR REPLACE FUNCTION app.resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT b.id
  FROM public.businesses b
  WHERE b.slug = lower(p_slug)
    AND app.is_tenant_subscription_accessible(b.id)
$function$;

CREATE OR REPLACE FUNCTION app.resolve_tenant_by_domain(p_host text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT d.tenant_id
  FROM public.business_domains d
  JOIN public.businesses b ON b.id = d.tenant_id
  WHERE d.domain = lower(p_host)
    AND d.is_verified
    AND app.is_tenant_subscription_accessible(b.id)
$function$;

CREATE OR REPLACE FUNCTION app.resolve_tenant_by_token(p_token_sha256 bytea)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_token_id uuid;
  v_tenant uuid;
BEGIN
  SELECT t.id, t.tenant_id INTO v_token_id, v_tenant
  FROM public.access_tokens t
  WHERE t.token_hash = p_token_sha256
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND app.is_tenant_subscription_accessible(t.tenant_id);

  IF v_token_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.access_tokens
     SET last_used_at = now()
   WHERE id = v_token_id
     AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

  RETURN v_tenant;
END
$function$;

REVOKE ALL ON public.platform_users, public.platform_sessions, public.platform_email_tokens,
  public.platform_business_owners, public.platform_subscriptions, public.platform_user_consents,
  public.business_deletion_requests, public.platform_audit_log FROM PUBLIC, app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_users, public.platform_sessions,
  public.platform_email_tokens, public.platform_business_owners, public.platform_subscriptions,
  public.business_deletion_requests, public.platform_audit_log TO app_superadmin;
GRANT SELECT, INSERT ON public.platform_user_consents TO app_superadmin;
GRANT USAGE, SELECT ON SEQUENCE public.platform_audit_log_id_seq TO app_superadmin;

REVOKE ALL ON FUNCTION app.is_tenant_subscription_accessible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_domain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_tenant_subscription_accessible(uuid) TO app_runtime, app_superadmin;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_slug(text) TO app_runtime, app_superadmin;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_domain(text) TO app_runtime, app_superadmin;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_token(bytea) TO app_runtime, app_superadmin;

COMMIT;
