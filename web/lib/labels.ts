import type { LeadStatus } from './types';
export const LEAD_STATUSES: LeadStatus[] = [
  'pending_approval', 'whatsapp_initiated', 'approved', 'completed', 'rejected', 'cancelled',
];
export const STATUS_LABEL: Record<LeadStatus, string> = {
  pending_approval: 'ממתין לאישור',
  whatsapp_initiated: 'וואטסאפ נפתח',
  approved: 'אושר',
  completed: 'הושלם',
  rejected: 'נדחה',
  cancelled: 'בוטל',
};
export const DAYS = [
  ['sun', 'ראשון'], ['mon', 'שני'], ['tue', 'שלישי'], ['wed', 'רביעי'],
  ['thu', 'חמישי'], ['fri', 'שישי'], ['sat', 'שבת'],
] as const;