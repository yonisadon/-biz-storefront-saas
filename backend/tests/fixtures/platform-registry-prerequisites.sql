-- Disposable PostgreSQL prerequisites matching the central registry objects
-- consumed by migrations 000 and 001. This file is used only in CI.
CREATE ROLE app_runtime NOLOGIN;
CREATE ROLE app_superadmin NOLOGIN;
CREATE SCHEMA app;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  whatsapp_number text,
  phone text,
  email text,
  about_text text,
  locale text NOT NULL DEFAULT 'he-IL',
  timezone text NOT NULL DEFAULT 'Asia/Jerusalem',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
