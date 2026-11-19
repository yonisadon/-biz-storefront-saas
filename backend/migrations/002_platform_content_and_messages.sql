BEGIN;

-- Central platform-owned content and owner communications.
-- This migration runs only against the central Registry database.

CREATE TABLE IF NOT EXISTS public.platform_content (
  content_key text PRIMARY KEY CHECK (content_key IN ('marketing_page', 'owner_dashboard')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.platform_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key uuid NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'both')),
  category text NOT NULL CHECK (category IN ('service', 'marketing')),
  audience jsonb NOT NULL CHECK (jsonb_typeof(audience) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'accepted', 'partial', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_platform_messages_created
  ON public.platform_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.platform_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  email_address text,
  email_status text NOT NULL DEFAULT 'not_requested'
    CHECK (email_status IN ('not_requested', 'pending', 'accepted', 'failed', 'skipped_consent')),
  email_provider_message_id text,
  email_error text CHECK (email_error IS NULL OR length(email_error) <= 500),
  email_accepted_at timestamptz,
  email_delivered_at timestamptz,
  email_opened_at timestamptz,
  in_app_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_message_recipients_user
  ON public.platform_message_recipients (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_message_recipients_message
  ON public.platform_message_recipients (message_id, email_status);

REVOKE ALL ON public.platform_content, public.platform_messages,
  public.platform_message_recipients FROM PUBLIC;
GRANT SELECT ON public.platform_content TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_content,
  public.platform_messages, public.platform_message_recipients TO app_superadmin;
GRANT SELECT, UPDATE ON public.platform_message_recipients TO app_superadmin;

COMMIT;
