-- Research runs are billing records once applied (SPEC-v4 §3, SPEC-v7 §4):
-- the gate counts each run's planned sessions in the period of its
-- applied_at, and the worker executes the run's `plan` on the key its
-- `funding` names. Until now the app role (deep_fryer_app, every signed-in
-- request) held table-wide UPDATE and DELETE on research_runs (0005) and
-- editors a FOR ALL policy (0001), so an editor's crafted request could move
-- an applied run's applied_at out of the current period, add sessions to its
-- plan after the gate had counted it, or rewrite its status — none of which
-- the app ever does.
--
-- What the app actually writes: it INSERTs a planned run as the editor
-- (apps/web/lib/research.ts createPlannedRun). Applying a run, clearing a
-- failed enqueue, removing a refused one-click plan, and everything the
-- worker does run as the table owner (systemDb), which neither grants nor
-- policies restrict. So the app role keeps SELECT and INSERT only, and may
-- insert nothing but an unapplied plan: status 'planned', no applied_at,
-- no timestamps of a run that has already happened.
--
-- Migration 0012's funding guard stays as a second layer (it also covers
-- any role that is later granted UPDATE or DELETE).
REVOKE UPDATE, DELETE ON research_runs FROM deep_fryer_app;
--> statement-breakpoint
DROP POLICY IF EXISTS research_runs_app_insert_planned ON research_runs;
--> statement-breakpoint
-- Restrictive: combined with AND on top of research_runs_editor_write, which
-- still decides who may insert (editors of the portrait).
CREATE POLICY research_runs_app_insert_planned ON research_runs AS RESTRICTIVE FOR INSERT TO deep_fryer_app
  WITH CHECK (status = 'planned' AND applied_at IS NULL AND completed_at IS NULL);
