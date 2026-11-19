-- Backfill CRM retention policy for tenant databases where tenant-006 ran
-- before the business row was copied/created. Keep existing policy timestamps.
INSERT INTO public.crm_retention_policy (tenant_id, policy_started_at, legacy_grace_until)
SELECT id, now(), now() + interval '30 days'
  FROM public.businesses
ON CONFLICT (tenant_id) DO NOTHING;

-- Initialize retention deadlines for legacy leads that tenant-006 could not
-- reach because their business/policy row did not yet exist at migration time.
UPDATE public.leads l
   SET retention_closed_at = CASE
         WHEN l.status IN ('rejected', 'cancelled', 'completed')
           THEN COALESCE(l.retention_closed_at, p.policy_started_at)
         ELSE l.retention_closed_at
       END,
       retention_expires_at = CASE
         WHEN l.status IN ('rejected', 'cancelled', 'completed')
           THEN GREATEST(COALESCE(l.retention_closed_at, p.policy_started_at) + interval '30 days', p.legacy_grace_until)
         ELSE GREATEST(l.created_at + interval '60 days', p.legacy_grace_until)
       END
  FROM public.crm_retention_policy p
 WHERE l.tenant_id = p.tenant_id
   AND l.retention_expires_at IS NULL;
