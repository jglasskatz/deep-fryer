# Vendored open-doughnut plugin

This directory is the **vendored research runtime** (SPEC.md §5): the Claude
Code plugin that will live in the `open-doughnut` repo after the M2
restructure of `doughnut-santa-cruz`. The hosted product's worker executes
exactly this artifact via the Claude Agent SDK, so the hosted workflow and
the community workflow are identical by construction.

- `plugin/agents/` — subagent prompt templates. `{{placeholders}}` are filled
  from portrait config at plan time; prompts never embed judgment (§6).
- `plugin/skills/` — methodology and process instructions injected into
  sessions.
- `plugin/commands/` — the community-facing Claude Code commands
  (`/doughnut init|plan|research|status`).
- Schemas are the shared contract in `packages/contract/schemas/` (they move
  to `open-doughnut/plugin/schemas/` at M2).

CI pins this directory's `plugin/plugin.json` version; upgrading the plugin
is a reviewed PR.
