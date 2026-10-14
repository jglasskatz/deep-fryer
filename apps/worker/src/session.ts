import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SessionTokenUsage } from '@deep-fryer/core';
import { DEFAULT_SESSION_MAX_TURNS, DEFAULT_SESSION_MODEL } from '@deep-fryer/research';
import { captureEvidence } from './evidence.js';
import type { TenantStorage } from './storage.js';

export interface SessionResult {
  resultText: string;
  transcript: Buffer;
  usage: SessionTokenUsage;
  succeeded: boolean;
}

/**
 * Transient transport failures ("Connection closed mid-response", overloaded,
 * 5xx) and turn-cap exhaustion kill an entire session. The SDK surfaces some
 * of these as THROWN errors, not unsuccessful results — so the retry must
 * catch throws, and a double failure must return a failed result rather than
 * propagate, or one bad session kills the surrounding 21-session run. Usage
 * from both attempts is summed — the spend was real either way.
 */
export async function runSessionWithRetry(
  input: Parameters<typeof runSession>[0],
): Promise<SessionResult> {
  const attempt = async (): Promise<SessionResult> => {
    try {
      return await runSession(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        resultText: '',
        transcript: gzipSync(JSON.stringify({ type: 'session_error', message })),
        usage: { input_tokens: 0, output_tokens: 0 },
        succeeded: false,
      };
    }
  };
  const first = await attempt();
  if (first.succeeded) return first;
  const second = await attempt();
  return {
    ...second,
    usage: {
      input_tokens: first.usage.input_tokens + second.usage.input_tokens,
      output_tokens: first.usage.output_tokens + second.usage.output_tokens,
      cache_read_tokens:
        (first.usage.cache_read_tokens ?? 0) + (second.usage.cache_read_tokens ?? 0),
      cache_write_tokens:
        (first.usage.cache_write_tokens ?? 0) + (second.usage.cache_write_tokens ?? 0),
    },
  };
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;

/**
 * Orchestrated mode: when RESEARCH_SUBAGENT_MODEL is set (e.g. 'claude-sonnet-5'),
 * researcher sessions get a source-scout subagent on that model and the Task
 * tool to dispatch it. The main session stays the single synthesizer — scouts
 * gather, they never conclude. Verifier sessions are excluded by construction
 * (their allowlist has no WebSearch).
 */
const SCOUT_MODEL = () => process.env.RESEARCH_SUBAGENT_MODEL;

const SCOUT_AGENT = (model: string) => ({
  'source-scout': {
    description:
      'Fast scout for breadth work. Dispatch it for every initial source sweep (one scout per tier or portal), to check whether a portal/publisher has a candidate dataset before you descend a tier, and to skim a candidate page for the exact figure. It reports raw material only — you evaluate and synthesize.',
    prompt:
      'You are a source scout for a civic research orchestrator. Execute exactly the search or fetch task you were given and report raw material: for each candidate source — URL, publisher, publication date, the exact quoted text containing any relevant figure (with enough surrounding text to locate it), the geography and year the figure covers, and your best guess at its source tier. Report dead ends honestly ("portal has no dataset for X"). Do NOT synthesize, conclude, score, or recommend which source to accept. Never state a figure you did not see verbatim on a fetched page.',
    tools: ['WebSearch', 'WebFetch'],
    model,
  },
});

const DELEGATION_NOTE = `

## Delegation (execution policy)

A 'source-scout' subagent is available via the Task tool. Dispatch scouts for breadth work — tier sweeps, portal checks, page skims — and reserve your own turns for judgment: source evaluation, tier decisions, value extraction from evidence you capture yourself, scoring math, and composing findings. Every scout dispatch must state: objective, expected report format, and boundaries (per the delegation contract). You remain the single synthesizer; scout reports are raw material, not conclusions. Capture evidence yourself for every accepted source.`;

/**
 * What orchestrated mode adds: the subagent dispatch tool, and TaskOutput,
 * which collects the report of a scout dispatched in the background. The
 * dispatch tool is `Agent` in current Claude Code; older releases (and
 * permission rules written for them) call it `Task`. Both names are listed
 * so orchestrated mode keeps its scouts whichever the bundled CLI
 * recognizes — an unknown name in the tool set matches nothing.
 */
const DISPATCH_TOOLS = ['Agent', 'Task', 'TaskOutput'];

/**
 * Built-in tools that reach the worker's own machine: the shell, the
 * filesystem, notebooks, background processes. No session ever needs them —
 * every session's work is web research plus our in-process MCP tools — and
 * each one would let text the model read (a fetched page, a pasted policy
 * brief) steer it into the worker's environment. The `tools` option below
 * already leaves them out; listing them as disallowed as well means a
 * future change to the base tool set cannot quietly bring one back.
 */
const LOCAL_MACHINE_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'LS',
  'REPL',
  'Monitor',
];

