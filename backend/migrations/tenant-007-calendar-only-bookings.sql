-- Calendar reservations are an operational flow independent of CRM and contact channels.
-- A business may disable both WhatsApp and ordinary website inquiries while still
-- accepting availability-mode bookings through its public website.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS chk_at_least_one_order_route;
