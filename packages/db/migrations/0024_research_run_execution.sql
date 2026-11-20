ALTER TABLE "research_runs" ADD COLUMN "execution" jsonb;--> statement-breakpoint
-- ---- Where a research run ran ----
-- `execution` records who served a run's model calls (the provider), the
-- host name of the model API, what ran the sessions (the executor) and the
-- region of our host. The research gate writes it when the run is applied,
-- in the same system-context update as `funding` and applied_at
-- (apps/web/lib/research.ts applyRun). Review, the run page and the cost
-- export read it next to each session's recorded model; public pages and the
-- open-data API never do.
--
-- Existing rows stay NULL: nothing recorded where they ran, and the pages
-- say "provider not recorded" rather than guessing.
--
-- Who writes it. Only the system context. The app role (deep_fryer_app)
-- already has no UPDATE on research_runs (0013), so it can never set or
-- change `execution` on an existing run. It may still INSERT a planned run
-- as the editor (createPlannedRun); the restrictive policy below keeps that
-- insert from carrying an execution record of its own choosing, as 0013
-- keeps it from carrying applied_at or a finished status.
DROP POLICY IF EXISTS research_runs_app_insert_unexecuted ON research_runs;
--> statement-breakpoint
-- Restrictive: combined with AND on top of research_runs_editor_write and
-- research_runs_app_insert_planned.
CREATE POLICY research_runs_app_insert_unexecuted ON research_runs AS RESTRICTIVE FOR INSERT TO deep_fryer_app
  WITH CHECK (execution IS NULL);
