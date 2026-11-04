-- Add support for up to two additional product images and flexible product details.
-- Existing products keep their current image_asset_id as the primary image.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_details_array_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_details_array_check
      CHECK (jsonb_typeof(details) = 'array');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL,
  asset_id    uuid NOT NULL,
  position    smallint NOT NULL CHECK (position IN (2, 3)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, product_id, position),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.media_assets (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_images_tenant_product
  ON public.product_images (tenant_id, product_id, position);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_images;
CREATE POLICY tenant_isolation ON public.product_images
  FOR ALL TO app_runtime
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO app_runtime;
