ALTER TABLE "research_sessions" ADD COLUMN IF NOT EXISTS "plan_session_index" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_sessions_run_plan_idx" ON "research_sessions" USING btree ("run_id","plan_session_index");--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "region_brief_cache" jsonb;--> statement-breakpoint
-- research_sessions uses column-level SELECT grants for deep_fryer_app so
-- transcript stays owner-only (migration 0005). Grant SELECT on the new
-- non-sensitive plan_session_index column so admin pages can match chunks
-- deterministically without opening transcripts.
GRANT SELECT (plan_session_index) ON research_sessions TO deep_fryer_app;
