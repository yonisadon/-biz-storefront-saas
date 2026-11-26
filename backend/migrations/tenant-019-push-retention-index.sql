-- Support bounded retention cleanup without scanning active/retrying Push events.
CREATE INDEX IF NOT EXISTS idx_push_outbox_processed_at
  ON public.push_outbox (processed_at)
  WHERE status = 'done' AND processed_at IS NOT NULL;