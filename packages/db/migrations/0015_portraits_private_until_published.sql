ALTER TABLE "tenants" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
-- ---- Portraits are private until they first publish ----
-- Setting up an organization and a portrait is free and self-serve; building
-- one (research) is paid. A portrait that has published nothing is a draft:
-- no reviewed numbers, and its name, region and description are whatever was
-- typed into the sign-up form. So a portrait becomes PUBLIC only once it has
-- published at least one dimension version, and stays public after that
-- until it is archived. Before that, only its members see it — tenant
-- members and the owners of the organization holding it (member_role(),
-- 0003) — plus the organization's other members (billing contacts), who see
-- that the portrait exists but none of its content.
--
-- tenants.first_published_at records the moment. The database writes it, on
-- every publish path at once: a trigger on dimension_versions sets it when
-- the first version of any of the portrait's dimensions gets a published_at
-- (the web app's publish, approve-and-publish and revert, and the scripts —
-- import, publish-reviewed, seed — all set published_at, as an UPDATE or on
-- INSERT). published_at is the field the public plane already treats as
-- "published" (dimension_versions_public_read, 0005), so a portrait is public
-- exactly when something of it is on the public record. Nothing clears it,
-- and the app role cannot write it (the guard below): un-publishing a
-- portrait is archiving it.
--
-- Existing portraits that have published anything keep being public:
-- the backfill gives them their earliest published_at.
UPDATE tenants t
   SET first_published_at = p.first_published_at
  FROM (
    SELECT d.tenant_id, min(v.published_at) AS first_published_at
      FROM dimension_versions v
      JOIN dimensions d ON d.id = v.dimension_id
     WHERE v.published_at IS NOT NULL
     GROUP BY d.tenant_id
  ) p
 WHERE p.tenant_id = t.id;
--> statement-breakpoint
-- SECURITY DEFINER: editors publish (dimension_versions_editor_update), but
-- only owners may update tenants (tenants_owner_update, 0001), and the app
-- role is barred from this column by the guard below — which exempts this
-- function, because a definer function runs as the table owner. Sets the
-- column once: a later publish (or a publish of an older version, a revert)
-- never moves it. Two first publishes at once both try; the second waits for
-- the first's row lock and then, re-reading the committed row, finds it set
-- and changes nothing.
CREATE OR REPLACE FUNCTION public.dimension_versions_first_publish() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    UPDATE tenants t
       SET first_published_at = NEW.published_at
      FROM dimensions d
     WHERE d.id = NEW.dimension_id
       AND t.id = d.tenant_id
       AND t.first_published_at IS NULL;
    RETURN NULL;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dimension_versions_first_publish() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER dimension_versions_first_publish
  AFTER INSERT OR UPDATE OF published_at ON dimension_versions
  FOR EACH ROW WHEN (NEW.published_at IS NOT NULL)
  EXECUTE FUNCTION public.dimension_versions_first_publish();
--> statement-breakpoint
-- Owners update their portrait's row (name, description, embed origins…),
-- and a table-wide UPDATE grant cannot exclude one column (0012), so — as
-- for comments (0006) and research funding (0012) — a trigger keeps
-- first_published_at out of the app role's reach: setting it would make a
-- portrait with nothing reviewed public, and clearing it would hide a
-- published one without archiving it. The app role inserts no tenants (no
-- INSERT policy); the INSERT check holds even if one is ever added. The
-- system context — provisioning, scripts, the publish trigger above — is
-- exempt.
CREATE OR REPLACE FUNCTION public.tenants_first_published_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user <> 'deep_fryer_app' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.first_published_at IS NOT NULL THEN
        RAISE EXCEPTION 'a portrait becomes public when it first publishes a dimension; first_published_at is set by the database';
      END IF;
    ELSIF NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'a portrait becomes public when it first publishes a dimension; first_published_at is set by the database';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER tenants_first_published_guard
  BEFORE INSERT OR UPDATE OF first_published_at ON tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_first_published_guard();
--> statement-breakpoint
-- ---- The rule, in one place ----
-- Is this portrait on the public plane? Live (not archived) and published at
-- least once. SECURITY DEFINER so policies on other tables can ask without
-- the caller's own tenants policies deciding the answer, and without
-- recursing through them. Only a boolean leaves these functions.
CREATE OR REPLACE FUNCTION public.tenant_is_public(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM tenants
       WHERE id = p_tenant_id AND archived_at IS NULL AND first_published_at IS NOT NULL
    )
  $$;
