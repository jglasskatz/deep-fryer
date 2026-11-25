#!/usr/bin/env tsx
/**
 * California 2025 Golden-Test Benchmark Runner with Source-Leak Blocking.
 *
 * Runs 1–2+ dimensions of the real Deep Fryer research pipeline against
 * California statewide indicators while hard-blocking the published 2025
 * California Doughnut Report (Zenodo record/PDF, CalDEC website & workbook,
 * ca-doughnut GitHub repo, DEAL California pages, and Deep Fryer's own pages)
 * at both the egress layer and prompt layer, then scores every finding against
 * the 42 report-verified ground-truth indicators in `site/imports/california/`.
 *
 * Usage:
 *   npx tsx scripts/eval-california-golden.ts --dimensions housing,air-pollution --dry-run
 *   npx tsx scripts/eval-california-golden.ts --dimensions housing,air-pollution --provider anthropic --strategy hybrid
 *   npx tsx scripts/eval-california-golden.ts --dimensions housing --provider openai --model gpt-5 --strategy standard
 *   npx tsx scripts/eval-california-golden.ts --dimensions air-pollution --provider google --model gemini-2.5-pro
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { PortraitConfig } from '@deep-fryer/contract';
import {
  PROVIDER_META,
  emptyUsage,
  mergeUsage,
  parseResearchProvider,
  priceModelTokens,
  priceSessionUsage,
  providerForModel,
  resolveProviderEnvKey,
  WEB_SEARCH_USD_PER_REQUEST,
  type ContentSupported,
  type FindingPayload,
  type IndicatorFindingPayload,
  type ResearchPlan,
  type ResearchProvider,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  DEFAULT_SESSION_MAX_TURNS,
  DIMENSION_TOOLS,
  REGION_BRIEF_PLACEHOLDER,
  VERIFIER_MAX_TURNS,
  VERIFIER_TOOLS,
  buildCaliforniaReportBlocklist,
  checkValueOnPage,
  deterministicChecks,
  loadCaliforniaGolden,
  plannedSlugsFromPrompt,
  renderBlocklistInstructions,
  renderGoldenScorecardMarkdown,
  renderPlan,
  renderVerifierPrompt,
  resolveStrategy,
  scoreGoldenRun,
  selectCaliforniaGoldenDimensions,
  strategyRef,
  tenantStorage as createTenantStorage,
  withEgressBlocklist,
  type CaliforniaGoldenIndicator,
  type PlanDimensionSpec,
  type SourceBlocklist,
} from '@deep-fryer/research';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function loadEnvLocalIfPresent(repoRoot: string): void {
  const envPath = path.join(repoRoot, '.env.local');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

interface CliOptions {
  dimensions: string[];
  provider: ResearchProvider;
  model?: string;
  orchestratorModel?: string;
  verifierModel?: string;
  escalationModel?: string;
  strategy: 'standard' | 'hybrid' | 'deep';
  dryRun: boolean;
  outDir?: string;
  maxTurns?: number;
  help: boolean;
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const flag = `--${name}`;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === flag) return argv[i + 1];
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  }
  return undefined;
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const help = argv.includes('--help') || argv.includes('-h');
  const rawDims = argValue(argv, 'dimensions') ?? 'housing,air-pollution';
  const dimensions = rawDims
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (dimensions.length === 0) {
    throw new Error('--dimensions must list at least one dimension slug (e.g. housing,air-pollution)');
  }

  const rawStrategy = (argValue(argv, 'strategy') ?? 'hybrid').trim().toLowerCase();
  if (rawStrategy !== 'standard' && rawStrategy !== 'hybrid' && rawStrategy !== 'deep') {
    throw new Error(`--strategy must be one of standard, hybrid, deep (got "${rawStrategy}")`);
  }

  const model = argValue(argv, 'model')?.trim() || undefined;
  const orchestratorModel = argValue(argv, 'orchestrator-model')?.trim() || undefined;
  const verifierModel = argValue(argv, 'verifier-model')?.trim() || undefined;
  const escalationModel = argValue(argv, 'escalation-model')?.trim() || undefined;

  const rawProvider = argValue(argv, 'provider');
  let provider: ResearchProvider;
  if (rawProvider) {
    const parsed = parseResearchProvider(rawProvider);
    if (!parsed) {
      throw new Error(`--provider must be one of anthropic, openai, google (got "${rawProvider}")`);
    }
    provider = parsed;
  } else if (model) {
    provider = providerForModel(model, 'anthropic');
  } else {
    provider = parseResearchProvider(process.env.RESEARCH_PROVIDER) ?? 'anthropic';
  }

  const rawMaxTurns = argValue(argv, 'max-turns');
  const maxTurns = rawMaxTurns ? Number(rawMaxTurns) : undefined;
  if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1)) {
    throw new Error(`--max-turns must be a positive integer (got "${rawMaxTurns}")`);
  }

  return {
    dimensions,
    provider,
    model,
    orchestratorModel,
    verifierModel,
    escalationModel,
    strategy: rawStrategy,
    dryRun: argv.includes('--dry-run'),
    outDir: argValue(argv, 'out')?.trim() || undefined,
    maxTurns,
    help,
  };
}

function printUsage(): void {
  console.log(`California 2025 Golden-Test Benchmark CLI (with Source-Leak Blocking)

Usage:
  npx tsx scripts/eval-california-golden.ts [options]

Options:
  --dimensions <csv>       Comma-separated dimension slugs (default: housing,air-pollution)
  --provider <name>        anthropic | openai | google (default: inferred from --model or anthropic)
  --model <id>             Explicit model ID for dimension worker sessions
  --orchestrator-model <id> Explicit model ID for Phase 0 planning (and default verifier/escalation)
  --verifier-model <id>    Explicit model ID for independent verifier sessions
  --escalation-model <id>  Explicit model ID for selective escalation on failed/gap indicators
  --strategy <name>        standard | hybrid | deep (default: hybrid)
  --max-turns <n>          Override session turn cap
  --out <dir>              Output directory (default: research/evals/california-<timestamp>)
  --dry-run                Validate golden data & print plan + blocklist without spending tokens
  -h, --help               Show this help text
`);
}

function buildCaliforniaPortraitConfig(): PortraitConfig {
  return {
    region: {
      name: 'State of California',
      definition:
        'The U.S. state of California (FIPS 06; 58 counties, ~39 million residents), evaluated statewide.',
      context_notes:
        'Statewide California portrait benchmark. Prefer official California state agencies (CARB, CalEPA/OEHHA, CDPH, HCD, SWRCB, CNRA, DOJ OpenJustice, Secretary of State) and federal statistical agencies reporting California statewide series (U.S. Census Bureau ACS/SPM, HUD PIT, U.S. EPA, BLS, USDA ERS, EIA, CDC, NOAA).',
    },
    source_priority: {
      tiers: [
        {
          tier: 1,
          name: 'Official California state agencies',
          description:
            'California state departments, boards, open-data portals, and statutory annual reports covering California statewide.',
          examples: [
            'arb.ca.gov (CARB)',
            'calepa.ca.gov / oehha.ca.gov',
            'cdph.ca.gov',
            'waterboards.ca.gov',
            'resources.ca.gov',
            'openjustice.doj.ca.gov',
            'sos.ca.gov',
          ],
        },
        {
          tier: 2,
          name: 'Federal statistical agencies',
          description:
            'Official U.S. federal datasets reporting California statewide figures (state FIPS 06).',
          examples: [
            'data.census.gov / Census ACS & SPM',
            'HUD Point-in-Time (hudexchange.info)',
            'U.S. EPA (TRI, AQS, SDWIS, USEEIO)',
            'Bureau of Labor Statistics (bls.gov)',
            'USDA ERS / EIA / CDC',
          ],
        },
        {
          tier: 3,
          name: 'Established research institutions',
          description:
            'Nonpartisan California and national research institutes with transparent methodology.',
          examples: ['PPIC (ppic.org)', 'CHCF (chcf.org)', 'UC institutes', 'County Health Rankings'],
        },
        {
          tier: 4,
          name: 'Reputable secondary reporting',
          description:
            'Journalism or policy briefs citing primary data — only when tiers 1–3 are exhausted.',
          examples: ['CalMatters data reporting'],
        },
      ],
    },
    recency: {
      default_max_age_years: 10,
    },
    scale_policy: {
      default_accepted: ['state', 'regional', 'national', 'global'],
    },
  };
}

function buildPlanSpecs(
  dimensionSlugs: readonly string[],
  byDimension: Readonly<Record<string, CaliforniaGoldenIndicator[]>>,
  blocklistInstructions: string,
): PlanDimensionSpec[] {
  return dimensionSlugs.map((dimSlug) => {
    const inds = byDimension[dimSlug] ?? [];
    if (inds.length === 0) {
      throw new Error(`No California golden indicators found for dimension "${dimSlug}"`);
    }
    const first = inds[0]!;
    const targetNotes = inds
      .map(
        (ind) =>
          `- ${ind.name} (slug: ${ind.slug}): measure "${ind.definition}". Preferred unit: "${ind.unit || (ind.value.includes('%') ? '%' : 'native unit')}". Benchmark target boundary: ${ind.target}.`,
      )
      .join('\n');

    return {
      dimensionId: `golden-ca-${dimSlug}`,
      slug: dimSlug,
      ring: first.ring,
      name: first.dimensionName,
      indicators: inds.map((ind) => ({
        slug: ind.slug,
        name: `${ind.name}: ${ind.definition}`,
        unit: ind.unit || (ind.value.includes('%') ? '%' : 'native unit'),
        threshold_ref: '',
      })),
      reviewerNotes: [
        'Research the exact California statewide constructs listed below using primary state or federal sources (report the most recent verified primary release available).',
        targetNotes,
        '',
        blocklistInstructions,
      ].join('\n'),
    };
  });
}

function resolveEffectivePlanModels(
  plan: ResearchPlan,
  opts: CliOptions,
): ResearchPlan {
  const meta = PROVIDER_META[opts.provider];
  const baseModels = { ...(plan.models ?? {}) };

  let sessionModel = opts.model ?? baseModels.session_model ?? meta.defaultModel;
  let verifierModel = opts.verifierModel ?? opts.orchestratorModel ?? baseModels.verifier_model ?? meta.defaultModel;
  let escalationModel = opts.escalationModel ?? opts.orchestratorModel ?? baseModels.escalation_model;
  let subagentModel = baseModels.subagent_model ?? null;

  // When running a non-Anthropic provider without explicit model overrides, map
  // strategy models cleanly onto that provider's canonical models.
  if (opts.provider !== 'anthropic') {
    if (!opts.model) sessionModel = meta.defaultModel;
    if (!opts.verifierModel && !opts.orchestratorModel) verifierModel = meta.defaultModel;
    if (!opts.escalationModel && !opts.orchestratorModel && escalationModel) {
      escalationModel = opts.model ?? meta.defaultModel;
    }
    subagentModel = null;
  }

  return {
    ...plan,
    models: {
      ...baseModels,
      session_model: sessionModel,
      verifier_model: verifierModel,
      subagent_model: subagentModel,
      ...(escalationModel ? { escalation_model: escalationModel } : {}),
    },
    ...(opts.maxTurns
      ? {
          caps: {
            verifier_max_turns: plan.caps?.verifier_max_turns ?? VERIFIER_MAX_TURNS,
            audit_max_turns: plan.caps?.audit_max_turns ?? 16,
            ...(plan.caps ?? {}),
            session_max_turns: opts.maxTurns,
          },
        }
      : {}),
  };
}

function decodeTranscriptToText(buf: Buffer | undefined): string {
  if (!buf || buf.length === 0) return '';
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  return (isGzip ? gunzipSync(buf) : buf).toString('utf8');
}

function printDryRunSummary(input: {
  opts: CliOptions;
  totalGoldenCount: number;
  totalDimensionCount: number;
  selectedDimensions: string[];
  goldenIndicators: CaliforniaGoldenIndicator[];
  blocklist: SourceBlocklist;
  plan: ResearchPlan;
}): void {
  const { opts, selectedDimensions, goldenIndicators, blocklist, plan } = input;
  console.log('=== California 2025 Golden-Test Benchmark (DRY RUN) ===');
  console.log(`Golden dataset: ${input.totalGoldenCount} verified indicators across ${input.totalDimensionCount} canonical dimensions`);
  console.log(`Selected dimensions (${selectedDimensions.length}): ${selectedDimensions.join(', ')}`);
  console.log(
    `Runtime config: provider=${opts.provider}, strategy=${plan.strategy ?? opts.strategy}@${plan.strategy_version ?? 1}, ` +
      `session_model=${plan.models?.session_model ?? 'default'}, verifier_model=${plan.models?.verifier_model ?? 'default'}`,
  );
  console.log(`Planned sessions: ${plan.sessions.length} (1 region_context + ${plan.sessions.length - 1} dimension)`);

  console.log('\n--- Active Source-Leak Blocklist (Egress + Prompt + Post-Run Audit) ---');
  console.log(`Label: ${blocklist.label}`);
  console.log(`Blocked domains (${blocklist.domains?.length ?? 0}): ${(blocklist.domains ?? []).join(', ')}`);
  console.log(`Blocked URL substrings (${blocklist.urlSubstrings?.length ?? 0}):`);
  for (const s of blocklist.urlSubstrings ?? []) {
    console.log(`  - ${s}`);
  }
  console.log(`Blocked regex patterns (${blocklist.patterns?.length ?? 0}):`);
  for (const p of blocklist.patterns ?? []) {
    console.log(`  - ${p.toString()}`);
  }

  console.log('\n--- Ground-Truth California 2025 Targets (Held Out from Prompts) ---');
  for (const ind of goldenIndicators) {
    console.log(
      `  [${ind.dimensionSlug}] ${ind.name} (slug: ${ind.slug}): ` +
        `value=${ind.value}${ind.unit && !ind.value.includes(ind.unit) ? ` ${ind.unit}` : ''}, ` +
        `target=${ind.target}, period=${ind.period}, report_score=${ind.scoreText} (p${ind.page}) | ` +
        `primary_source=${ind.source}`,
    );
  }

  console.log('\n--- Rendered Session Plan Verification ---');
  for (let i = 0; i < plan.sessions.length; i++) {
    const s = plan.sessions[i]!;
    const hasBlocklist = s.prompt.includes('STRICT BENCHMARK SOURCE ISOLATION');
    const slugs = s.kind === 'dimension' ? plannedSlugsFromPrompt(s.prompt) : [];
    console.log(
      `  Session ${i}: kind=${s.kind}${s.dimension_slug ? ` dim=${s.dimension_slug}` : ''}` +
        `${slugs.length ? ` indicators=[${slugs.join(', ')}]` : ''} ` +
        `prompt_chars=${s.prompt.length} blocklist_instructions=${hasBlocklist ? 'YES' : 'NO'}`,
    );
  }
  console.log('\nDry run complete. Omit --dry-run (with provider API key set) to execute live benchmark.');
}

async function main(): Promise<void> {
  loadEnvLocalIfPresent(REPO_ROOT);
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  const golden = loadCaliforniaGolden(REPO_ROOT);
  const { dimensionSlugs, indicators: selectedGolden } = selectCaliforniaGoldenDimensions(
    golden,
    opts.dimensions,
  );
  const blocklist = buildCaliforniaReportBlocklist(REPO_ROOT);
  const blocklistInstructions = renderBlocklistInstructions(blocklist);
  const config = buildCaliforniaPortraitConfig();

  const specs = buildPlanSpecs(dimensionSlugs, golden.byDimension, blocklistInstructions);
  const rawPlan = renderPlan({
    config,
    dimensions: specs,
    strategy: strategyRef(resolveStrategy(opts.strategy)),
  });

  // Inject source-isolation instructions into Phase 0 region_context too so it never fetches the report.
  const isolatedPlan: ResearchPlan = {
    ...rawPlan,
    sessions: rawPlan.sessions.map((s) =>
      s.kind === 'region_context'
        ? { ...s, prompt: `${s.prompt}\n\n${blocklistInstructions}` }
        : s,
    ),
  };
  const plan = resolveEffectivePlanModels(isolatedPlan, opts);

  if (opts.dryRun) {
    printDryRunSummary({
      opts,
      totalGoldenCount: golden.indicators.length,
      totalDimensionCount: golden.dimensionSlugs.length,
      selectedDimensions: dimensionSlugs,
      goldenIndicators: selectedGolden,
      blocklist,
      plan,
    });
    return;
  }

  // Live execution mode
  const apiKey = resolveProviderEnvKey(opts.provider, process.env);
  if (!apiKey) {
    const envNames = PROVIDER_META[opts.provider].envKeys.join(' or ');
    throw new Error(
      `Missing API key for provider "${opts.provider}". Set ${envNames} in your environment or .env.local, or pass --dry-run.`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = opts.outDir
    ? path.resolve(process.cwd(), opts.outDir)
    : path.join(REPO_ROOT, 'research', 'evals', `california-${stamp}`);
  await mkdir(outDir, { recursive: true });

  // Lazy-import worker & civic-data runtime only for live runs so --dry-run stays lightweight.
  const [sessionMod, applyMod, cacheMod, evidenceMod, exhibitsMod, civicMod] = await Promise.all([
    import('../apps/worker/src/session.js'),
    import('../apps/worker/src/tasks/research-apply.js'),
    import('../apps/worker/src/source-cache.js'),
    import('../apps/worker/src/evidence.js'),
    import('../apps/worker/src/archived-exhibits.js'),
    import('../packages/civic-data/src/index.js'),
  ]);

  const storage = await createTenantStorage('california-golden-eval', {
    localFallbackDir: path.join(outDir, 'evidence'),
    localPrivateDir: path.join(outDir, 'private'),
  });
  const sourceCache = new cacheMod.SourceCache();
  const civicRegistry = civicMod.createCivicDataTools({ storage, env: process.env });
  const civicMcpServer = applyMod.createCivicDataMcpServer(storage, process.env);
  const civicAllowedTools =
    opts.provider === 'anthropic'
      ? [...civicMod.CIVIC_DATA_MCP_TOOL_NAMES]
      : civicRegistry.tools.map((t) => t.name);

  const runStartedAt = new Date();
  let totalUsage: SessionTokenUsage = emptyUsage();
  const dimensionUsage: Record<string, SessionTokenUsage> = {};
  const transcriptChunks: string[] = [];
  const allFindings: Array<{
    indicatorSlug: string;
    dimensionSlug: string;
    payload: FindingPayload;
    verification: unknown;
  }> = [];

  await writeFile(path.join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  try {
    await withEgressBlocklist(blocklist, async () => {
      // Phase 0: region context (runs on orchestratorModel when specified)
      const regionSession = plan.sessions.find((s) => s.kind === 'region_context');
      const phase0Model = opts.orchestratorModel ?? plan.models?.session_model;
      let regionBrief = '';
      if (regionSession) {
        console.log(`[phase 0] Running region_context (${opts.provider} / ${phase0Model})...`);
        const phase0 = await sessionMod.runSessionWithRetry({
          prompt: regionSession.prompt,
          allowedTools: regionSession.tool_allowlist,
          extraAllowedTools: civicAllowedTools,
          extraMcpServers:
            opts.provider === 'anthropic'
              ? { [civicMod.CIVIC_DATA_MCP_SERVER_NAME]: civicMcpServer }
              : undefined,
          civicDataTools: opts.provider !== 'anthropic' ? civicRegistry.tools : undefined,
          storage,
          sourceCache,
          provider: opts.provider,
          model: phase0Model,
          apiKey,
          orchestrate: false,
          maxTurns: Math.min(plan.caps?.session_max_turns ?? DEFAULT_SESSION_MAX_TURNS, 6),
          sourceBlocklist: blocklist,
        });
        totalUsage = mergeUsage(totalUsage, phase0.usage);
        transcriptChunks.push(decodeTranscriptToText(phase0.transcript));
        if (!phase0.succeeded || !phase0.resultText.trim()) {
          throw new Error(
            `Phase 0 region_context session failed or returned empty brief ` +
              `(succeeded=${phase0.succeeded}, apiError=${phase0.apiError ?? 'none'}, apiErrorText=${phase0.apiErrorText ?? 'none'}, resultLen=${phase0.resultText.length})`,
          );
        }
        regionBrief = phase0.resultText;
      }

      // Dimension sessions
      for (const dimSession of plan.sessions) {
        if (dimSession.kind !== 'dimension' || !dimSession.dimension_slug) continue;
        const dimSlug = dimSession.dimension_slug;
        const dimName = golden.byDimension[dimSlug]?.[0]?.dimensionName ?? dimSlug;
        const plannedSlugs = plannedSlugsFromPrompt(dimSession.prompt);
        const prompt = dimSession.prompt.replaceAll(REGION_BRIEF_PLACEHOLDER, regionBrief);

        console.log(
          `[dimension:${dimSlug}] Researching ${plannedSlugs.length} indicator(s): ${plannedSlugs.join(', ')}...`,
        );

        const initialResult = await sessionMod.runSessionWithRetry({
          prompt,
          allowedTools: dimSession.tool_allowlist,
          extraAllowedTools: civicAllowedTools,
          extraMcpServers:
            opts.provider === 'anthropic'
              ? { [civicMod.CIVIC_DATA_MCP_SERVER_NAME]: civicMcpServer }
              : undefined,
          civicDataTools: opts.provider !== 'anthropic' ? civicRegistry.tools : undefined,
          storage,
          sourceCache,
          provider: opts.provider,
          model: plan.models?.session_model,
          scoutModel: applyMod.plannedInitialScoutModel(plan),
          apiKey,
          maxTurns: plan.caps?.session_max_turns ?? DEFAULT_SESSION_MAX_TURNS,
          submitFindingsContext: { config, dimensionSlug: dimSlug },
          sourceBlocklist: blocklist,
        });

        let dimUsage = initialResult.usage;
        transcriptChunks.push(decodeTranscriptToText(initialResult.transcript));

        let rawFindings: unknown[] = [];
        let salvaged = false;
        if (initialResult.submittedFindings?.length) {
          rawFindings = initialResult.submittedFindings;
        } else if (initialResult.resultText.trim()) {
          try {
            const parsed = sessionMod.extractJson(initialResult.resultText);
            rawFindings = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
            salvaged = parsed.salvaged;
          } catch {
            console.warn(`[dimension:${dimSlug}] Could not parse JSON from session output`);
          }
        }

        const capturedSnapshots = new Set<string>(initialResult.capturedSnapshotPaths ?? []);
        const readText = async (textPath: string) => (await storage.get(textPath)).toString('utf8');

        const evaluated = await applyMod.evaluateDimensionFindings(
          {
            sessionId: `golden-${dimSlug}`,
            config,
            dimensionSlug: dimSlug,
            dimensionName: dimName,
            regionBrief,
            plan,
            rawFindings,
            plannedSlugs,
            initialModel: plan.models?.session_model,
            salvaged,
            initialKeyFailure: null,
          },
          {
            deterministicChecks: (raw, cfg, slug) =>
              deterministicChecks(raw, cfg, slug, undefined, {
                runStartedAt,
                capturedSnapshotPaths: capturedSnapshots,
                blocklist,
              }),
            checkValueOnPage: (payload) => checkValueOnPage(payload, readText),
            recaptureEvidence: async (url, pdfUrl) => {
              try {
                const cap = await evidenceMod.captureEvidence(storage, url, pdfUrl, { sourceCache });
                capturedSnapshots.add(cap.snapshot_path);
                return cap;
              } catch {
                return null;
              }
            },
            runCorrectionSession: async ({ prompt: corrPrompt, maxTurns }) => {
              const res = await sessionMod.runSessionWithRetry({
                prompt: `${corrPrompt}\n\n${blocklistInstructions}`,
                allowedTools: DIMENSION_TOOLS,
                extraAllowedTools: civicAllowedTools,
                extraMcpServers:
                  opts.provider === 'anthropic'
                    ? { [civicMod.CIVIC_DATA_MCP_SERVER_NAME]: civicMcpServer }
                    : undefined,
                civicDataTools: opts.provider !== 'anthropic' ? civicRegistry.tools : undefined,
                storage,
                sourceCache,
                provider: opts.provider,
                model: plan.models?.session_model,
                apiKey,
                orchestrate: false,
                maxTurns,
                submitFindingsContext: { config, dimensionSlug: dimSlug },
                sourceBlocklist: blocklist,
              });
              for (const p of res.capturedSnapshotPaths ?? []) capturedSnapshots.add(p);
              return res;
            },
            runEscalationSession: async ({ prompt: escPrompt, maxTurns }) => {
              const escOpts = applyMod.plannedEscalationOptions(plan);
              const res = await sessionMod.runSessionWithRetry({
                prompt: `${escPrompt}\n\n${blocklistInstructions}`,
                allowedTools: DIMENSION_TOOLS,
                extraAllowedTools: civicAllowedTools,
                extraMcpServers:
                  opts.provider === 'anthropic'
                    ? { [civicMod.CIVIC_DATA_MCP_SERVER_NAME]: civicMcpServer }
                    : undefined,
                civicDataTools: opts.provider !== 'anthropic' ? civicRegistry.tools : undefined,
                storage,
                sourceCache,
                provider: opts.provider,
                model: escOpts.model ?? plan.models?.session_model,
                scoutModel: escOpts.scoutModel,
                apiKey,
                maxTurns: Math.min(maxTurns, escOpts.maxTurns),
                submitFindingsContext: { config, dimensionSlug: dimSlug },
                sourceBlocklist: blocklist,
              });
              for (const p of res.capturedSnapshotPaths ?? []) capturedSnapshots.add(p);
              return res;
            },
            runVerifier: async (payload: IndicatorFindingPayload) => {
              const archive = await exhibitsMod.loadFindingExhibits(storage, payload);
              const vPrompt =
                renderVerifierPrompt({
                  indicator_name: payload.name,
                  claimed_value: String(payload.value),
                  unit: payload.unit,
                  year: String(payload.year),
                  geography: `${config.region.name} (${payload.geographic_scale} scale)`,
                  source_name: payload.source,
                  source_url: payload.source_url,
                  archived_exhibits: archive.names,
                  archive_note: archive.note,
                  narrative_draft: payload.narrative_draft,
                }) + `\n\n${blocklistInstructions}`;
              const vModel = plan.models?.verifier_model ?? PROVIDER_META[opts.provider].defaultModel;
              const vProvider = providerForModel(vModel, opts.provider);
              const vApiKey = resolveProviderEnvKey(vProvider, process.env) ?? apiKey;
              const vRes = await sessionMod.runSession({
                prompt: vPrompt,
                allowedTools: VERIFIER_TOOLS,
                provider: vProvider,
                model: vModel,
                apiKey: vApiKey,
                archivedExhibits: archive.exhibits,
                orchestrate: false,
                maxTurns: plan.caps?.verifier_max_turns ?? VERIFIER_MAX_TURNS,
                sourceBlocklist: blocklist,
              });
              transcriptChunks.push(decodeTranscriptToText(vRes.transcript));
              if (!vRes.succeeded) return { verdict: null, usage: vRes.usage, failure: vRes };
              try {
                const parsed = sessionMod.extractJson(vRes.resultText).value as {
                  content_supported?: string;
                  verifier_note?: string;
                };
                if (
                  parsed.content_supported === 'pass' ||
                  parsed.content_supported === 'fail' ||
                  parsed.content_supported === 'uncertain'
                ) {
                  return {
                    verdict: {
                      content_supported: parsed.content_supported as ContentSupported,
                      verifier_note: parsed.verifier_note,
                    },
                    usage: vRes.usage,
                  };
                }
              } catch {
                // Non-JSON verifier output falls through to null verdict.
              }
              return { verdict: null, usage: vRes.usage };
            },
            warn: (msg) => console.warn(msg),
          },
        );

        dimUsage = mergeUsage(dimUsage, evaluated.verifierUsage);
        if (evaluated.correctionUsage) dimUsage = mergeUsage(dimUsage, evaluated.correctionUsage);
        if (evaluated.escalationUsage) dimUsage = mergeUsage(dimUsage, evaluated.escalationUsage);
        if (evaluated.correctionTranscript) {
          transcriptChunks.push(decodeTranscriptToText(evaluated.correctionTranscript));
        }
        if (evaluated.escalationTranscript) {
          transcriptChunks.push(decodeTranscriptToText(evaluated.escalationTranscript));
        }

        dimensionUsage[dimSlug] = dimUsage;
        totalUsage = mergeUsage(totalUsage, dimUsage);

        for (const rec of evaluated.records) {
          allFindings.push({
            indicatorSlug: rec.indicatorSlug,
            dimensionSlug: dimSlug,
            payload: rec.payload,
            verification: rec.verification,
          });
        }
      }
    });
  } finally {
    await evidenceMod.closeEvidenceBrowser().catch(() => {});
  }

  const combinedTranscript = transcriptChunks.filter(Boolean).join('\n');
  const modelLabel = opts.orchestratorModel
    ? `orch=${opts.orchestratorModel},worker=${plan.models?.session_model}`
    : plan.models?.session_model;
  const scorecard = scoreGoldenRun(allFindings, selectedGolden, {
    blocklist,
    transcript: combinedTranscript,
    usage: totalUsage,
    dimensionUsage,
    provider: opts.provider,
    model: modelLabel,
    strategy: `${plan.strategy ?? opts.strategy}@${plan.strategy_version ?? 1}`,
    runId: `california-${stamp}`,
  });

  const markdown = renderGoldenScorecardMarkdown(scorecard);
  await writeFile(path.join(outDir, 'findings.json'), `${JSON.stringify(allFindings, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'scorecard.json'), `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'scorecard.md'), markdown, 'utf8');

  console.log(`\n${markdown}`);
  const priced = priceSessionUsage(totalUsage);
  console.log('Per-model usage breakdown:');
  for (const [mId, mu] of Object.entries(totalUsage.by_model ?? {})) {
    const tokUsd = priceModelTokens(mId, mu);
    const searchUsd = mu.web_search_requests * WEB_SEARCH_USD_PER_REQUEST;
    const totalUsd = tokUsd !== null ? `$${(tokUsd + searchUsd).toFixed(4)}` : 'unpriced';
    console.log(
      `  - ${mId}: in=${mu.input_tokens} cached=${mu.cache_read_tokens} write=${mu.cache_write_tokens} out=${mu.output_tokens} searches=${mu.web_search_requests} => ${totalUsd}`,
    );
  }
  console.log(
    `Total verified USD: $${priced.dollars.toFixed(4)}${priced.unpriced.length ? ` (unpriced: ${priced.unpriced.join(', ')})` : ''}`,
  );
  console.log(`Artifacts written to: ${outDir}`);

  if (!scorecard.clean) {
    console.error(
      `BENCHMARK FAILED: ${scorecard.sourceLeakAudit.leakCount} source leak(s) detected against ${blocklist.label}.`,
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
