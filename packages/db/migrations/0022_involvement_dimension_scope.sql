-- Category identity is the tenant's actual dimension address. Framework
-- references do not alias a custom heat indicator to ozone (or another topic).
-- Historical submissions stay byte-for-byte unchanged. Unrelated moderation
-- and unpublication remain possible after a selected dimension is archived.
CREATE FUNCTION public.guard_involvement_dimensions() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE selected text[]; needs_check boolean; needs_publication boolean;
BEGIN
  IF TG_TABLE_NAME = 'involvement_listings' THEN
    selected := NEW.dimension_slugs;
    needs_check := TG_OP = 'INSERT';
    IF TG_OP = 'UPDATE' THEN
      needs_check := NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.dimension_slugs IS DISTINCT FROM OLD.dimension_slugs
        OR (NEW.published AND NOT OLD.published);
    END IF;
    needs_publication := false;
  ELSE
    selected := CASE WHEN NEW.dimension_slug IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.dimension_slug] END;
    needs_check := TG_OP = 'INSERT';
    IF TG_OP = 'UPDATE' THEN
      needs_check := NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.dimension_slug IS DISTINCT FROM OLD.dimension_slug;
    END IF;
    needs_publication := current_user = 'deep_fryer_app' AND NOT public.is_editor(NEW.tenant_id);
  END IF;
  IF needs_check AND EXISTS (
    SELECT 1 FROM unnest(selected) AS picked(slug)
    WHERE NOT EXISTS (SELECT 1 FROM dimensions d
      WHERE d.tenant_id = NEW.tenant_id AND d.slug = picked.slug
        AND d.archived_at IS NULL
        AND (NOT needs_publication OR d.published_version_id IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Select active dimensions belonging to this portrait';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER involvement_listings_dimension_scope BEFORE INSERT OR UPDATE
  ON involvement_listings FOR EACH ROW EXECUTE FUNCTION public.guard_involvement_dimensions();
--> statement-breakpoint
CREATE TRIGGER involvement_submissions_dimension_scope BEFORE INSERT OR UPDATE
  ON involvement_submissions FOR EACH ROW EXECUTE FUNCTION public.guard_involvement_dimensions();
