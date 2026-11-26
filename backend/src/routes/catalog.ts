import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { env } from '../config';
import { withTenant } from '../db';
import { productPatchAssignment } from '../productPatchSql';
import { HttpError } from '../errors';
import { processImage, sanitizeFilename } from '../images';
import { GalleryPatch, OrderBody, ProductCreate, ProductListQuery, ProductMove, ProductPatch } from '../catalogSchemas';
import { mainKey, ogKey, storage, variantKeys } from '../storage';

const MAX_PRODUCTS = 200;
const MAX_GALLERY = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idParam = (req: FastifyRequest) => {
  const id = (req.params as { id: string }).id;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  return id;
};
const mediaUrl = (key: string) => `${env.MEDIA_BASE_URL.replace(/\/+$/, '')}/media/${key}`;

type PendingMediaAsset = { id: string; storage_key: string };

async function readUpload(req: FastifyRequest) {
  const file = await req.file(); // limits (10MB, 1 file) are set where multipart is registered
  if (!file) throw new HttpError(400, 'file_required');
  const buffer = await file.toBuffer(); // throws 413 FST_REQ_FILE_TOO_LARGE when over 10MB
  return { buffer, filename: sanitizeFilename(file.filename) };
}

// Persist a pending-deletion row before uploading either object. If the process
// crashes or a later DB transaction rolls back, cleanup still has the storage key.
async function storeImage(req: FastifyRequest, buffer: Buffer, filename: string | null) {
  const img = await processImage(buffer);
  const id = randomUUID();
  const key = mainKey(req.tenantId, id);
  await withTenant(req.tenantId, async (db) => {
    await db.query(
      `INSERT INTO media_assets
         (id, tenant_id, storage_key, original_filename, mime_type, size_bytes, width, height, deleted_at)
       VALUES ($1, app.current_tenant_id(), $2, $3, 'image/jpeg', $4, $5, $6, now())`,
      [id, key, filename, img.main.length, img.width, img.height],
    );
  });
  try {
    await storage.put(key, img.main, 'image/jpeg');
    await storage.put(ogKey(key), img.og, 'image/jpeg');
  } catch (error) {
    await removeTrackedAssets(req, [{ id, storage_key: key }]);
    throw error;
  }
  return { id, key, main: img.main, width: img.width, height: img.height };
}
type StoredImage = Awaited<ReturnType<typeof storeImage>>;

const activateAsset = async (db: pg.PoolClient, asset: StoredImage) => {
  const result = await db.query(
    `UPDATE media_assets SET deleted_at = NULL
      WHERE id = $1 AND storage_key = $2 AND deleted_at IS NOT NULL
      RETURNING id`,
    [asset.id, asset.key],
  );
  if (!result.rowCount) throw new Error('pending_media_asset_not_found');
};

// Marks an unreferenced asset for durable storage deletion; returns its tracked storage key.
async function dropAssetIfOrphan(db: pg.PoolClient, assetId: string | null): Promise<PendingMediaAsset[]> {
  if (!assetId) return [];
  const r = await db.query(
    `UPDATE media_assets m SET deleted_at = COALESCE(m.deleted_at, now())
      WHERE m.id = $1
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.image_asset_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.asset_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM portfolio_images g WHERE g.asset_id = m.id)
      RETURNING m.id, m.storage_key`,
    [assetId],
  );
  return r.rows as PendingMediaAsset[];
}

// The media_assets row is the durable deletion record. Remove it only after
// storage confirms deletion; failures leave it for the scheduled cleanup retry.
async function removeTrackedAssets(req: FastifyRequest, assets: PendingMediaAsset[]) {
  if (!assets.length) return;
  try {
    await storage.remove(assets.flatMap((asset) => variantKeys(asset.storage_key)));
  } catch (err) {
    req.log.warn({ err, assetCount: assets.length }, 'tracked media deletion deferred for retry');
    return;
  }
  try {
    await withTenant(req.tenantId, async (db) => {
      await db.query(
        `DELETE FROM media_assets m
          WHERE m.id = ANY($1::uuid[]) AND m.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM products p WHERE p.image_asset_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.asset_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM portfolio_images g WHERE g.asset_id = m.id)`,
        [assets.map((asset) => asset.id)],
      );
    });
  } catch (err) {
    req.log.warn({ err, assetCount: assets.length }, 'media deletion finalized in storage; database retry remains safe');
  }
}

