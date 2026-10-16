CREATE TYPE "public"."research_funding" AS ENUM('plan', 'organization_key');--> statement-breakpoint
ALTER TABLE "policy_analyses" ADD COLUMN "funding" "research_funding" DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "funding" "research_funding" DEFAULT 'plan' NOT NULL;--> statement-breakpoint
-- ---- Who pays for a research spend (SPEC-v7 §4) ----
-- The research gate (packages/db billing.ts gateResearchSpend) decides, under
-- the subscription lock, whether a research run or a policy analysis is paid
-- for by the plan's session allowance (on the deployment's key) or by the
-- organization's own Anthropic API key. Until now that decision was kept only
-- in the audit entry; the two columns above record it on the row, where the
-- allowance count (researchSessionsUsed counts 'plan' rows only) and the
-- worker (which key the sessions run on) read it.
--
-- Existing rows are 'plan' (the column default): the accounting before this
-- migration counted every run and analysis against the plan, so every count
-- stays what it was.
--
-- Who writes it. Both writes happen in the system context (the owner role),
-- inside the gate's own transaction: apps/web/lib/research.ts applyRun stamps
-- research_runs.funding together with applied_at, and
-- apps/web/lib/policy-actions.ts createPolicyAnalysis inserts the analysis
-- with it. The app role (deep_fryer_app, migration 0005) never writes it:
--
-- * policy_analyses: the app role has no INSERT or UPDATE policy (0008), so
--   it cannot write any column of the table. It reads the table column by
--   column (0008 withholds the transcript), so funding needs its own SELECT
--   grant, as adjustments did in 0009.
-- * research_runs: the app role holds table-wide privileges (0005) and editors
--   have a write policy for every command, DELETE included (0001;
--   createPlannedRun inserts the planned run as the person). A table-wide
--   UPDATE grant covers every column, and revoking a single column cannot
--   carve one out of it, so — as for comments (0006) — a trigger keeps funding
--   out of the app role's reach:
--   - a run it inserts is 'plan' (the default; nothing is funded before it is
--     applied, and applyRun overwrites it then);
--   - it can never change funding afterwards;
--   - it can neither delete a key-funded run nor give one another id or
--     portrait. The queued job names the run only by id (research-apply's
--     payload is {runId}) and the worker runs whatever 'planned' row has that
--     id, so deleting a key-funded run — or renumbering it — and inserting a
--     run under the old id would get a fresh 'plan' row run in its place.
--     Moving one to another portrait could charge another organization's key
--     on a decision made for this one.
--   Otherwise a request in a person's context could relabel a key-funded run
--   as plan-funded (moving it onto the deployment's key without an allowance
--   check) or the reverse (taking it out of the plan's count). Plan-funded
--   runs need no such care: whatever the app role does to one, a run it
--   inserts in its place is plan-funded again. A run's other columns (status,
--   applied_at, plan, …) stay as writable to the app role as they were before
--   this migration. The system context is exempt, and so are cascades from
--   deleting a portrait or an organization: Postgres runs a foreign key's
--   cascade as the table's owner. The app itself deletes a run only in the
--   system context (buildDoughnut's cleanup of a plan that was never applied).
--   Reading needs nothing new: SELECT on research_runs is table-wide.
GRANT SELECT (funding) ON policy_analyses TO deep_fryer_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.research_runs_funding_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user <> 'deep_fryer_app' THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.funding <> 'plan' THEN
        RAISE EXCEPTION 'a research run''s funding is decided by the research gate when it is applied';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF OLD.funding <> 'plan' THEN
        RAISE EXCEPTION 'a research run funded by the organization''s own API key cannot be deleted: its funding was decided by the research gate';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.funding IS DISTINCT FROM OLD.funding THEN
      RAISE EXCEPTION 'a research run''s funding is decided by the research gate and cannot be changed';
    END IF;
    IF OLD.funding <> 'plan'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'a research run funded by the organization''s own API key cannot be moved to another id or portrait: its funding was decided by the research gate';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER research_runs_funding_guard
  BEFORE INSERT OR UPDATE OF funding, id, tenant_id OR DELETE ON research_runs
  FOR EACH ROW EXECUTE FUNCTION public.research_runs_funding_guard();