--> statement-breakpoint
-- The same, for rows keyed by a dimension or an outreach contact rather than
-- by the portrait. Looked up as the owner, not through the caller's policies
-- on dimensions or outreach_contacts: a published version stays on the
-- public record of a public portrait even if its dimension later stops
-- pointing at it ("anything ever published is the public record", 0005).
CREATE OR REPLACE FUNCTION public.dimension_tenant_is_public(p_dimension_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM dimensions d JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = p_dimension_id AND t.archived_at IS NULL AND t.first_published_at IS NOT NULL
    )
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.outreach_contact_tenant_is_public(p_contact_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM outreach_contacts c JOIN tenants t ON t.id = c.tenant_id
       WHERE c.id = p_contact_id AND t.archived_at IS NULL AND t.first_published_at IS NOT NULL
    )
  $$;
--> statement-breakpoint
-- An organization is on the public plane when it holds at least one public
-- portrait: its hub, compare, insights and progress pages show nothing but
-- its public portraits, so an organization with none has no public pages —
-- and a name typed into the free sign-up form is not published under the
-- deployment's address until research behind it is.
CREATE OR REPLACE FUNCTION public.organization_is_public(p_organization_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM tenants
       WHERE organization_id = p_organization_id AND archived_at IS NULL AND first_published_at IS NOT NULL
    )
  $$;
--> statement-breakpoint
-- ---- Who reads a portrait's row ----
DROP POLICY IF EXISTS tenants_public_read ON tenants;
--> statement-breakpoint
CREATE POLICY tenants_public_read ON tenants FOR SELECT
  USING (archived_at IS NULL AND first_published_at IS NOT NULL);
--> statement-breakpoint
-- Members already read their portraits (tenants_member_read). The
-- organization's other members (its billing contacts) used to see every
-- portrait it holds through the public read; they keep seeing their own
-- organization's portraits listed on its hub, and nothing more: every child
-- table below still asks for a public portrait or a portrait member.
DROP POLICY IF EXISTS tenants_organization_member_read ON tenants;
--> statement-breakpoint
CREATE POLICY tenants_organization_member_read ON tenants FOR SELECT
  USING (is_org_member(organization_id));
--> statement-breakpoint
DROP POLICY IF EXISTS organizations_public_read ON organizations;
--> statement-breakpoint
CREATE POLICY organizations_public_read ON organizations FOR SELECT
  USING (archived_at IS NULL AND organization_is_public(id));
