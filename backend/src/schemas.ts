import { z } from 'zod';
import { normalizeILPhone } from './util';

export const LEAD_STATUSES = [
  'whatsapp_initiated', 'pending_approval', 'approved', 'rejected', 'completed', 'cancelled',
] as const;

const phoneOrNull = z.string().max(40).nullable().transform((v, ctx) => {
  if (v === null || v.trim() === '') return null;
  const n = normalizeILPhone(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'invalid_il_phone' }); return z.NEVER; }
  return n;
});

const phoneOptional = z.string().max(40).optional().transform((v, ctx) => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = normalizeILPhone(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'invalid_il_phone' }); return z.NEVER; }
  return n;
});

export const LeadInput = z.object({
  route: z.enum(['whatsapp', 'site']),
  idempotency_key: z.string().uuid().optional(),
  customer_name: z.string().trim().min(1).max(120).optional(),
  customer_phone: phoneOptional,
  customer_email: z.string().trim().max(254).optional()
    .transform((v) => v || undefined)
    .pipe(z.string().email().optional()),
  message: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  appointment_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(9999),
  })).max(50).default([]),
  company_website: z.string().max(200).optional(), // honeypot: real users leave it empty
}).strict()
  // The only required customer contact field is a phone number.
  .refine((v) => v.route !== 'site' || !!v.customer_phone, {
    message: 'contact_required', path: ['customer_phone'],
  })
  .refine((v) => v.items.length > 0 || !!v.message, {
    message: 'items_or_message_required', path: ['items'],
  });
export type LeadInputT = z.infer<typeof LeadInput>;

export const LeadListQuery = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const LeadStatusPatch = z.object({ status: z.enum(LEAD_STATUSES) }).strict();

export const LeadNoteInput = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

export const BusinessPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneOrNull.optional(),
  whatsapp_number: phoneOrNull.optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  about_text: z.string().trim().max(5000).nullable().optional(), // '' or null => hidden
  config: z.record(z.string(), z.unknown()).optional(),          // top-level sections, merged
}).strict();

export const LegalDoc = z.enum(['terms_of_use', 'privacy_policy', 'accessibility_statement']);
