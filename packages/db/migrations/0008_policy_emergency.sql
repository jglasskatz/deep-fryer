CREATE TYPE "public"."hazard_kind" AS ENUM('coastal_storm', 'flooding', 'extreme_heat', 'winter_weather', 'high_winds', 'air_quality', 'drought', 'wildfire', 'earthquake', 'infectious_disease', 'infrastructure_failure', 'other');--> statement-breakpoint
CREATE TYPE "public"."policy_analysis_status" AS ENUM('queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."emergency_resource_kind" AS ENUM('cooling_center', 'shelter', 'hotline', 'mutual_aid', 'food', 'medical', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_alert_syncs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"event" text NOT NULL,
	"severity" text NOT NULL,
	"urgency" text NOT NULL,
	"certainty" text NOT NULL,
	"headline" text,
	"description" text NOT NULL,
	"instruction" text,
	"area_desc" text NOT NULL,
	"sender_name" text NOT NULL,
	"url" text NOT NULL,
	"effective" timestamp with time zone NOT NULL,
	"expires" timestamp with time zone,
	"ends" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_alerts_source_unique" UNIQUE("tenant_id","source","source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agency" text NOT NULL,
	"url" text NOT NULL,
	"adopted_year" integer,
	"summary" text DEFAULT '' NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"hazard_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_plans_https_url" CHECK ("emergency_plans"."url" LIKE 'https://%')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "emergency_resource_kind" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"phone" text,
	"url" text,
	"hazard_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_resources_https_url" CHECK ("emergency_resources"."url" IS NULL OR "emergency_resources"."url" LIKE 'https://%')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "hazard_kind" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"likelihood" smallint NOT NULL,
	"severity" smallint NOT NULL,
	"dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nws_events" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hazards_tenant_slug" UNIQUE("tenant_id","slug"),
	CONSTRAINT "hazards_likelihood_range" CHECK ("hazards"."likelihood" BETWEEN 1 AND 5),
	CONSTRAINT "hazards_severity_range" CHECK ("hazards"."severity" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"source_url" text,
	"status" "policy_analysis_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"projections" jsonb,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"token_usage" jsonb,
	"transcript" "bytea",
	CONSTRAINT "policy_analyses_brief_length" CHECK (char_length("policy_analyses"."brief") BETWEEN 1 AND 60000)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emergency_alert_syncs" ADD CONSTRAINT "emergency_alert_syncs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emergency_plans" ADD CONSTRAINT "emergency_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emergency_resources" ADD CONSTRAINT "emergency_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazards" ADD CONSTRAINT "hazards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_analyses" ADD CONSTRAINT "policy_analyses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_analyses" ADD CONSTRAINT "policy_analyses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_analyses_tenant_created_idx" ON "policy_analyses" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- Row-level security for SPEC-v5 (policy analysis, emergency view), enforced
-- for the app role like every other table (migration 0005).
ALTER TABLE policy_analyses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hazards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE emergency_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE emergency_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE emergency_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE emergency_alert_syncs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Policy analyses are staff-plane: members read. Creation happens in the
-- system context under the subscription lock (quota), and the worker writes
-- results, so the app role gets no write policy. The transcript is never
-- readable by the app role (same rule as research_sessions).
CREATE POLICY policy_analyses_member_read ON policy_analyses FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
REVOKE SELECT ON policy_analyses FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, title, brief, source_url, status, result, projections, error, requested_by,
              created_at, started_at, completed_at, token_usage)
  ON policy_analyses TO deep_fryer_app;
--> statement-breakpoint
-- Hazards, plans, resources: editors curate; the public sees published rows.
CREATE POLICY hazards_public_read ON hazards FOR SELECT USING (published);
--> statement-breakpoint
CREATE POLICY hazards_member_read ON hazards FOR SELECT USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY hazards_editor_write ON hazards FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY emergency_plans_public_read ON emergency_plans FOR SELECT USING (published);
--> statement-breakpoint
CREATE POLICY emergency_plans_member_read ON emergency_plans FOR SELECT USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY emergency_plans_editor_write ON emergency_plans FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY emergency_resources_public_read ON emergency_resources FOR SELECT USING (published);
--> statement-breakpoint
CREATE POLICY emergency_resources_member_read ON emergency_resources FOR SELECT USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY emergency_resources_editor_write ON emergency_resources FOR ALL
  USING (is_editor(tenant_id)) WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint
-- Alerts are official public information; only the worker (system) writes them.
CREATE POLICY emergency_alerts_public_read ON emergency_alerts FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY emergency_alert_syncs_public_read ON emergency_alert_syncs FOR SELECT USING (true);
--> statement-breakpoint
-- The emergency config (NWS zones, official sign-up link, phone numbers) is
-- shown on the public emergency page.
DROP POLICY tenant_config_public_read ON tenant_config;
--> statement-breakpoint
CREATE POLICY tenant_config_public_read ON tenant_config FOR SELECT
  USING (key IN ('region', 'source_priority', 'recency', 'scale_policy', 'threshold_overrides', 'progress', 'emergency'));
