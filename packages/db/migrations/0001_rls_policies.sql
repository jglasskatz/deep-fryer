-- RLS + immutability enforcement (SPEC.md §7 immutability contract, §11 auth & RLS).
--
-- Runs on Supabase (auth schema present) and on plain Postgres for local dev:
-- the DO block below shims auth.uid() only when it does not already exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
--> statement-breakpoint

-- Role of the calling user on a tenant, or NULL. SECURITY DEFINER so policies
-- can consult membership without recursing through tenant_members RLS.
CREATE OR REPLACE FUNCTION public.member_role(p_tenant_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT role::text FROM tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_member(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT member_role(p_tenant_id) IS NOT NULL $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_editor(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT member_role(p_tenant_id) IN ('owner', 'editor') $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_moderator(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT member_role(p_tenant_id) IN ('owner', 'editor', 'moderator') $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_owner(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT member_role(p_tenant_id) = 'owner' $$;
--> statement-breakpoint

-- The public read path (SPEC.md §11): everything the public plane may see,
-- and nothing else. Published versions only, joined in one shot.
CREATE OR REPLACE FUNCTION public.published_doughnut(p_slug text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT jsonb_build_object(
      'tenant', jsonb_build_object(
        'slug', t.slug, 'name', t.name, 'region', t.region,
        'population', t.population, 'description', t.description,
        'branding', t.branding
      ),
      'dimensions', COALESCE(
        (SELECT jsonb_agg(
           jsonb_build_object(
             'slug', d.slug, 'ring', d.ring, 'canonical_slug', d.canonical_slug,
             'display_order', d.display_order,
             'viz_level', v.viz_level, 'data', v.data,
             'published_at', v.published_at, 'version_num', v.version_num
           ) ORDER BY d.ring, d.display_order)
         FROM dimensions d
         JOIN dimension_versions v ON v.id = d.published_version_id
         WHERE d.tenant_id = t.id AND d.archived_at IS NULL),
        '[]'::jsonb
      )
    )
    FROM tenants t
    WHERE t.slug = p_slug AND t.archived_at IS NULL
  $$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.published_doughnut(text) TO anon, authenticated;
--> statement-breakpoint

-- ---- Immutability triggers (below RLS, so even service_role obeys) ----

CREATE OR REPLACE FUNCTION public.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION '% rows are immutable (SPEC.md §7)', TG_TABLE_NAME;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER findings_immutable
  BEFORE UPDATE OR DELETE ON findings
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
--> statement-breakpoint

-- dimension_versions: status/published_at may transition (draft→published→archived);
-- data, origin, and provenance columns may not change once written.
CREATE OR REPLACE FUNCTION public.dimension_versions_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.data IS DISTINCT FROM OLD.data
       OR NEW.origin IS DISTINCT FROM OLD.origin
       OR NEW.research_run_id IS DISTINCT FROM OLD.research_run_id
       OR NEW.change_note IS DISTINCT FROM OLD.change_note
       OR NEW.viz_level IS DISTINCT FROM OLD.viz_level
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'dimension_versions content is immutable; create a new version (SPEC.md §7)';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER dimension_versions_immutable_content
  BEFORE UPDATE ON dimension_versions
  FOR EACH ROW EXECUTE FUNCTION public.dimension_versions_guard();
--> statement-breakpoint

-- Human edits meet the same provenance bar as research: change_note required.
ALTER TABLE dimension_versions ADD CONSTRAINT human_versions_need_change_note
  CHECK (origin <> 'human' OR change_note IS NOT NULL);
--> statement-breakpoint

ALTER TABLE dimension_versions ADD CONSTRAINT research_versions_need_run
  CHECK (origin <> 'research' OR research_run_id IS NOT NULL);
--> statement-breakpoint

-- ---- Enable RLS ----

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimension_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comment_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outreach_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outreach_contact_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE custom_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE custom_page_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---- Policies ----

CREATE POLICY tenants_member_read ON tenants FOR SELECT
  USING (is_member(id));
--> statement-breakpoint
CREATE POLICY tenants_owner_update ON tenants FOR UPDATE
  USING (is_owner(id)) WITH CHECK (is_owner(id));
--> statement-breakpoint

CREATE POLICY tenant_config_member_read ON tenant_config FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY tenant_config_owner_write ON tenant_config FOR ALL
  USING (is_owner(tenant_id)) WITH CHECK (is_owner(tenant_id));
--> statement-breakpoint

CREATE POLICY tenant_members_member_read ON tenant_members FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY tenant_members_owner_write ON tenant_members FOR ALL
  USING (is_owner(tenant_id)) WITH CHECK (is_owner(tenant_id));
--> statement-breakpoint

CREATE POLICY dimensions_member_read ON dimensions FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY dimensions_editor_write ON dimensions FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint

CREATE POLICY dimension_versions_member_read ON dimension_versions FOR SELECT
  USING (is_member((SELECT tenant_id FROM dimensions WHERE id = dimension_id)));
--> statement-breakpoint
CREATE POLICY dimension_versions_editor_insert ON dimension_versions FOR INSERT
  WITH CHECK (is_editor((SELECT tenant_id FROM dimensions WHERE id = dimension_id)));
--> statement-breakpoint
CREATE POLICY dimension_versions_editor_update ON dimension_versions FOR UPDATE
  USING (is_editor((SELECT tenant_id FROM dimensions WHERE id = dimension_id)))
  WITH CHECK (is_editor((SELECT tenant_id FROM dimensions WHERE id = dimension_id)));
--> statement-breakpoint

CREATE POLICY research_runs_member_read ON research_runs FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY research_runs_editor_write ON research_runs FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint

CREATE POLICY research_sessions_member_read ON research_sessions FOR SELECT
  USING (is_member((SELECT tenant_id FROM research_runs WHERE id = run_id)));
--> statement-breakpoint

CREATE POLICY findings_member_read ON findings FOR SELECT
  USING (is_member((SELECT tenant_id FROM dimensions WHERE id = dimension_id)));
--> statement-breakpoint

-- Transcript access is owner-only (§11): the column is revoked from client
-- roles entirely; owners read it through this gated function.
REVOKE SELECT (transcript) ON research_sessions FROM anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.session_transcript(p_session_id uuid) RETURNS bytea
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_tenant uuid;
    v_transcript bytea;
  BEGIN
    SELECT r.tenant_id, s.transcript INTO v_tenant, v_transcript
      FROM research_sessions s JOIN research_runs r ON r.id = s.run_id
      WHERE s.id = p_session_id;
    IF v_tenant IS NULL OR NOT is_owner(v_tenant) THEN
      RAISE EXCEPTION 'transcript access is restricted to tenant owners';
    END IF;
    RETURN v_transcript;
  END
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.session_transcript(uuid) TO authenticated;
--> statement-breakpoint

-- Discussion: world-readable, sign-in to write, authors edit their own,
-- moderators act through moderation_actions + the removal columns.
CREATE POLICY comments_public_read ON comments FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY comments_author_insert ON comments FOR INSERT
  WITH CHECK (auth.uid() = author_id);
--> statement-breakpoint
CREATE POLICY comments_author_or_moderator_update ON comments FOR UPDATE
  USING (auth.uid() = author_id OR is_moderator(tenant_id))
  WITH CHECK (auth.uid() = author_id OR is_moderator(tenant_id));
--> statement-breakpoint

CREATE POLICY comment_votes_public_read ON comment_votes FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY comment_votes_own_write ON comment_votes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY moderation_actions_member_read ON moderation_actions FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY moderation_actions_moderator_insert ON moderation_actions FOR INSERT
  WITH CHECK (is_moderator(tenant_id) AND auth.uid() = actor_id);
--> statement-breakpoint

CREATE POLICY outreach_contacts_member_read ON outreach_contacts FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY outreach_contacts_editor_write ON outreach_contacts FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY outreach_contact_versions_member_read ON outreach_contact_versions FOR SELECT
  USING (is_member((SELECT tenant_id FROM outreach_contacts WHERE id = contact_id)));
--> statement-breakpoint
CREATE POLICY outreach_contact_versions_editor_write ON outreach_contact_versions FOR ALL
  USING (is_editor((SELECT tenant_id FROM outreach_contacts WHERE id = contact_id)))
  WITH CHECK (is_editor((SELECT tenant_id FROM outreach_contacts WHERE id = contact_id)));
--> statement-breakpoint

CREATE POLICY custom_pages_member_read ON custom_pages FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY custom_pages_editor_write ON custom_pages FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY custom_page_versions_member_read ON custom_page_versions FOR SELECT
  USING (is_member((SELECT tenant_id FROM custom_pages WHERE id = page_id)));
--> statement-breakpoint
CREATE POLICY custom_page_versions_editor_write ON custom_page_versions FOR ALL
  USING (is_editor((SELECT tenant_id FROM custom_pages WHERE id = page_id)))
  WITH CHECK (is_editor((SELECT tenant_id FROM custom_pages WHERE id = page_id)));
--> statement-breakpoint

CREATE POLICY audit_log_owner_read ON audit_log FOR SELECT
  USING (is_owner(tenant_id));
