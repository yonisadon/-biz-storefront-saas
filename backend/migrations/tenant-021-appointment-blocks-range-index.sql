-- Match the exact half-open range expression used by daily availability overlap checks.
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_time_range
  ON public.appointment_blocks USING gist (tstzrange(start_at, end_at, '[)'));
