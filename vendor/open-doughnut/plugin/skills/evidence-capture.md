# Evidence capture

Every accepted source gets a snapshot at retrieval time — the anti-link-rot
and anti-staleness record. The snapshot is displayed next to the claim in
the public drilldown, so capture the view that shows the number.

Rules:

- Call `capture_evidence` with the exact URL you read the value from — the
  report page, not the site home page.
- When the source is a PDF, pass the direct PDF URL so the document itself
  is archived alongside the page screenshot.
- Capture AFTER you have decided to accept the source, once per source (a
  source shared by two indicators needs only one capture; reference the same
  paths).
- Put the returned `snapshot_path` / `pdf_path` and `captured_at` into the
  finding's `evidence` field verbatim.
- Alongside the returned paths, put the exact passage containing the figure
  into `evidence.quote`, copied verbatim from the page — it is checked
  mechanically against the archived source text, so do not paraphrase,
  re-punctuate, or splice sentences. If the figure only appears in a chart,
  table image, or map, omit `quote` and say so in the finding's `notes`.
- If capture fails (site blocks rendering), say so in the finding's notes —
  the verifier and reviewer will weigh it.
