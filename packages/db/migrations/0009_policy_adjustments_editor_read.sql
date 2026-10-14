ALTER TABLE "policy_analyses" ADD COLUMN "adjustments" jsonb;--> statement-breakpoint
-- The app role reads policy_analyses column by column (0008 withholds the
-- transcript), so a new column needs its own grant.
GRANT SELECT (adjustments) ON policy_analyses TO deep_fryer_app;
--> statement-breakpoint
-- SPEC-v5 §2: policy analysis is for portrait editors and owners, and
-- organization owners (member_role() maps them to owner) — not every member.
-- A brief can be unreleased policy text, so viewers and moderators must not
-- read analyses at the database layer either, whatever page or export asks.
-- The pages gate at 'editor' too; the two layers must agree.
DROP POLICY IF EXISTS policy_analyses_member_read ON policy_analyses;
--> statement-breakpoint
CREATE POLICY policy_analyses_editor_read ON policy_analyses FOR SELECT
  USING (is_editor(tenant_id));