/**
 * The environment a session's CLI subprocess runs with. The SDK otherwise
 * hands the subprocess the worker's entire process.env — the owner-role
 * DATABASE_URL (which bypasses row-level security), the S3 keys, SMTP
 * credentials — and a session's input is untrusted text by design. So the
 * subprocess gets only what it needs to reach the model through the egress
 * proxy: the Anthropic/Claude Code configuration, the proxy and CA-bundle
 * settings, and the basics a process needs to start (PATH, HOME, temp dir,
 * locale). Anything not listed here is withheld.
 */
const SESSION_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CLAUDE_CONFIG_DIR',
];
/** The model client's own configuration namespaces (API key, base URL, CLI knobs). */
const SESSION_ENV_PREFIXES = ['ANTHROPIC_', 'CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_'];

/** Pure: the subset of `source` a session subprocess may see (see SESSION_ENV_KEYS). */
export function sessionEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SESSION_ENV_KEYS.includes(key) || SESSION_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * One research session = one Agent SDK session in a scratch workspace
 * (SPEC.md §8 Apply). The full message stream is retained as the audit
 * transcript (gzipped JSONL). In production each session additionally runs
 * inside an ephemeral container behind the egress allowlist proxy — that
 * isolation lives in the deploy layer (see apps/worker/README.md); the tool
 * surface and the subprocess environment are restricted here, so a session
 * is contained even where that deploy layer is missing.
 */
