-- Comment edits by role (SPEC-v3 §2.2 item 3), enforced for the user role:
-- authors may change only the text (body/edited_at); moderators may change
-- only removal state (removed_at/removed_by) — never rewrite what a resident
-- said. Placement and authorship never change. RLS decides *who* may update
-- a row; this decides *which columns* each of them may touch. The system
-- context (owner role) is exempt.
CREATE OR REPLACE FUNCTION public.comments_update_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user <> 'deep_fryer_app' THEN
      RETURN NEW;
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.dimension_id IS DISTINCT FROM OLD.dimension_id
       OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'comment placement and authorship are immutable';
    END IF;
    IF auth.uid() = OLD.author_id THEN
      IF NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removed_by IS DISTINCT FROM OLD.removed_by THEN
        RAISE EXCEPTION 'authors cannot change a comment''s moderation state';
      END IF;
    ELSIF NEW.body IS DISTINCT FROM OLD.body OR NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
      RAISE EXCEPTION 'moderators may remove or restore a comment, never rewrite it';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER comments_update_guard
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_update_guard();
