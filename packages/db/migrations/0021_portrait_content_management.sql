-- One stable public URL per dimension within a portrait, independent of ring.
ALTER TABLE dimensions ADD CONSTRAINT dimensions_tenant_slug_uniq UNIQUE (tenant_id, slug);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_dimension_structure() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'deep_fryer_app' THEN
    IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.slug IS DISTINCT FROM OLD.slug)
      THEN RAISE EXCEPTION 'dimension tenant and address are immutable'; END IF;
    IF public.member_role(NEW.tenant_id) IS DISTINCT FROM 'owner'
      THEN RAISE EXCEPTION 'dimension structure requires an owner'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER dimensions_structure_guard BEFORE INSERT OR UPDATE OF tenant_id, slug, ring, canonical_slug, display_order, archived_at
  ON dimensions FOR EACH ROW EXECUTE FUNCTION public.guard_dimension_structure();
--> statement-breakpoint
ALTER TABLE outreach_contact_versions ADD CONSTRAINT outreach_contact_versions_contact_version_uniq UNIQUE (contact_id, version_num);
--> statement-breakpoint
ALTER TABLE outreach_contacts ADD CONSTRAINT outreach_contacts_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES outreach_contact_versions(id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_outreach_publication() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    THEN RAISE EXCEPTION 'outreach contact tenant is immutable'; END IF;
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM outreach_contact_versions v WHERE v.id = NEW.published_version_id
      AND v.contact_id = NEW.id AND v.status = 'published' AND v.published_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'published outreach version must belong to the contact and be published'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outreach_contacts_publication_guard BEFORE INSERT OR UPDATE OF tenant_id, published_version_id
  ON outreach_contacts FOR EACH ROW EXECUTE FUNCTION public.guard_outreach_publication();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.keep_outreach_version_content() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.version_num IS DISTINCT FROM OLD.version_num
     OR NEW.data IS DISTINCT FROM OLD.data OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
  THEN RAISE EXCEPTION 'outreach contact content is immutable; create a new version'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outreach_contact_versions_immutable_content BEFORE UPDATE ON outreach_contact_versions
  FOR EACH ROW EXECUTE FUNCTION public.keep_outreach_version_content();
--> statement-breakpoint
REVOKE DELETE ON outreach_contacts, outreach_contact_versions FROM deep_fryer_app;
