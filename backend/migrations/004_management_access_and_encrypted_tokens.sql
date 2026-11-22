BEGIN;

-- Keep the verifier hash for authentication and store an authenticated,
-- AES-256-GCM encrypted copy only so authorized owners/admins can redisplay
-- the exact same permanent management URL.
ALTER TABLE public.access_tokens
  ADD COLUMN IF NOT EXISTS encrypted_token text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_tokens_one_permanent_link
  ON public.access_tokens (tenant_id)
  WHERE expires_at IS NULL
    AND revoked_at IS NULL
    AND label = 'permanent seller link';

-- Resolve only after the normal token/subscription check has succeeded.
-- Ownerless businesses retain their existing bearer-link behavior. Once a
-- business is claimed, the permanent link also requires the matching owner
-- account's valid platform session.
CREATE OR REPLACE FUNCTION app.authorize_tenant_management(
  p_token_sha256 bytea,
  p_session_sha256 bytea
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tenant uuid;
  v_owner uuid;
  v_session_user uuid;
BEGIN
  SELECT t.tenant_id INTO v_tenant
    FROM public.access_tokens t
   WHERE t.token_hash = p_token_sha256
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND app.is_tenant_subscription_accessible(t.tenant_id);

  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT bo.user_id INTO v_owner
    FROM public.platform_business_owners bo
   WHERE bo.tenant_id = v_tenant;

  -- Businesses not yet connected to a platform account continue to use the
  -- permanent private link as their access credential.
  IF v_owner IS NULL THEN
    UPDATE public.access_tokens
       SET last_used_at = now()
     WHERE token_hash = p_token_sha256
       AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');
    RETURN v_tenant;
  END IF;

  IF p_session_sha256 IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ps.user_id INTO v_session_user
    FROM public.platform_sessions ps
    JOIN public.platform_users u ON u.id = ps.user_id
   WHERE ps.token_hash = p_session_sha256
     AND ps.revoked_at IS NULL
     AND ps.expires_at > now()
     AND u.disabled_at IS NULL
     AND u.email_verified_at IS NOT NULL
     AND u.role = 'owner';

  IF v_session_user IS DISTINCT FROM v_owner THEN
    RETURN NULL;
  END IF;

  UPDATE public.access_tokens
     SET last_used_at = now()
   WHERE token_hash = p_token_sha256
     AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

  RETURN v_tenant;
END
$function$;

REVOKE ALL ON FUNCTION app.authorize_tenant_management(bytea, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_tenant_management(bytea, bytea) TO app_runtime, app_superadmin;

COMMIT;
