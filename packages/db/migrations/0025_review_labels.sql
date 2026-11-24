CREATE TABLE "review_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"finding_id" uuid,
	"run_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"cause" text NOT NULL,
	"note" text,
	"strategy" text,
	"strategy_version" integer,
	"models" jsonb,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_labels_decision" CHECK ("review_labels"."decision" IN ('approve', 'edit', 're_research', 'reject')),
	CONSTRAINT "review_labels_cause" CHECK ("review_labels"."cause" IN ('correct_as_cited', 'wrong_geography', 'wrong_year', 'value_not_on_page', 'home_page_link', 'wrong_measure', 'out_of_date', 'source_unreadable', 'better_source', 'unsupported', 'placeholder', 'other')),
	CONSTRAINT "review_labels_approval_cause" CHECK (("review_labels"."decision" = 'approve') = ("review_labels"."cause" = 'correct_as_cited')),
	CONSTRAINT "review_labels_other_note" CHECK ("review_labels"."cause" <> 'other' OR coalesce(length(btrim("review_labels"."note")), 0) > 0),
	CONSTRAINT "review_labels_note_length" CHECK ("review_labels"."note" IS NULL OR char_length("review_labels"."note") <= 4000),
	CONSTRAINT "review_labels_provider" CHECK ("review_labels"."provider" IN ('anthropic', 'openai', 'google'))
);
--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_labels" ADD CONSTRAINT "review_labels_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_labels_tenant_created_idx" ON "review_labels" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "review_labels_finding_idx" ON "review_labels" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "review_labels_run_idx" ON "review_labels" USING btree ("run_id");--> statement-breakpoint
-- ---- Why each review decision was made ----
-- One row per finding a reviewer decision covers (approve, edit, re-research,
-- or reject into a data gap), with the reviewer's cause (packages/core
-- review-causes.ts) and the strategy, version, models and provider of the
-- run that produced the finding. An approval always records
-- 'correct_as_cited'; every other decision records one of the reviewer's
-- causes, and 'other' carries the reviewer's own words. A decision about a
-- dimension that had no findings in the run records one row with no
-- finding.
--
-- Who writes it. The review actions write rows as the signed-in editor,
-- inside the same transaction as the decision (apps/web lib/review-actions.ts,
-- machine-audit-actions.ts, actions.ts saveDimensionEdit), so a refused
-- decision records nothing. The app role may read and insert, never update
-- or delete; each row must name the acting user as its reviewer. Nobody may
-- update a row; rows go only with their portrait, run, dimension or finding.
ALTER TABLE review_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON review_labels FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON review_labels TO deep_fryer_app;
--> statement-breakpoint
CREATE POLICY review_labels_editor_read ON review_labels FOR SELECT
  USING (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY review_labels_editor_insert ON review_labels FOR INSERT
  WITH CHECK (is_editor(tenant_id) AND reviewer_id = auth.uid());
--> statement-breakpoint
-- A row's run and dimension belong to its portrait, and its finding was
-- recorded for that dimension by that run. Runs as the inserting role, so
-- the app role can only point at rows it can see.
CREATE FUNCTION public.review_labels_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM research_runs WHERE id = NEW.run_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Review label run belongs to another portrait';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dimensions WHERE id = NEW.dimension_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Review label dimension belongs to another portrait';
  END IF;
  IF NEW.finding_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM findings f JOIN research_sessions s ON s.id = f.session_id
    WHERE f.id = NEW.finding_id AND f.dimension_id = NEW.dimension_id AND s.run_id = NEW.run_id
  ) THEN
    RAISE EXCEPTION 'Review label finding is not from this run and dimension';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_labels_guard BEFORE INSERT ON review_labels
  FOR EACH ROW EXECUTE FUNCTION public.review_labels_guard();
--> statement-breakpoint
CREATE TRIGGER review_labels_immutable BEFORE UPDATE ON review_labels
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
