-- Multi-provider encrypted organization API keys (Anthropic, OpenAI, Google Gemini).
-- Allows each organization to store one encrypted key per provider (organization_id, provider)
-- while preserving all RLS policies and deep_fryer_app ciphertext isolation.
ALTER TABLE "organization_api_keys" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_api_keys" DROP CONSTRAINT IF EXISTS "organization_api_keys_provider";--> statement-breakpoint
ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_provider" CHECK ("organization_api_keys"."provider" IN ('anthropic', 'openai', 'google'));--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_api_keys'::regclass
      AND conname = 'organization_api_keys_pkey'
  ) THEN
    ALTER TABLE "organization_api_keys" DROP CONSTRAINT "organization_api_keys_pkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_api_keys'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_organization_id_provider_pk" PRIMARY KEY("organization_id","provider");
  END IF;
END $$;--> statement-breakpoint
-- Re-assert column-level SELECT grants so ciphertext remains owner-only (migration 0011).
REVOKE SELECT ON organization_api_keys FROM deep_fryer_app;--> statement-breakpoint
GRANT SELECT (organization_id, provider, key_hint, created_by, created_at, validated_at)
  ON organization_api_keys TO deep_fryer_app;
