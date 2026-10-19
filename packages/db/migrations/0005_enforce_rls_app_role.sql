-- Database-enforced access (SPEC-v3 §2.2 items 1–2, SPEC-v4 §6).
--
-- User-driven work runs inside a transaction that does
--   SET LOCAL ROLE deep_fryer_app;
--   SELECT set_config('app.user_id', <user id or ''>, true);
-- (packages/db withAuthContext). deep_fryer_app is not a table owner and
-- has no BYPASSRLS, so every policy below applies to it, independently of the
-- app-layer role checks. System operations (Auth.js adapter, Stripe webhook,
-- the research worker, provisioning, cross-portrait quota math, invitation
-- acceptance, audit writes) keep the owner role — always after an app-layer
-- authorization check — which is why tables are not FORCE'd: the owner is
-- the system context by design, and the app role is the enforced one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deep_fryer_app') THEN
    CREATE ROLE deep_fryer_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
-- The connecting (owner) role must be able to SET ROLE to it.
DO $$
BEGIN
  EXECUTE format('GRANT deep_fryer_app TO %I', current_user);
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO deep_fryer_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO deep_fryer_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deep_fryer_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deep_fryer_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deep_fryer_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO deep_fryer_app;
--> statement-breakpoint

-- Identity and billing plumbing is system-only: the user role never touches
-- login accounts, sessions, sign-in tokens, or the Stripe event ledger.
REVOKE ALL ON accounts, sessions, verification_tokens, billing_events FROM deep_fryer_app;
--> statement-breakpoint

-- Session transcripts are owner/audit material (SPEC §11). The user role can
-- read every research_sessions column except transcript; owners download
-- transcripts through the system path after an owner check.
REVOKE SELECT ON research_sessions FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT (id, run_id, dimension_id, kind, status, reviewer_notes, started_at, completed_at)
  ON research_sessions TO deep_fryer_app;
--> statement-breakpoint

-- ---- Public plane: what anonymous visitors may read ----

CREATE POLICY tenants_public_read ON tenants FOR SELECT
  USING (archived_at IS NULL);
--> statement-breakpoint
CREATE POLICY organizations_public_read ON organizations FOR SELECT
  USING (archived_at IS NULL);
--> statement-breakpoint
-- Methodology inputs are published by design ("config is the methodology");
-- behavior settings (review policy, notifications, retention, features) are not.
CREATE POLICY tenant_config_public_read ON tenant_config FOR SELECT
  USING (key IN ('region', 'source_priority', 'recency', 'scale_policy', 'threshold_overrides', 'progress'));
--> statement-breakpoint
CREATE POLICY dimensions_public_read ON dimensions FOR SELECT
  USING (published_version_id IS NOT NULL);
--> statement-breakpoint
-- Anything ever published is the public record (progress history reads it);
-- drafts are visible to members only.
CREATE POLICY dimension_versions_public_read ON dimension_versions FOR SELECT
  USING (published_at IS NOT NULL);
--> statement-breakpoint
-- Thread lock state is public; other moderation records are not.
CREATE POLICY moderation_actions_public_lock_read ON moderation_actions FOR SELECT
  USING (action IN ('lock', 'restore'));
--> statement-breakpoint
CREATE POLICY outreach_contacts_public_read ON outreach_contacts FOR SELECT
  USING (archived_at IS NULL AND published_version_id IS NOT NULL);
--> statement-breakpoint
CREATE POLICY outreach_contact_versions_public_read ON outreach_contact_versions FOR SELECT
  USING (published_at IS NOT NULL);
--> statement-breakpoint

-- Anyone may leave a portrait (the app refuses if they are the last owner).
CREATE POLICY tenant_members_self_leave ON tenant_members FOR DELETE
  USING (user_id = auth.uid());
--> statement-breakpoint

-- ---- People ----

-- Do two people share a portrait or organization (directly, or because one
-- owns the organization holding the other's portrait)? SECURITY DEFINER so
-- the users policy can consult memberships without recursion.
CREATE OR REPLACE FUNCTION public.shares_scope(p_other uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM tenants t
       WHERE member_role(t.id) IS NOT NULL
         AND (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = t.id AND tm.user_id = p_other)
           OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = t.organization_id AND om.user_id = p_other))
    ) OR EXISTS (
      SELECT 1 FROM organization_members mine
       WHERE mine.user_id = auth.uid()
         AND (EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = mine.organization_id AND om.user_id = p_other)
           OR EXISTS (SELECT 1 FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id
                       WHERE t.organization_id = mine.organization_id AND tm.user_id = p_other))
    )
  $$;
--> statement-breakpoint
DROP POLICY IF EXISTS users_teammate_read ON users;
--> statement-breakpoint
CREATE POLICY users_teammate_read ON users FOR SELECT
  USING (shares_scope(id));
--> statement-breakpoint

-- Discussion boards show authors' display names to everyone, and nothing
-- else about them: a definer function exposes exactly (id, display_name).
CREATE OR REPLACE FUNCTION public.public_display_names(p_ids uuid[])
  RETURNS TABLE (id uuid, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT u.id, u.display_name FROM users u WHERE u.id = ANY (p_ids) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_display_names(uuid[]) TO deep_fryer_app;
