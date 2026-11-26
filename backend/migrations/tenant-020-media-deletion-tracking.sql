-- Preserve media storage keys as durable deletion work until object storage confirms removal.
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_media_assets_pending_deletion
  ON public.media_assets (deleted_at)
  WHERE deleted_at IS NOT NULL;
