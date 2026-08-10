CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"title" text,
	"media_type" text DEFAULT 'html' NOT NULL,
	"text" text,
	"text_source" text,
	"extraction" text DEFAULT 'capture' NOT NULL,
	"snapshot_path" text NOT NULL,
	"pdf_path" text,
	"captured_at" timestamp with time zone NOT NULL,
	"run_id" uuid,
	"session_id" uuid,
	"dimension_id" uuid,
	"source_tier" integer,
	"text_public" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_tenant_url_content_uniq" UNIQUE("tenant_id","url_hash","content_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_session_id_research_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_dimension_id_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimensions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_tenant_dimension_idx" ON "sources" USING btree ("tenant_id","dimension_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_tenant_snapshot_idx" ON "sources" USING btree ("tenant_id","snapshot_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dimension_versions_published_idx" ON "dimension_versions" USING btree ("dimension_id","published_at");