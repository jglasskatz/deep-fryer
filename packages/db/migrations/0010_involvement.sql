CREATE TYPE "public"."involvement_kind" AS ENUM('volunteer', 'services', 'civic', 'organize', 'other');--> statement-breakpoint
CREATE TYPE "public"."involvement_submission_kind" AS ENUM('listing', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."involvement_submission_status" AS ENUM('new', 'approved', 'declined', 'spam');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "involvement_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"url" text,
	"phone" text,
	"kind" "involvement_kind" NOT NULL,
	"dimension_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_url" text,
	"link_checked_at" timestamp with time zone,
	"submission_id" uuid,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "involvement_listings_tenant_name" UNIQUE("tenant_id","name"),
	CONSTRAINT "involvement_listings_https_url" CHECK ("involvement_listings"."url" IS NULL OR "involvement_listings"."url" LIKE 'https://%'),
	CONSTRAINT "involvement_listings_https_source" CHECK ("involvement_listings"."source_url" IS NULL OR "involvement_listings"."source_url" LIKE 'https://%'),
	CONSTRAINT "involvement_listings_name_length" CHECK (char_length("involvement_listings"."name") BETWEEN 1 AND 160),
	CONSTRAINT "involvement_listings_description_length" CHECK (char_length("involvement_listings"."description") BETWEEN 1 AND 600)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "involvement_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "involvement_submission_kind" NOT NULL,
	"dimension_slug" text,
	"org_name" text,
	"about" text,
	"pitch" text NOT NULL,
	"website" text,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"locale" text NOT NULL,
	"ip_hash" text NOT NULL,
	"status" "involvement_submission_status" DEFAULT 'new' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "involvement_submissions_pitch_length" CHECK (char_length("involvement_submissions"."pitch") BETWEEN 1 AND 2000),
	CONSTRAINT "involvement_submissions_about_length" CHECK ("involvement_submissions"."about" IS NULL OR char_length("involvement_submissions"."about") <= 1000),
	CONSTRAINT "involvement_submissions_org_required" CHECK ("involvement_submissions"."kind" = 'suggestion' OR ("involvement_submissions"."org_name" IS NOT NULL AND "involvement_submissions"."about" IS NOT NULL)),
	CONSTRAINT "involvement_submissions_https_website" CHECK ("involvement_submissions"."website" IS NULL OR "involvement_submissions"."website" LIKE 'https://%' OR "involvement_submissions"."website" LIKE 'http://%')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "involvement_listings" ADD CONSTRAINT "involvement_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "involvement_submissions" ADD CONSTRAINT "involvement_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "involvement_submissions_tenant_status_idx" ON "involvement_submissions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "involvement_submissions_rate_idx" ON "involvement_submissions" USING btree ("tenant_id","ip_hash","created_at");--> statement-breakpoint
ALTER TABLE involvement_listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE involvement_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Listings (SPEC-v6 §4.1): the public reads published ones; members read
-- every listing; editors curate.
CREATE POLICY involvement_listings_public_read ON involvement_listings FOR SELECT USING (published);
--> statement-breakpoint
CREATE POLICY involvement_listings_member_read ON involvement_listings FOR SELECT USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY involvement_listings_editor_write ON involvement_listings FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
-- Submissions (SPEC-v6 §4.2): anyone, signed in or not, may file a new one
-- for a live portrait; nothing a reviewer sets can be forged on insert. Only
-- editors read, change, or delete them — they hold private contact details.
-- (Inserts therefore cannot use RETURNING: the submitter cannot read the row.)
CREATE POLICY involvement_submissions_public_insert ON involvement_submissions FOR INSERT
  WITH CHECK (
    status = 'new' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL
    AND listing_id IS NULL
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_id AND t.archived_at IS NULL)
  );
--> statement-breakpoint
CREATE POLICY involvement_submissions_editor_read ON involvement_submissions FOR SELECT
  USING (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY involvement_submissions_editor_update ON involvement_submissions FOR UPDATE
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY involvement_submissions_editor_delete ON involvement_submissions FOR DELETE
  USING (is_editor(tenant_id));
--> statement-breakpoint
-- The form's rate limits need two counts the submitter's role cannot read;
-- this returns exactly those counts and nothing else.
CREATE OR REPLACE FUNCTION public.involvement_submission_counts(
  p_tenant_id uuid, p_ip_hash text, p_email text, p_ip_since timestamptz, p_email_since timestamptz
) RETURNS TABLE (by_ip bigint, by_email bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT
      (SELECT count(*) FROM involvement_submissions
        WHERE tenant_id = p_tenant_id AND ip_hash = p_ip_hash AND created_at >= p_ip_since),
      (SELECT count(*) FROM involvement_submissions
        WHERE tenant_id = p_tenant_id AND lower(email) = lower(p_email) AND created_at >= p_email_since)
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.involvement_submission_counts(uuid, text, text, timestamptz, timestamptz) TO deep_fryer_app;
--> statement-breakpoint
-- The "Staff" label on comments (SPEC-v6 §3.3): which of the given users are
-- on the portrait's team — a tenant member of any role, or an owner of the
-- organization that holds the portrait (member_role's rule). Returns ids
-- only, never roles or emails.
CREATE OR REPLACE FUNCTION public.public_staff_ids(p_tenant_id uuid, p_ids uuid[])
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT DISTINCT u.id FROM unnest(p_ids) AS u(id)
    WHERE EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = u.id)
       OR EXISTS (SELECT 1 FROM tenants t
                    JOIN organization_members om ON om.organization_id = t.organization_id
                   WHERE t.id = p_tenant_id AND om.user_id = u.id AND om.role = 'owner')
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.public_staff_ids(uuid, uuid[]) TO deep_fryer_app;
