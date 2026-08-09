CREATE TYPE "public"."review_disposition" AS ENUM('verified', 'rejected', 'needs_rework');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"dimension_id" uuid,
	"finding_id" uuid,
	"disposition" "review_disposition",
	"annotation" jsonb,
	"note" text,
	"reviewer_id" uuid,
	"reviewer_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_notes_run_idx" ON "review_notes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_notes_finding_idx" ON "review_notes" USING btree ("run_id","finding_id","created_at");