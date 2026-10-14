import { z } from 'zod';

// '' or null => null; undefined stays undefined (field not sent)
const optText = (max: number) =>
  z.string().trim().max(max).nullable().optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const price = z.number().int().min(0).max(10_000_000).nullable(); // agorot, null = quote
const appointmentDuration = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90), z.literal(120), z.literal(180), z.literal(240)]);

export const ProductCreate = z.object({
  kind: z.enum(['product', 'service']).default('product'),
  name: z.string().trim().min(1).max(120),
  description: optText(2000).transform((v) => v ?? null),
  price_agorot: price.default(null),
  is_active: z.boolean().default(true),
  requires_appointment: z.boolean().default(false),
  appointment_duration_minutes: appointmentDuration.default(30),
}).strict();

export const ProductPatch = z.object({
  kind: z.enum(['product', 'service']).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: optText(2000),
  price_agorot: price.optional(),
  is_active: z.boolean().optional(),
  requires_appointment: z.boolean().optional(),
  appointment_duration_minutes: appointmentDuration.optional(),
}).strict().refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'empty_patch' });

export const OrderBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(300),
}).strict().refine((o) => new Set(o.ids).size === o.ids.length, { message: 'duplicate_ids' });

export const GalleryPatch = z.object({
  alt_text: optText(200),
  caption: optText(300),
}).strict().refine((o) => o.alt_text !== undefined || o.caption !== undefined, { message: 'empty_patch' });