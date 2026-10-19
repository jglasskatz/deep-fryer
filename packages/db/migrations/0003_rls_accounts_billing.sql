-- RLS + integrity for accounts, organizations, and billing (SPEC-v4 §2–3),
-- plus the SPEC-v3 §2.2 policy repairs that do not depend on the app-role
-- switch.
--
-- auth.uid() now reads the per-transaction app.user_id setting (SPEC-v3
-- §2.2 item 2) instead of Supabase's JWT claim: Supabase is gone, and the
-- app sets app.user_id via set_config(..., true) when it runs work under a
-- user's authority.

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $fn$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $fn$;
--> statement-breakpoint

-- Organization roles. SECURITY DEFINER for the same reason as member_role():
-- policies consult membership without recursing through its own RLS.
CREATE OR REPLACE FUNCTION public.org_role(p_org_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT role::text FROM organization_members
    WHERE organization_id = p_org_id AND user_id = auth.uid()
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT org_role(p_org_id) IS NOT NULL $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT org_role(p_org_id) = 'owner' $$;
--> statement-breakpoint

-- An organization owner is an owner of every portrait the organization holds
-- (the NYC Mayor's Office administers all six portraits). Same rule as the
-- app layer's getRole() — the two enforcement layers must agree.
CREATE OR REPLACE FUNCTION public.member_role(p_tenant_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT COALESCE(
      (SELECT 'owner'::text
         FROM tenants t
         JOIN organization_members om ON om.organization_id = t.organization_id
        WHERE t.id = p_tenant_id AND om.user_id = auth.uid() AND om.role = 'owner'),
      (SELECT role::text FROM tenant_members
        WHERE tenant_id = p_tenant_id AND user_id = auth.uid())
    )
  $$;
--> statement-breakpoint

-- ---- Integrity repairs (SPEC-v3 §2.2 item 3) ----

ALTER TABLE comment_votes ADD CONSTRAINT comment_votes_vote_check CHECK (vote IN (-1, 1));
--> statement-breakpoint

-- published_version_id must point at a published version of the same
-- dimension. Declared here rather than in schema.ts because the
-- dimensions ⇄ dimension_versions cycle cannot be expressed in Drizzle's
-- table builders without circular type inference.
ALTER TABLE dimensions ADD CONSTRAINT dimensions_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES dimension_versions(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.dimensions_published_version_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM dimension_versions v
       WHERE v.id = NEW.published_version_id
         AND v.dimension_id = NEW.id
         AND v.status = 'published'
    ) THEN
      RAISE EXCEPTION 'published_version_id must reference a published version of this dimension';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER dimensions_published_version_guard
  BEFORE INSERT OR UPDATE OF published_version_id ON dimensions
  FOR EACH ROW EXECUTE FUNCTION public.dimensions_published_version_guard();
--> statement-breakpoint

-- Members write audit entries for their own actions (writes previously
-- depended on the owner bypass).
CREATE POLICY audit_log_member_insert ON audit_log FOR INSERT
  WITH CHECK (is_member(tenant_id));
--> statement-breakpoint

-- ---- RLS on the new tables ----
-- accounts / sessions / verification_tokens are touched only by the Auth.js
-- adapter and stay without RLS (the adapter is the auth system itself);
-- billing_events is written only by the verified Stripe webhook.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY users_self ON users FOR ALL
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--> statement-breakpoint
-- Teammates see each other (member lists, audit actors).
CREATE POLICY users_teammate_read ON users FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_members a JOIN tenant_members b ON a.tenant_id = b.tenant_id
     WHERE a.user_id = auth.uid() AND b.user_id = users.id
  ) OR EXISTS (
    SELECT 1 FROM organization_members a JOIN organization_members b ON a.organization_id = b.organization_id
     WHERE a.user_id = auth.uid() AND b.user_id = users.id
  ));
--> statement-breakpoint

CREATE POLICY organizations_member_read ON organizations FOR SELECT
  USING (is_org_member(id) OR EXISTS (
    SELECT 1 FROM tenants t WHERE t.organization_id = organizations.id AND is_member(t.id)
  ));
--> statement-breakpoint
CREATE POLICY organizations_owner_update ON organizations FOR UPDATE
  USING (is_org_owner(id)) WITH CHECK (is_org_owner(id));
--> statement-breakpoint

CREATE POLICY organization_members_member_read ON organization_members FOR SELECT
  USING (is_org_member(organization_id));
--> statement-breakpoint
CREATE POLICY organization_members_owner_write ON organization_members FOR ALL
  USING (is_org_owner(organization_id)) WITH CHECK (is_org_owner(organization_id));
--> statement-breakpoint

CREATE POLICY invitations_owner_all ON invitations FOR ALL
  USING (
    (tenant_id IS NOT NULL AND is_owner(tenant_id))
    OR (organization_id IS NOT NULL AND is_org_owner(organization_id))
  )
  WITH CHECK (
    (tenant_id IS NOT NULL AND is_owner(tenant_id))
    OR (organization_id IS NOT NULL AND is_org_owner(organization_id))
  );
--> statement-breakpoint

-- Plan + quota are visible to anyone working in the organization (editors see
-- their research allowance); only the webhook/staff path writes them.
CREATE POLICY subscriptions_member_read ON subscriptions FOR SELECT
  USING (is_org_member(organization_id) OR EXISTS (
    SELECT 1 FROM tenants t WHERE t.organization_id = subscriptions.organization_id AND is_member(t.id)
  ));