const PRODUCT_SELECT = `
  SELECT p.id, p.kind, p.name, p.description, p.details, p.price_agorot, p.appointment_duration_minutes, p.is_active, p.sort_order,
         m.storage_key, m.width, m.height,
         COALESCE((
           SELECT json_agg(json_build_object('id', pi.id, 'storage_key', pm.storage_key, 'width', pm.width, 'height', pm.height, 'position', pi.position) ORDER BY pi.position)
             FROM product_images pi
             JOIN media_assets pm ON pm.tenant_id = pi.tenant_id AND pm.id = pi.asset_id
            WHERE pi.tenant_id = p.tenant_id AND pi.product_id = p.id
         ), '[]'::json) AS extra_images
    FROM products p
    LEFT JOIN media_assets m ON m.tenant_id = p.tenant_id AND m.id = p.image_asset_id`;

const shapeProduct = (r: any) => ({
  id: r.id, kind: r.kind, name: r.name, description: r.description, details: r.details ?? [],
  price_agorot: r.price_agorot, appointment_duration_minutes: r.appointment_duration_minutes ?? 30, is_active: r.is_active, sort_order: r.sort_order,
  image_url: r.storage_key ? mediaUrl(r.storage_key) : null,
  image_width: r.width ?? null, image_height: r.height ?? null,
  additional_images: (r.extra_images ?? []).map((image: any) => ({ id: image.id, url: mediaUrl(image.storage_key), width: image.width, height: image.height, position: image.position })),
});

const GALLERY_SELECT = `
  SELECT g.id, g.position, g.alt_text, g.caption, m.storage_key
    FROM portfolio_images g
    JOIN media_assets m ON m.tenant_id = g.tenant_id AND m.id = g.asset_id`;

const shapeGallery = (r: any) => ({
  id: r.id, position: r.position, alt_text: r.alt_text, caption: r.caption, url: mediaUrl(r.storage_key),
});

const uploadLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  // ================= Products =================
  app.get('/products', async (req) => {
    const q = ProductListQuery.parse(req.query);
    return withTenant(req.tenantId, async (db) => {
      const active = q.status === 'all' ? null : q.status === 'active';
      const where = `($1::text = '' OR p.name ILIKE '%' || $1 || '%') AND ($2::boolean IS NULL OR p.is_active = $2)`;
      const total = Number((await db.query(`SELECT count(*)::int AS total FROM products p WHERE ${where}`, [q.search, active])).rows[0].total);
      const rows = (await db.query(`${PRODUCT_SELECT} WHERE ${where} ORDER BY p.sort_order, p.created_at LIMIT $3 OFFSET $4`, [q.search, active, q.limit, q.offset])).rows;
      return { items: rows.map(shapeProduct), total, limit: q.limit, offset: q.offset };
    });
  });

  app.post('/products', async (req, reply) => {
    const b = ProductCreate.parse(req.body);
    const row = await withTenant(req.tenantId, async (db) => {
      const n = await db.query('SELECT count(*)::int AS n FROM products');
      if (n.rows[0].n >= MAX_PRODUCTS) throw new HttpError(409, 'product_limit');
      const ins = await db.query(
        `INSERT INTO products (tenant_id, kind, name, description, details, price_agorot, is_active, appointment_duration_minutes, sort_order)
         VALUES (app.current_tenant_id(), $1, $2, $3, $4::jsonb, $5, $6, $7,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM products))
         RETURNING id`,
        [b.kind, b.name, b.description, JSON.stringify(b.details), b.price_agorot, b.is_active, b.kind === 'service' ? b.appointment_duration_minutes : 30],
      );
      return (await db.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [ins.rows[0].id])).rows[0];
    });
    return reply.code(201).send(shapeProduct(row));
  });

  // Registered before /products/:id so "order" is never read as an id
  app.put('/products/order', async (req, reply) => {
    const { ids } = OrderBody.parse(req.body);
    await withTenant(req.tenantId, async (db) => {
      const total = (await db.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
      const r = await db.query(
        `UPDATE products p SET sort_order = x.ord
           FROM unnest($1::uuid[], $2::int[]) AS x(id, ord)
          WHERE p.id = x.id`,
        [ids, ids.map((_, i) => i)],
      );
      if (r.rowCount !== ids.length || ids.length !== total) throw new HttpError(400, 'order_mismatch');
    });
    return reply.code(204).send();
  });

  app.post('/products/:id/move', async (req) => {
    const id = idParam(req);
    const { direction } = ProductMove.parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const rows = (await db.query('SELECT id, sort_order FROM products ORDER BY sort_order, created_at FOR UPDATE')).rows as { id: string; sort_order: number }[];
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new HttpError(404, 'not_found');
      const otherIndex = index + (direction === 'up' ? -1 : 1);
      if (otherIndex < 0 || otherIndex >= rows.length) return { moved: false };
      const current = rows[index], other = rows[otherIndex];
      const temporaryOrder = Math.max(...rows.map((row) => row.sort_order)) + 1;
      await db.query('UPDATE products SET sort_order = $1 WHERE id = $2', [temporaryOrder, current.id]);
      await db.query('UPDATE products SET sort_order = $1 WHERE id = $2', [current.sort_order, other.id]);
      await db.query('UPDATE products SET sort_order = $1 WHERE id = $2', [other.sort_order, current.id]);
      return { moved: true };
    });
  });

  app.patch('/products/:id', async (req) => {
    const id = idParam(req);
    const patch = ProductPatch.parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      // Booking behavior is business-level; only service duration remains per item.
      const normalizedPatch = {
        ...patch,
        ...(patch.kind === 'product' ? { appointment_duration_minutes: 30 } : {}),
      };
      for (const c of ['kind', 'name', 'description', 'details', 'price_agorot', 'is_active', 'appointment_duration_minutes'] as const) {
        if (normalizedPatch[c] !== undefined) {
          vals.push(c === 'details' ? JSON.stringify(normalizedPatch[c]) : normalizedPatch[c]);
          sets.push(productPatchAssignment(c, vals.length));
        }
      }
      vals.push(id);
      const r = await db.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`, vals);
      if (!r.rows[0]) throw new HttpError(404, 'not_found');
      return shapeProduct((await db.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id])).rows[0]);
    });
  });

  app.delete('/products/:id', async (req, reply) => {
    const id = idParam(req);
    const assets = await withTenant(req.tenantId, async (db) => {
      const product = await db.query('SELECT image_asset_id FROM products WHERE id = $1 FOR UPDATE', [id]);
      if (!product.rows[0]) throw new HttpError(404, 'not_found');
      const extras = await db.query('SELECT asset_id FROM product_images WHERE product_id = $1', [id]);
      await db.query('DELETE FROM products WHERE id = $1', [id]);
      const assetIds = [product.rows[0].image_asset_id, ...extras.rows.map((row) => row.asset_id)];
      const assets: PendingMediaAsset[] = [];
      for (const assetId of assetIds) assets.push(...await dropAssetIfOrphan(db, assetId));
      return assets;
    });
    await removeTrackedAssets(req, assets);
    return reply.code(204).send();
  });

  // ---- product image: upload / replace ----
  app.post('/products/:id/image', uploadLimit, async (req) => {
    const id = idParam(req);
    const { buffer, filename } = await readUpload(req); // consume the stream first

    await withTenant(req.tenantId, async (db) => {
      if (!(await db.query('SELECT 1 FROM products WHERE id = $1', [id])).rowCount) {
        throw new HttpError(404, 'not_found');
      }
    });

    const asset = await storeImage(req, buffer, filename);
    let result: { oldAssets: PendingMediaAsset[]; product: ReturnType<typeof shapeProduct> };
    try {
      result = await withTenant(req.tenantId, async (db) => {
        const cur = await db.query('SELECT image_asset_id FROM products WHERE id = $1 FOR UPDATE', [id]);
        if (!cur.rows[0]) throw new HttpError(404, 'not_found');
        await activateAsset(db, asset);
        await db.query('UPDATE products SET image_asset_id = $1 WHERE id = $2', [asset.id, id]);
        const oldAssets = await dropAssetIfOrphan(db, cur.rows[0].image_asset_id);
        const row = (await db.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id])).rows[0];
        return { oldAssets, product: shapeProduct(row) };
      });
    } catch (err) {
      await removeTrackedAssets(req, [{ id: asset.id, storage_key: asset.key }]); // DB failed: don't leave files behind
      throw err;
    }
    await removeTrackedAssets(req, result.oldAssets);
    return result.product;
  });

  app.delete('/products/:id/image', async (req, reply) => {
    const id = idParam(req);
    const assets = await withTenant(req.tenantId, async (db) => {
      const cur = await db.query('SELECT image_asset_id FROM products WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows[0]) throw new HttpError(404, 'not_found');
      await db.query('UPDATE products SET image_asset_id = NULL WHERE id = $1', [id]);
      return dropAssetIfOrphan(db, cur.rows[0].image_asset_id);
    });
    await removeTrackedAssets(req, assets);
    return reply.code(204).send();
  });

  // ---- additional product images: two optional images beside the legacy primary image ----
  app.post('/products/:id/additional-images', uploadLimit, async (req, reply) => {
    const id = idParam(req);
    const { buffer, filename } = await readUpload(req);
    const asset = await storeImage(req, buffer, filename);
    let result: { image: unknown; oldAssets: PendingMediaAsset[] };
    try {
      result = await withTenant(req.tenantId, async (db) => {
        const product = await db.query('SELECT image_asset_id FROM products WHERE id = $1 FOR UPDATE', [id]);
        if (!product.rows[0]) throw new HttpError(404, 'not_found');
        const used = await db.query('SELECT position FROM product_images WHERE product_id = $1 ORDER BY position', [id]);
        const occupied = new Set(used.rows.map((row) => Number(row.position)));
        const position = [2, 3].find((value) => !occupied.has(value));
        if (!position) throw new HttpError(409, 'product_images_full');
        await activateAsset(db, asset);
        const inserted = await db.query(
          'INSERT INTO product_images (tenant_id, product_id, asset_id, position) VALUES (app.current_tenant_id(), $1, $2, $3) RETURNING id, position',
          [id, asset.id, position],
        );
        return {
          image: { id: inserted.rows[0].id, position, url: mediaUrl(asset.key), width: asset.width, height: asset.height },
          oldAssets: [],
        };
      });
    } catch (err) {
      await removeTrackedAssets(req, [{ id: asset.id, storage_key: asset.key }]);
      throw err;
    }
    return reply.code(201).send(result.image);
  });

  app.put('/products/:id/additional-images/:imageId', uploadLimit, async (req) => {
    const id = idParam(req);
    const imageId = (req.params as { imageId: string }).imageId;
    if (!UUID_RE.test(imageId)) throw new HttpError(404, 'not_found');
    const { buffer, filename } = await readUpload(req);
    const asset = await storeImage(req, buffer, filename);
    try {
      const result = await withTenant(req.tenantId, async (db) => {
        const current = await db.query(
          'SELECT asset_id FROM product_images WHERE id = $1 AND product_id = $2 FOR UPDATE',
          [imageId, id],
        );
        if (!current.rows[0]) throw new HttpError(404, 'not_found');
        await activateAsset(db, asset);
        await db.query(
          'UPDATE product_images SET asset_id = $1 WHERE id = $2 AND product_id = $3',
          [asset.id, imageId, id],
        );
        const oldAssets = await dropAssetIfOrphan(db, current.rows[0].asset_id);
        return { oldAssets };
      });
      await removeTrackedAssets(req, result.oldAssets);
      return { id: imageId, url: mediaUrl(asset.key), width: asset.width, height: asset.height };
    } catch (err) {
      await removeTrackedAssets(req, [{ id: asset.id, storage_key: asset.key }]);
      throw err;
    }
  });

  app.delete('/products/:id/additional-images/:imageId', async (req, reply) => {
    const id = idParam(req);
    const imageId = (req.params as { imageId: string }).imageId;
    if (!UUID_RE.test(imageId)) throw new HttpError(404, 'not_found');
    const assets = await withTenant(req.tenantId, async (db) => {
      const removed = await db.query(
        'DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING asset_id',
        [imageId, id],
      );
      if (!removed.rows[0]) throw new HttpError(404, 'not_found');
      return dropAssetIfOrphan(db, removed.rows[0].asset_id);
    });
    await removeTrackedAssets(req, assets);
    return reply.code(204).send();
  });

  // ================= Gallery (max 7) =================
  app.get('/gallery', async (req) =>
    withTenant(req.tenantId, async (db) =>
      (await db.query(`${GALLERY_SELECT} ORDER BY g.position`)).rows.map(shapeGallery)));

  app.post('/gallery', uploadLimit, async (req, reply) => {
    const { buffer, filename } = await readUpload(req);

    // Cheap early exit so we don't compress an image we'd reject anyway
    await withTenant(req.tenantId, async (db) => {
      const n = (await db.query('SELECT count(*)::int AS n FROM portfolio_images')).rows[0].n;
      if (n >= MAX_GALLERY) throw new HttpError(409, 'gallery_full');
    });

    const asset = await storeImage(req, buffer, filename);
    let item: unknown;
    try {
      item = await withTenant(req.tenantId, async (db) => {
        // Serialize concurrent uploads of the same tenant so two requests can't pick the same slot
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended(app.current_tenant_id()::text, 0))');
        const free = await db.query(
          `SELECT s AS pos FROM generate_series(1, ${MAX_GALLERY}) s
            WHERE s NOT IN (SELECT pi.position FROM portfolio_images pi)
            ORDER BY s LIMIT 1`,
        );
        if (!free.rows[0]) throw new HttpError(409, 'gallery_full');
        await activateAsset(db, asset);
        const r = await db.query(
          `INSERT INTO portfolio_images (tenant_id, asset_id, position)
           VALUES (app.current_tenant_id(), $1, $2)
           RETURNING id, position, alt_text, caption`,
          [asset.id, free.rows[0].pos],
        );
        return { ...r.rows[0], url: mediaUrl(asset.key) };
      });
    } catch (err) {
      await removeTrackedAssets(req, [{ id: asset.id, storage_key: asset.key }]);
      throw err;
    }
    return reply.code(201).send(item);
  });

  app.put('/gallery/order', async (req, reply) => {
    const { ids } = OrderBody.parse(req.body);
    await withTenant(req.tenantId, async (db) => {
      const total = (await db.query('SELECT count(*)::int AS n FROM portfolio_images')).rows[0].n;
      // The (tenant_id, position) unique constraint is DEFERRED, so rows can swap inside one transaction
      const r = await db.query(
        `UPDATE portfolio_images g SET position = x.pos
           FROM unnest($1::uuid[], $2::int[]) AS x(id, pos)
          WHERE g.id = x.id`,
        [ids, ids.map((_, i) => i + 1)],
      );
      if (r.rowCount !== ids.length || ids.length !== total) throw new HttpError(400, 'order_mismatch');
    });
    return reply.code(204).send();
  });

  app.patch('/gallery/:id', async (req) => {
    const id = idParam(req);
    const patch = GalleryPatch.parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const c of ['alt_text', 'caption'] as const) {
        if (patch[c] !== undefined) { vals.push(patch[c]); sets.push(`${c} = $${vals.length}`); }
      }
      vals.push(id);
      const r = await db.query(`UPDATE portfolio_images SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`, vals);
      if (!r.rows[0]) throw new HttpError(404, 'not_found');
      return shapeGallery((await db.query(`${GALLERY_SELECT} WHERE g.id = $1`, [id])).rows[0]);
    });
  });

  app.delete('/gallery/:id', async (req, reply) => {
    const id = idParam(req);
    const assets = await withTenant(req.tenantId, async (db) => {
      const r = await db.query('DELETE FROM portfolio_images WHERE id = $1 RETURNING asset_id', [id]);
      if (!r.rows[0]) throw new HttpError(404, 'not_found');
      return dropAssetIfOrphan(db, r.rows[0].asset_id);
    });
    await removeTrackedAssets(req, assets);
    return reply.code(204).send();
  });
};