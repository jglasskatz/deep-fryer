-- Enforce the second-reviewer rule for user-context publications as well as
-- in the app. Owner-context migrations/imports remain an explicit system path.
CREATE FUNCTION public.version_dual_review_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE scope_id uuid; requires_second boolean; editing boolean;
BEGIN
  IF current_user <> 'deep_fryer_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND (NEW.created_by IS NULL OR NEW.created_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Version author must be the acting user';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
    IF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Original publication date is immutable';
    END IF;
    RETURN NEW; -- Restoring an already-reviewed public version is not a new edit.
  END IF;
  IF NEW.status <> 'published' AND NEW.published_at IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'dimension_versions' THEN
    SELECT tenant_id INTO scope_id FROM dimensions WHERE id = NEW.dimension_id;
    editing := NEW.origin = 'human';
  ELSIF TG_TABLE_NAME = 'custom_page_versions' THEN
    SELECT tenant_id INTO scope_id FROM custom_pages WHERE id = NEW.page_id;
    editing := true;
  ELSE
    SELECT tenant_id INTO scope_id FROM outreach_contacts WHERE id = NEW.contact_id;
    editing := true;
  END IF;
  SELECT value->'dual_review_on_edits' = 'true'::jsonb INTO requires_second
    FROM tenant_config WHERE tenant_id = scope_id AND key = 'review_policy';
  IF editing AND requires_second AND (NEW.created_by IS NULL OR NEW.created_by IS NOT DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'A second editor must publish this edit';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER dimension_versions_dual_review BEFORE INSERT OR UPDATE ON dimension_versions
  FOR EACH ROW EXECUTE FUNCTION public.version_dual_review_guard();
--> statement-breakpoint
CREATE TRIGGER custom_page_versions_dual_review BEFORE INSERT OR UPDATE ON custom_page_versions
  FOR EACH ROW EXECUTE FUNCTION public.version_dual_review_guard();
--> statement-breakpoint
CREATE TRIGGER outreach_contact_versions_dual_review BEFORE INSERT OR UPDATE ON outreach_contact_versions
  FOR EACH ROW EXECUTE FUNCTION public.version_dual_review_guard();
--> statement-breakpoint
CREATE FUNCTION public.dimension_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.dimension_id IS DISTINCT FROM OLD.dimension_id OR NEW.version_num IS DISTINCT FROM OLD.version_num THEN
    RAISE EXCEPTION 'Dimension version identity is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER dimension_versions_identity BEFORE UPDATE ON dimension_versions
  FOR EACH ROW EXECUTE FUNCTION public.dimension_version_identity_guard();
