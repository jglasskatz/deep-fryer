-- Source knowledge base: FTS, RLS, provenance guard (SPEC.md §8 evidence
-- capture) and the as-of public read path for /{tenant}/progress (SPEC.md §10).
-- Postgres FTS now (websearch_to_tsquery); pgvector deferred by decision.

-- tsvector has a hard ~1MB limit; text is truncated to 500k chars at write
-- time and the left() here is the belt-and-braces guard for any other writer.
ALTER TABLE sources ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      left(coalesce(title, ''), 2000) || ' ' || left(coalesce("text", ''), 500000))
  ) STORED;
--> statement-breakpoint
CREATE INDEX sources_tsv_idx ON sources USING gin (tsv);
--> statement-breakpoint

ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Member-read only: tiered PUBLIC exposure is applied app-side (the web app
-- reads via DATABASE_URL). If RLS-governed anon clients ever need sources,
-- add a redacting SQL function like published_doughnut — never a table grant.
CREATE POLICY sources_member_read ON sources FOR SELECT
  USING (is_member(tenant_id));
--> statement-breakpoint
CREATE POLICY sources_editor_insert ON sources FOR INSERT
  WITH CHECK (is_editor(tenant_id));
--> statement-breakpoint

-- Capture provenance is immutable; only tier reconciliation and the exposure
-- override may change after insert (same discipline family as
-- dimension_versions_guard in 0001).
CREATE OR REPLACE FUNCTION public.sources_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.url IS DISTINCT FROM OLD.url
       OR NEW.url_hash IS DISTINCT FROM OLD.url_hash
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.media_type IS DISTINCT FROM OLD.media_type
       OR NEW."text" IS DISTINCT FROM OLD."text"
       OR NEW.text_source IS DISTINCT FROM OLD.text_source
       OR NEW.extraction IS DISTINCT FROM OLD.extraction
       OR NEW.snapshot_path IS DISTINCT FROM OLD.snapshot_path
       OR NEW.pdf_path IS DISTINCT FROM OLD.pdf_path
       OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
       OR NEW.run_id IS DISTINCT FROM OLD.run_id
       OR NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.dimension_id IS DISTINCT FROM OLD.dimension_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'sources capture provenance is immutable; only source_tier and text_public may change';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER sources_immutable_provenance
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION public.sources_guard();
--> statement-breakpoint

-- The portrait as it stood at p_at (SPEC.md §10 /progress): same jsonb shape
-- as published_doughnut. Per dimension, the latest version first-published on
-- or before p_at (published_at survives archive; revert reuses it — this is
-- publication history, independent of the unreliable status column). A
-- dimension archived AFTER p_at still appears (ozone must show in pre-archive
-- eras); one archived BEFORE p_at does not.
CREATE OR REPLACE FUNCTION public.published_doughnut_asof(p_slug text, p_at timestamptz) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT jsonb_build_object(
      'tenant', jsonb_build_object(
        'slug', t.slug, 'name', t.name, 'region', t.region,
        'population', t.population, 'description', t.description,
        'branding', t.branding
      ),
      'dimensions', COALESCE(
        (SELECT jsonb_agg(
           jsonb_build_object(
             'slug', d.slug, 'ring', d.ring, 'canonical_slug', d.canonical_slug,
             'display_order', d.display_order,
             'viz_level', v.viz_level, 'data', v.data,
             'published_at', v.published_at, 'version_num', v.version_num
           ) ORDER BY d.ring, d.display_order)
         FROM dimensions d
         JOIN LATERAL (
           SELECT dv.viz_level, dv.data, dv.published_at, dv.version_num
             FROM dimension_versions dv
            WHERE dv.dimension_id = d.id
              AND dv.published_at IS NOT NULL
              AND dv.published_at <= p_at
            ORDER BY dv.published_at DESC, dv.version_num DESC
            LIMIT 1
         ) v ON true
         WHERE d.tenant_id = t.id
           AND (d.archived_at IS NULL OR d.archived_at > p_at)),
        '[]'::jsonb
      )
    )
    FROM tenants t
    WHERE t.slug = p_slug AND t.archived_at IS NULL
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.published_doughnut_asof(text, timestamptz) TO anon, authenticated;
