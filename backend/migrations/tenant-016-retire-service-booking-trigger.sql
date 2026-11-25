-- Retire the old per-service booking-mode trigger.
-- The legacy columns remain temporarily for the compatibility mapping in tenant-015.
DROP TRIGGER IF EXISTS trg_products_booking_mode ON public.products;
DROP FUNCTION IF EXISTS app.sync_product_booking_mode();