--> statement-breakpoint
-- ---- Everything keyed by a portrait follows its portrait ----
-- Each public-read policy keeps its own row rule (published, not archived,
-- methodology keys…) and now also needs the portrait to be public. Members
-- keep their own read policies (0001, 0008, 0010), unchanged. Archived
-- portraits' rows leave the public plane with them.
--
-- Methodology inputs and flags are public for public portraits. The list is
-- 0011's plus `sample_data`, the flag scripts/seed-demo-data.ts sets on the
-- portraits it fills with synthetic numbers, so every public page can say
-- "Sample data — not research".
DROP POLICY IF EXISTS tenant_config_public_read ON tenant_config;
--> statement-breakpoint
CREATE POLICY tenant_config_public_read ON tenant_config FOR SELECT
  USING (
    key IN ('region', 'source_priority', 'recency', 'scale_policy', 'threshold_overrides', 'progress', 'emergency', 'features', 'sample_data')
    AND tenant_is_public(tenant_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS dimensions_public_read ON dimensions;
--> statement-breakpoint
CREATE POLICY dimensions_public_read ON dimensions FOR SELECT
  USING (published_version_id IS NOT NULL AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS dimension_versions_public_read ON dimension_versions;
--> statement-breakpoint
CREATE POLICY dimension_versions_public_read ON dimension_versions FOR SELECT
  USING (published_at IS NOT NULL AND dimension_tenant_is_public(dimension_id));
--> statement-breakpoint
DROP POLICY IF EXISTS moderation_actions_public_lock_read ON moderation_actions;
--> statement-breakpoint
CREATE POLICY moderation_actions_public_lock_read ON moderation_actions FOR SELECT
  USING (action IN ('lock', 'restore') AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS outreach_contacts_public_read ON outreach_contacts;
--> statement-breakpoint
CREATE POLICY outreach_contacts_public_read ON outreach_contacts FOR SELECT
  USING (archived_at IS NULL AND published_version_id IS NOT NULL AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS outreach_contact_versions_public_read ON outreach_contact_versions;
--> statement-breakpoint
CREATE POLICY outreach_contact_versions_public_read ON outreach_contact_versions FOR SELECT
  USING (published_at IS NOT NULL AND outreach_contact_tenant_is_public(contact_id));
--> statement-breakpoint
-- Hazards, plans, resources and listings carry their own `published` flag,
-- which an editor can set on a portrait that has published nothing else.
DROP POLICY IF EXISTS hazards_public_read ON hazards;
--> statement-breakpoint
CREATE POLICY hazards_public_read ON hazards FOR SELECT
  USING (published AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS emergency_plans_public_read ON emergency_plans;
--> statement-breakpoint
CREATE POLICY emergency_plans_public_read ON emergency_plans FOR SELECT
  USING (published AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS emergency_resources_public_read ON emergency_resources;
--> statement-breakpoint
CREATE POLICY emergency_resources_public_read ON emergency_resources FOR SELECT
  USING (published AND tenant_is_public(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS involvement_listings_public_read ON involvement_listings;
--> statement-breakpoint
CREATE POLICY involvement_listings_public_read ON involvement_listings FOR SELECT
  USING (published AND tenant_is_public(tenant_id));
--> statement-breakpoint
-- Discussion, alerts and alert-sync health had no member policy of their
-- own — everyone read them (0001, 0008) — so their one read policy now
-- names both: a public portrait's, or the reader's own portrait's.
DROP POLICY IF EXISTS comments_public_read ON comments;
--> statement-breakpoint
CREATE POLICY comments_public_read ON comments FOR SELECT
  USING (tenant_is_public(tenant_id) OR is_member(tenant_id));
--> statement-breakpoint
-- A vote is visible exactly when its comment is: the subquery runs under the
-- reader's own policies on comments (the one above). People always see their
-- own votes (comment_votes_own_write).
DROP POLICY IF EXISTS comment_votes_public_read ON comment_votes;
--> statement-breakpoint
CREATE POLICY comment_votes_public_read ON comment_votes FOR SELECT
  USING (EXISTS (SELECT 1 FROM comments c WHERE c.id = comment_id));
--> statement-breakpoint
DROP POLICY IF EXISTS emergency_alerts_public_read ON emergency_alerts;
--> statement-breakpoint
CREATE POLICY emergency_alerts_public_read ON emergency_alerts FOR SELECT
  USING (tenant_is_public(tenant_id) OR is_member(tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS emergency_alert_syncs_public_read ON emergency_alert_syncs;
--> statement-breakpoint
CREATE POLICY emergency_alert_syncs_public_read ON emergency_alert_syncs FOR SELECT
  USING (tenant_is_public(tenant_id) OR is_member(tenant_id));
--> statement-breakpoint
-- Signed-in residents comment on what they can read: a stranger cannot post
-- into a portrait that is not public, even knowing its ids. (The public
-- inserts of involvement submissions and translation requests, 0010 and
-- 0011, already check the portrait through a subquery on tenants that runs
-- under the caller's own policies, so they follow tenants_public_read above
-- with no change.)
DROP POLICY IF EXISTS comments_author_insert ON comments;
--> statement-breakpoint
CREATE POLICY comments_author_insert ON comments FOR INSERT
  WITH CHECK (auth.uid() = author_id AND (tenant_is_public(tenant_id) OR is_member(tenant_id)));
--> statement-breakpoint
-- ---- Definer functions the public plane calls ----
-- published_doughnut() was SECURITY DEFINER (0001, from when anonymous
-- Supabase clients had no table grants), so it answered for any portrait,
-- whoever asked. It now runs as the caller and sees what the caller's
-- policies allow: an anonymous visitor gets nothing for a portrait that is
-- not public (the page is a 404); its members get the portrait (with no
-- dimensions until one is published); the system context (the worker's
-- policy analysis, local dev mode) reads any portrait, as it reads
-- everything else. It still returns published versions only — it joins on
-- published_version_id — so a member sees no drafts through it.
CREATE OR REPLACE FUNCTION public.published_doughnut(p_slug text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
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
-- The "Staff" label (0010) answers for a portrait the reader can see, and
-- for no other: otherwise anyone holding a private portrait's id could test
-- who works on it. (public_display_names is not keyed by portrait; the two
-- rate-limit counts, involvement_submission_counts and
-- translation_request_count, count the caller's own requests and guard
-- inserts that tenants_public_read now refuses for a portrait that is not
-- public.)
CREATE OR REPLACE FUNCTION public.public_staff_ids(p_tenant_id uuid, p_ids uuid[])
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT DISTINCT u.id FROM unnest(p_ids) AS u(id)
    WHERE (tenant_is_public(p_tenant_id) OR is_member(p_tenant_id))
      AND (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = u.id)
        OR EXISTS (SELECT 1 FROM tenants t
                     JOIN organization_members om ON om.organization_id = t.organization_id
                    WHERE t.id = p_tenant_id AND om.user_id = u.id AND om.role = 'owner'))
  $$;
