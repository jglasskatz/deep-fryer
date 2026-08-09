-- Reviewer notes & dispositions: integrity + immutability + RLS
-- (verification admin mode, SPEC.md §9; same posture as 0001_rls_policies).

-- A row must carry substance: a disposition, structured annotation, or prose.
ALTER TABLE review_notes ADD CONSTRAINT review_notes_has_substance
  CHECK (
    disposition IS NOT NULL
    OR annotation IS NOT NULL
    OR length(trim(coalesce(note, ''))) > 0
  );
--> statement-breakpoint

-- Dispositions are verdicts on one specific finding; free-floating verdicts
-- would be unactionable.
ALTER TABLE review_notes ADD CONSTRAINT review_notes_disposition_needs_finding
  CHECK (disposition IS NULL OR finding_id IS NOT NULL);
--> statement-breakpoint

-- Finding-scoped rows carry their dimension so triage rollups never re-join
-- through findings.
ALTER TABLE review_notes ADD CONSTRAINT review_notes_finding_carries_dimension
  CHECK (finding_id IS NULL OR dimension_id IS NOT NULL);
--> statement-breakpoint

-- Rejecting attests that something specific is wrong: a machine-readable
-- reason code or a written reason is required (review-disposes-each-flag).
ALTER TABLE review_notes ADD CONSTRAINT review_notes_reject_needs_reason
  CHECK (
    disposition IS DISTINCT FROM 'rejected'
    OR length(trim(coalesce(note, ''))) > 0
    OR annotation ->> 'reason_code' IS NOT NULL
  );
--> statement-breakpoint

-- Append-only, like findings: re-dispositioning appends a new row; the full
-- who-overrode-whom history is the record. Reuses 0001's forbid_mutation().
CREATE TRIGGER review_notes_immutable
  BEFORE UPDATE OR DELETE ON review_notes
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
--> statement-breakpoint

ALTER TABLE review_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Every tenant member reads reviewer reasoning (cross-reviewer visibility);
-- editors write, and only as themselves.
CREATE POLICY review_notes_member_read ON review_notes FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY review_notes_editor_insert ON review_notes FOR INSERT
  WITH CHECK (is_editor(tenant_id) AND auth.uid() = reviewer_id);
