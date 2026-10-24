**Reviewer-suggested corrections: ready for separate review**

Five new amendments address all five initial revisions. The frozen original 34-amendment file and two-item housing supplement remain unchanged. These corrections were authored by the initial reviewer; their 36 passing checks are corrective self-checks, not independent approval. Another agent must review the exact batch before integration.

Correction batch: `findings/reviewer-suggested-corrections.json`, SHA-256 `5d2d818dd01a773117b660bd70e6fd58d5e0258b4d694c903643d16d43259c1b`.

Evidence manifest: `reviews/reviewer-corrections-evidence-manifest.json`, SHA-256 `2310d3509411c610de5724bdcc3237c53b919702605323323c5716f83e5ffd93`.

The corrected conservation exhibit shows the exact arithmetic. The county broadband exhibit includes the official GCT2801 2024 one-year row and MOE. A shared fixed-broadband exhibit identifies the two 2023 borough values, their source definition and the unscored observation status. All three screenshots were rendered with installed Chromium and visually inspected. The NYC waste correction uses the already correct existing exhibit and clarifies its notes.

| Superseded amendment | Correction |
| --- | --- |
| `nyc:chemical-pollution:1` | Remove the ambiguous Bronx sentence from the NYC fiscal-year observation. The supported NYC result remains FY 2005–2025 reduction 12.55%, unscored. |
| `nyc:biodiversity-loss:0` | Correct the derived exhibit arithmetic to 19.52183345%; preserve the rounded 19.5% land-and-water observation and null land-only score. |
| `santa-cruz-county:networks:0` | Replace the mismatched exhibit with the exact official GCT2801 county 94.9% ±1.1 percentage point row and explicit 2024 one-year period. |
| `bronx:networks:0` | Retain the publisher-supported 2023 fixed-broadband estimate as an unscored related observation; do not apply the generic any-broadband contract. |
| `staten-island:networks:0` | Retain the publisher-supported 2023 fixed-broadband estimate as an unscored related observation; do not apply the generic any-broadband contract. |

Each correction retains the original baseline before payload and records both the superseded batch hash and per-amendment hash. New after payloads, original primary sources and corrected screenshots are individually bound. All five target, level_pct and scoring fields are null.

The correction activity log records three sandboxed browser launch failures and three successful installed-browser renders after an allowed escalation. No browser installation, new primary download, database write or GitHub action occurred. Actual tokens and billed USD remain null. Acceptance can authorize research-preview semantics only; human approval and publication remain separate.
