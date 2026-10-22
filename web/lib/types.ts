export type LeadStatus =  | 'whatsapp_initiated' | 'pending_approval' | 'approved'  | 'rejected' | 'completed' | 'cancelled';
export type OrderFlow = { whatsapp_enabled: boolean; site_inquiry_enabled: boolean; whatsapp_intro?: string };
export type DayHours = 'closed' | { open: string; close: string }[];
export type Product = {
  id: string;
  kind: 'product' | 'service';
  name: string;
  description: string | null;
  price_agorot: number | null;
  requires_appointment: boolean;
  booking_mode: 'none' | 'free_datetime' | 'availability';
  appointment_duration_minutes: number;
  image: { url: string; width: number | null; height: number | null } | null;
};
export type GalleryImage = {
  id: string; url: string; alt: string | null; caption: string | null;
  width: number | null; height: number | null;
};
export type PublicPayload = {
  business: {
    name: string; slug: string; phone: string | null; whatsapp_number: string | null;
    email: string | null; locale: string; timezone: string;
  };
  about: string | null;
  branding: { colors?: Partial<Record<'primary' | 'secondary' | 'accent' | 'background' | 'text', string>>; hero_gallery_image_id?: string; icon_gallery_image_id?: string; font_style?: 'modern' | 'rounded' | 'elegant' | 'warm' };
  social_links?: { instagram?: string; facebook?: string };
  business_profile?: { city?: string; street_address?: string; show_address?: boolean };
  site_mode: 'catalog_order' | 'services_whatsapp';
  order_flow: OrderFlow;
  opening_hours: {
    days: Record<string, DayHours> | null;
    open_now: boolean | null;
    show_out_of_hours_banner: boolean;
    banner_message: string | null;
  };
  catalog: { quote_label: string; items: Product[]; total: number; limit: number | null; offset: number; has_more: boolean };
  gallery: GalleryImage[];
  sections: { about: boolean; gallery: boolean };
  og: { title: string; description: string | null; image_url: string | null };
};
export type Lead = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  message: string | null;
  submission_channel: 'whatsapp' | 'site';
  status: LeadStatus;
  estimated_total_agorot: number | null;
  metadata: { has_quote_items?: boolean; appointment_at?: string; appointment_duration_minutes?: number; appointment_needs_coordination?: boolean };
  created_at: string;
  items: { name: string; unit_price_agorot: number | null; quantity: number }[];
};
export type LeadsResponse = { total: number; limit: number; offset: number; leads: Lead[] };
export type ManageBusiness = {
  name: string; slug: string; status: string;
  phone: string | null; whatsapp_number: string | null; email: string | null;
  about_text: string | null; locale: string; timezone: string;
  // Business config is server-validated JSON with feature-specific sections.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  domains: { domain: string; is_verified: boolean; is_primary: boolean }[];
};
// הוסף את השורות האלו בסוף הקובץ:
export type MProduct = {
  id: string;
  kind: 'product' | 'service';
  name: string;
  description: string | null;
  price_agorot: number | null;
  is_active: boolean;
  sort_order: number;
  image_url: string | null;
  requires_appointment: boolean;
  booking_mode: 'none' | 'free_datetime' | 'availability';
  appointment_duration_minutes: number;
};

export type MGalleryImage = {
  id: string;
  position: number;
  alt_text: string | null;
  caption: string | null;
  url: string;
};
export type MProductsResponse = { items: MProduct[]; total: number; limit: number; offset: number };
export type PublicCatalogPage = { items: Product[]; total: number; limit: number; offset: number; has_more: boolean };
