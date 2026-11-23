CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"visibility" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"dimension_slug" text,
	"title" text NOT NULL,
	"citation_label" text NOT NULL,
	"citation_url" text,
	"content" text NOT NULL,
	"search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("dimension_slug", '') || ' ' || coalesce("citation_label", '')), 'B') || setweight(to_tsvector('english', coalesce("content", '')), 'C')) STORED,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_tenant_vis_source_uniq" UNIQUE("tenant_id","visibility","source_kind","source_ref"),
	CONSTRAINT "knowledge_chunks_visibility_check" CHECK ("knowledge_chunks"."visibility" IN ('public', 'member')),
	CONSTRAINT "knowledge_chunks_source_kind_check" CHECK ("knowledge_chunks"."source_kind" IN ('indicator', 'evidence_text', 'custom_page', 'policy_analysis', 'outreach')),
	CONSTRAINT "knowledge_chunks_policy_member_only" CHECK ("knowledge_chunks"."source_kind" <> 'policy_analysis' OR "knowledge_chunks"."visibility" = 'member')
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_visibility_idx" ON "knowledge_chunks" USING btree ("tenant_id","visibility");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_dim_idx" ON "knowledge_chunks" USING btree ("tenant_id","dimension_slug");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_vector_idx" ON "knowledge_chunks" USING gin ("search_vector");
--> statement-breakpoint
-- ---- Strict Row-Level Security on knowledge_chunks ----
-- Anonymous callers and non-members read ONLY `visibility = 'public'` chunks
-- belonging to live, published portraits (`tenant_is_public(tenant_id)`:
-- first_published_at IS NOT NULL AND archived_at IS NULL, migration 0015).
-- Signed-in members (`is_member(tenant_id)`) read both `'public'` and
-- `'member'` chunks for their own portrait, while `policy_analysis` chunks
-- keep migration 0009's editor+ restriction so unreleased policy briefs do
-- not leak to viewers.
-- Writes through the app role (`deep_fryer_app`) require editor+ on the row's
-- own tenant (publish paths in apps/web run inside userDb); system-context
-- reindexers (scripts/reindex-rag.ts, worker) run as table owner.
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON knowledge_chunks FROM deep_fryer_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_chunks TO deep_fryer_app;
--> statement-breakpoint
CREATE POLICY knowledge_chunks_public_read ON knowledge_chunks FOR SELECT
  USING (visibility = 'public' AND public.tenant_is_public(tenant_id));
--> statement-breakpoint
CREATE POLICY knowledge_chunks_member_read ON knowledge_chunks FOR SELECT
  USING (
    public.is_member(tenant_id)
    AND (source_kind <> 'policy_analysis' OR public.is_editor(tenant_id))
  );
--> statement-breakpoint
CREATE POLICY knowledge_chunks_editor_insert ON knowledge_chunks FOR INSERT
  WITH CHECK (public.is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY knowledge_chunks_editor_update ON knowledge_chunks FOR UPDATE
  USING (public.is_editor(tenant_id))
  WITH CHECK (public.is_editor(tenant_id));
--> statement-breakpoint
CREATE POLICY knowledge_chunks_editor_delete ON knowledge_chunks FOR DELETE
  USING (public.is_editor(tenant_id));
