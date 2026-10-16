CREATE TABLE IF NOT EXISTS "organization_api_keys" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"ciphertext" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	CONSTRAINT "organization_api_keys_provider" CHECK ("organization_api_keys"."provider" = 'anthropic'),
	CONSTRAINT "organization_api_keys_hint_length" CHECK (char_length("organization_api_keys"."key_hint") <= 8)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"path" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_requests_path_length" CHECK (char_length("translation_requests"."path") BETWEEN 1 AND 300),
	CONSTRAINT "translation_requests_not_english" CHECK ("translation_requests"."locale" <> 'en')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_requests" ADD CONSTRAINT "translation_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_requests_tenant_locale_idx" ON "translation_requests" USING btree ("tenant_id","locale");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_requests_rate_idx" ON "translation_requests" USING btree ("tenant_id","ip_hash","created_at");--> statement-breakpoint
-- ---- Feature flags (SPEC-v7 §3) ----
-- Portraits that existed before flags keep everything they show today: the
-- six new features default ON for them (an existing value wins), while new
-- portraits are provisioned with everything beyond core off
-- (packages/core config-defaults.ts). request_research keeps its own value.
INSERT INTO tenant_config (tenant_id, key, value)
  SELECT t.id, 'features', '{}'::jsonb FROM tenants t
  WHERE NOT EXISTS (SELECT 1 FROM tenant_config c WHERE c.tenant_id = t.id AND c.key = 'features');
--> statement-breakpoint
UPDATE tenant_config
  SET value = '{"emergency": true, "policy_analysis": true, "involvement": true, "discussion": true, "translation": true, "family_compare": true}'::jsonb || value
  WHERE key = 'features';
--> statement-breakpoint
-- Public pages decide what to show from the flags, so the key becomes
-- publicly readable; it holds booleans only.
DROP POLICY tenant_config_public_read ON tenant_config;
--> statement-breakpoint
CREATE POLICY tenant_config_public_read ON tenant_config FOR SELECT
  USING (key IN ('region', 'source_priority', 'recency', 'scale_policy', 'threshold_overrides', 'progress', 'emergency', 'features'));
--> statement-breakpoint
-- ---- Translation requests (SPEC-v7 §3.5) ----
ALTER TABLE translation_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Anyone may ask for a language for a live portrait (no account); members
-- read the requests (the settings page shows counts per language).
CREATE POLICY translation_requests_public_insert ON translation_requests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_id AND t.archived_at IS NULL));
--> statement-breakpoint
CREATE POLICY translation_requests_member_read ON translation_requests FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.translation_request_count(p_tenant_id uuid, p_ip_hash text, p_since timestamptz)
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT count(*) FROM translation_requests
     WHERE tenant_id = p_tenant_id AND ip_hash = p_ip_hash AND created_at >= p_since
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.translation_request_count(uuid, text, timestamptz) TO deep_fryer_app;
--> statement-breakpoint
-- ---- Organization API keys (SPEC-v7 §4) ----
-- Organization owners add, replace, and remove their key. The app role can
-- read which key is on file (its hint and dates) but never the ciphertext;
-- only the worker, connecting as the table owner, decrypts it.
ALTER TABLE organization_api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_api_keys_owner_all ON organization_api_keys FOR ALL
  USING (is_org_owner(organization_id)) WITH CHECK (is_org_owner(organization_id));
--> statement-breakpoint
REVOKE SELECT ON organization_api_keys FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT (organization_id, provider, key_hint, created_by, created_at, validated_at)
  ON organization_api_keys TO deep_fryer_app;
