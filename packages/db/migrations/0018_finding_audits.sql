CREATE TABLE finding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('workflow', 'tier_audit')),
  disposition text NOT NULL CHECK (disposition IN ('approve', 'edit', 're_research', 'reject')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  correction jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_version_id uuid REFERENCES dimension_versions(id),
  applied_run_id uuid REFERENCES research_runs(id),
  applied_by uuid REFERENCES users(id),
  applied_at timestamptz,
  CONSTRAINT finding_audits_finding_source_uniq UNIQUE (finding_id, source),
  CHECK ((disposition = 'edit') = (correction IS NOT NULL)),
  CHECK ((applied_at IS NULL AND applied_by IS NULL AND applied_version_id IS NULL AND applied_run_id IS NULL)
    OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND
       ((applied_version_id IS NOT NULL)::int + (applied_run_id IS NOT NULL)::int = 1)))
);
--> statement-breakpoint
ALTER TABLE finding_audits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON finding_audits FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT ON finding_audits TO deep_fryer_app;
--> statement-breakpoint
GRANT UPDATE (applied_version_id, applied_run_id, applied_by, applied_at) ON finding_audits TO deep_fryer_app;
--> statement-breakpoint
CREATE POLICY finding_audits_member_read ON finding_audits FOR SELECT USING (
  EXISTS (SELECT 1 FROM findings f JOIN dimensions d ON d.id = f.dimension_id
          WHERE f.id = finding_id AND is_member(d.tenant_id))
);
--> statement-breakpoint
CREATE POLICY finding_audits_editor_apply ON finding_audits FOR UPDATE USING (
  EXISTS (SELECT 1 FROM findings f JOIN dimensions d ON d.id = f.dimension_id
          WHERE f.id = finding_id AND is_editor(d.tenant_id))
) WITH CHECK (applied_by = auth.uid());
--> statement-breakpoint
CREATE FUNCTION finding_audits_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE finding_dim uuid; finding_tenant uuid;
BEGIN
  IF (to_jsonb(NEW) - ARRAY['applied_version_id','applied_run_id','applied_by','applied_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['applied_version_id','applied_run_id','applied_by','applied_at'])
     OR OLD.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'Finding audits are immutable; an application may be recorded only once';
  END IF;
  SELECT f.dimension_id, d.tenant_id INTO finding_dim, finding_tenant
    FROM findings f JOIN dimensions d ON d.id=f.dimension_id WHERE f.id=NEW.finding_id;
  IF NEW.applied_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dimension_versions WHERE id=NEW.applied_version_id AND dimension_id=finding_dim
  ) THEN RAISE EXCEPTION 'Applied version belongs to another dimension'; END IF;
  IF NEW.applied_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM research_runs WHERE id=NEW.applied_run_id AND tenant_id=finding_tenant
  ) THEN RAISE EXCEPTION 'Applied run belongs to another portrait'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finding_audits_guard BEFORE UPDATE ON finding_audits
FOR EACH ROW EXECUTE FUNCTION finding_audits_guard();