export async function runSession(input: {
  prompt: string;
  /**
   * The session's entire tool surface: built-in tools by name (WebSearch,
   * WebFetch) plus our MCP tools (mcp__evidence__…). Nothing outside it
   * exists in the session, and nothing outside it may run.
   */
  allowedTools: string[];
  storage?: TenantStorage;
  maxTurns?: number;
  model?: string;
  /**
   * Orchestrated mode (scouts via the dispatch tool, see SCOUT_MODEL). When
   * omitted it follows the research rule: on whenever RESEARCH_SUBAGENT_MODEL
   * is set and the session may search the web. Sessions that are not
   * research — a policy analysis, whose prompt ends with its own output
   * contract — pass false so no delegation note is appended after it.
   */
  orchestrate?: boolean;
}): Promise<SessionResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'df-session-'));
  const transcriptLines: string[] = [];
  let resultText = '';
  let succeeded = false;
  const usage: SessionTokenUsage = { input_tokens: 0, output_tokens: 0 };

  const mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  if (input.storage) {
    const storage = input.storage;
    mcpServers.evidence = createSdkMcpServer({
      name: 'evidence',
      version: '1.0.0',
      tools: [
        tool(
          'capture_evidence',
          'Capture an evidence snapshot of a source you have decided to accept: a full-page screenshot, plus the PDF when the source is a document. Returns storage paths for the finding\'s evidence field.',
          {
            url: z.string().describe('The exact URL the value was read from'),
            pdf_url: z.string().optional().describe('Direct PDF URL when the source is a document'),
          },
          async (args) => {
            try {
              const result = await captureEvidence(storage, args.url, args.pdf_url);
              return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: `capture failed: ${err instanceof Error ? err.message : String(err)}`,
                    }),
                  },
                ],
              };
            }
          },
        ),
      ],
    });
  }

  const scoutModel = SCOUT_MODEL();
  const orchestrated =
    input.orchestrate !== false && Boolean(scoutModel) && input.allowedTools.includes('WebSearch');

  // The explicit allowlist from the rendered plan is the entire tool surface
  // (SPEC §8). The SDK enforces that with three separate options, and all
  // three are needed:
  // - `tools` is the set of built-in tools that EXIST in the session. Without
  //   it the session gets every Claude Code tool (shell, file reads…), and
  //   `allowedTools` alone only decides which of those run unprompted.
  // - `allowedTools` pre-approves the allowlist, MCP tools included (MCP
  //   tools come from `mcpServers`, so they are not in `tools`).
  // - `permissionMode: 'dontAsk'` denies anything not pre-approved instead of
  //   falling back to default-mode rules (which auto-approve file reads).
  // Orchestrated mode adds only DISPATCH_TOOLS + the scout definition.
  const allowed = orchestrated ? [...input.allowedTools, ...DISPATCH_TOOLS] : input.allowedTools;
  const builtIn = allowed.filter((t) => !t.startsWith('mcp__'));

  try {
    const q = query({
      prompt: orchestrated ? input.prompt + DELEGATION_NOTE : input.prompt,
      options: {
        model: input.model ?? MODEL(),
        cwd: workspace,
        tools: builtIn,
        allowedTools: allowed,
        disallowedTools: LOCAL_MACHINE_TOOLS.filter((t) => !allowed.includes(t)),
        permissionMode: 'dontAsk',
        env: sessionEnv(),
        maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
        ...(orchestrated && scoutModel ? { agents: SCOUT_AGENT(scoutModel) } : {}),
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      },
    });

    for await (const message of q) {
      transcriptLines.push(JSON.stringify(message));
      if (message.type === 'result') {
        succeeded = message.subtype === 'success';
        if ('result' in message && typeof message.result === 'string') {
          resultText = message.result;
        }
        const u = message.usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            }
          | undefined;
        if (u) {
          usage.input_tokens = u.input_tokens ?? 0;
          usage.output_tokens = u.output_tokens ?? 0;
          usage.cache_read_tokens = u.cache_read_input_tokens;
          usage.cache_write_tokens = u.cache_creation_input_tokens;
        }
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  return {
    resultText,
    transcript: gzipSync(transcriptLines.join('\n')),
    usage,
    succeeded,
  };
}

/**
 * Extract the first JSON value from a session's result text.
 *
 * Models wrap their answer in prose as often as not: a sentence before it,
 * a ```json fence around it, a "Note: …" after it. So this looks inside
 * fenced blocks first, then in the whole text, and at each `{` or `[` it
 * reads one balanced JSON value (respecting strings and escapes) and parses
 * just that — trailing text is ignored rather than failing the parse.
 *
 * `kind` narrows what counts: a caller whose contract is an object passes
 * 'object', so a bracketed aside in the prose ("the [3] largest effects")
 * is skipped instead of being returned as the answer.
 */
export function extractJson(text: string, opts: { kind?: 'object' | 'array' | 'any' } = {}): unknown {
  const kind = opts.kind ?? 'any';
  const openers = kind === 'object' ? '{' : kind === 'array' ? '[' : '{[';
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const candidate of [...fenced, text]) {
    for (let i = 0; i < candidate.length; i++) {
      if (!openers.includes(candidate[i]!)) continue;
      const end = balancedEnd(candidate, i);
      if (end < 0) continue;
      try {
        return JSON.parse(candidate.slice(i, end + 1));
      } catch {
        // Balanced but not JSON (prose in braces); try the next opener.
      }
    }
  }
  throw new Error('no JSON found in session output');
}

/**
 * Index of the bracket that closes the value opened at `start`, or -1 when
 * the text ends first. Brackets inside JSON strings do not count.
 */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
