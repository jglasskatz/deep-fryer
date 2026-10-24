-- Custom civic pages: immutable version content, safe publication pointers,
-- and public RLS only after the portrait itself has been published.
ALTER TABLE custom_page_versions ADD CONSTRAINT custom_page_versions_page_version_uniq UNIQUE (page_id, version_num);
--> statement-breakpoint
ALTER TABLE custom_pages ADD CONSTRAINT custom_pages_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES custom_page_versions(id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_custom_page_publication() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM custom_page_versions v WHERE v.id = NEW.published_version_id
      AND v.page_id = NEW.id AND v.status = 'published' AND v.published_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'published custom page version must belong to the page and be published';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER custom_pages_publication_guard BEFORE INSERT OR UPDATE OF published_version_id
  ON custom_pages FOR EACH ROW EXECUTE FUNCTION public.assert_custom_page_publication();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.keep_custom_page_version_content() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.version_num IS DISTINCT FROM OLD.version_num
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.mdx_body IS DISTINCT FROM OLD.mdx_body
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
  THEN RAISE EXCEPTION 'custom page content is immutable; create a new version';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER custom_page_versions_immutable_content BEFORE UPDATE ON custom_page_versions
  FOR EACH ROW EXECUTE FUNCTION public.keep_custom_page_version_content();
--> statement-breakpoint
-- Reversible unpublication preserves the version history; editors cannot
-- erase it by deleting a page (which would otherwise cascade its versions).
REVOKE DELETE ON custom_pages, custom_page_versions FROM deep_fryer_app;
--> statement-breakpoint
CREATE POLICY custom_pages_public_read ON custom_pages FOR SELECT
  USING (published_version_id IS NOT NULL AND public.tenant_is_public(tenant_id));
--> statement-breakpoint
CREATE POLICY custom_page_versions_public_read ON custom_page_versions FOR SELECT
  USING (EXISTS (SELECT 1 FROM custom_pages p WHERE p.id = page_id
    AND p.published_version_id = custom_page_versions.id AND public.tenant_is_public(p.tenant_id)));
