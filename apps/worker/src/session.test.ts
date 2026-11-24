import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_SESSION_TOOLS } from './tasks/policy-analyze.js';

/**
 * The session runner's containment, checked at the boundary we control: the
 * options handed to the Claude Agent SDK. The SDK's `query` is mocked to
 * record them and answer with one successful result, so no model or network
 * is involved. What matters is what a session CAN do — which tools exist,
 * what runs without approval, and what environment the CLI subprocess sees —
 * because a session's input (a pasted policy brief, a fetched web page) is
 * untrusted text.
 */
const sdk = vi.hoisted(() => ({
  calls: [] as { prompt: string; options: Record<string, unknown> }[],
  /**
   * What the next query() calls stream, one script per call: the messages,
   * then optionally a throw (as the SDK throws when the CLI exits after an
   * API error, or the transport drops). With no script left, a call answers
   * with one successful result.
   */
  scripts: [] as { messages: unknown[]; throws?: Error }[],
  inspect: undefined as undefined | ((args: { prompt: string; options: Record<string, unknown> }) => Promise<void>),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn((args: { prompt: string; options: Record<string, unknown> }) => {
    sdk.calls.push(args);
    const script = sdk.scripts.shift() ?? {
      messages: [{ type: 'result', subtype: 'success', result: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 2 } }],
    };
    return (async function* () {
      await sdk.inspect?.(args);
      for (const message of script.messages) yield message;
      if (script.throws) throw script.throws;
    })();
  }),
}));

const SECRETS = {
  DATABASE_URL: 'postgres://owner:pw@db/deep_fryer',
  MIGRATION_DATABASE_URL: 'postgres://owner:pw@db/deep_fryer',
  S3_ACCESS_KEY_ID: 'AKIA',
  S3_SECRET_ACCESS_KEY: 'secret',
  SMTP_URL: 'smtp://user:pw@mail',
  AUTH_SECRET: 'auth',
  STRIPE_SECRET_KEY: 'sk_live',
};

describe('runSession containment', () => {
  const testEnv = {
    ...SECRETS,
    ANTHROPIC_API_KEY: 'sk-ant-test',
    HTTPS_PROXY: 'http://egress:3128',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/egress.pem',
    RESEARCH_SUBAGENT_MODEL: undefined as string | undefined,
  };
  const saved = Object.fromEntries(Object.keys(testEnv).map((k) => [k, process.env[k]]));
  const restore = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  beforeEach(() => {
    sdk.calls.length = 0;
    sdk.inspect = undefined;
    restore(testEnv);
  });
  afterEach(() => restore(saved));

  async function optionsFor(input: Parameters<typeof import('./session.js').runSession>[0]) {
    const { runSession } = await import('./session.js');
    const result = await runSession(input);
    expect(result.succeeded).toBe(true);
    return sdk.calls.at(-1)!;
  }

  it('gives a policy session exactly the web tools, denies everything else, and withholds worker secrets', async () => {
    const { options } = await optionsFor({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });

    // Only these built-in tools exist in the session at all…
    expect(options.tools).toEqual(['WebSearch', 'WebFetch']);
    expect(options.allowedTools).toEqual(['WebSearch', 'WebFetch']);
    // …anything not pre-approved is refused rather than prompted for…
    expect(options.permissionMode).toBe('dontAsk');
    // …and the tools that reach the worker's machine are named as disallowed too.
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit']));

    const env = options.env as Record<string, string>;
    for (const key of Object.keys(SECRETS)) expect(env).not.toHaveProperty(key);
    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      HTTPS_PROXY: 'http://egress:3128',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/egress.pem',
    });
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('hands the subprocess the planned page reader and turn cap', async () => {
    const savedReader = process.env.ANTHROPIC_SMALL_FAST_MODEL;
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'worker-reader';
    try {
      const planned = await optionsFor({ prompt: 'p', allowedTools: ['WebFetch'], orchestrate: false, maxTurns: 12, pageReaderModel: 'planned-reader' });
      expect(planned.options.maxTurns).toBe(12);
      expect((planned.options.env as Record<string, string>).ANTHROPIC_SMALL_FAST_MODEL).toBe('planned-reader');
      const historic = await optionsFor({ prompt: 'p', allowedTools: ['WebFetch'], orchestrate: false });
      expect((historic.options.env as Record<string, string>).ANTHROPIC_SMALL_FAST_MODEL).toBe('worker-reader');
    } finally {
      if (savedReader === undefined) delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
      else process.env.ANTHROPIC_SMALL_FAST_MODEL = savedReader;
    }
  });

  it('keeps the delegation note and dispatch tool off a session that opts out of orchestration', async () => {
    process.env.RESEARCH_SUBAGENT_MODEL = 'claude-sonnet-5';
    const policy = await optionsFor({ prompt: 'Reply with only a JSON object.', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });
    expect(policy.prompt).toBe('Reply with only a JSON object.');
    expect(policy.options.tools).toEqual(['WebSearch', 'WebFetch']);
    expect(policy.options).not.toHaveProperty('agents');

    // Research sessions keep orchestrated mode by default: the scout and its
    // dispatch tool are the only additions to the allowlist.
    const research = await optionsFor({
      prompt: 'Research.',
      allowedTools: ['WebSearch', 'WebFetch', 'mcp__evidence__capture_evidence'],
    });
    expect(research.prompt).toContain('## Delegation (execution policy)');
    expect(research.options.tools).toEqual(['WebSearch', 'WebFetch', 'Agent', 'Task', 'TaskOutput']);
    expect(research.options.allowedTools).toEqual([
      'WebSearch',
      'WebFetch',
      'mcp__evidence__capture_evidence',
      'Agent',
      'Task',
      'TaskOutput',
    ]);
    expect(research.options).toHaveProperty('agents');
  });

  it('keeps MCP tools out of the built-in set but pre-approves them', async () => {
    const { options } = await optionsFor({
      prompt: 'p',
      allowedTools: ['WebFetch', 'mcp__evidence__capture_evidence'],
    });
    expect(options.tools).toEqual(['WebFetch']);
    expect(options.allowedTools).toEqual(['WebFetch', 'mcp__evidence__capture_evidence']);
  });

  it('permits a verifier to read only its own fixed archived exhibits, then deletes the workspace', async () => {
    const { readFile, realpath, stat, symlink } = await import('node:fs/promises');
    const path = await import('node:path');
    let workspace = '';
    sdk.inspect = async ({ options }) => {
      workspace = options.cwd as string;
      expect(await readFile(path.join(workspace, 'archived-snapshot.png'), 'utf8')).toBe('captured source');
      expect(await readFile(path.join(workspace, 'archived-source.pdf'), 'utf8')).toBe('captured PDF');
      expect(await readFile(path.join(workspace, 'archived-source-excerpt.txt'), 'utf8')).toBe('bounded PDF excerpt');
      expect((await stat(path.join(workspace, 'archived-snapshot.png'))).mode & 0o777).toBe(0o400);
      expect((await stat(path.join(workspace, 'archived-source-excerpt.txt'))).mode & 0o777).toBe(0o400);
      const hooks = options.hooks as { PreToolUse: { matcher: string; hooks: ((input: unknown) => Promise<unknown>)[] }[] };
      expect(hooks.PreToolUse[0]!.matcher).toBe('Read');
      const guard = hooks.PreToolUse[0]!.hooks[0]!;
      const read = (file_path: unknown) => guard({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path } });
      expect(await read('archived-snapshot.png')).toEqual({});
      expect(await read(path.join(workspace, 'archived-source.pdf'))).toEqual({});
      expect(await read('archived-source-excerpt.txt')).toEqual({});
      for (const file of ['../other-session/archived-source.pdf', '/etc/passwd', '../../.env', 'missing.png', 42]) {
        expect(await read(file)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
      }
      // A path inside the workspace that points outside is still not an exhibit.
      await symlink(await realpath(import.meta.dirname), path.join(workspace, 'worker'));
      expect(await read('worker/session.ts')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    };
    const { options } = await optionsFor({
      prompt: 'Verify independently.', allowedTools: ['WebFetch', 'Read'], orchestrate: false,
      archivedExhibits: {
        snapshot: Buffer.from('captured source'),
        pdf: Buffer.from('captured PDF'),
        pdfExcerpt: Buffer.from('bounded PDF excerpt'),
      },
    });
    expect(options.tools).toEqual(['WebFetch', 'Read']);
    expect(options.disallowedTools).not.toContain('Read');
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Glob', 'Grep']));
    await expect(stat(workspace)).rejects.toThrow();
    sdk.inspect = undefined;
  });

  it('cannot enable arbitrary local reads by naming Read without archived bytes', async () => {
    const { options } = await optionsFor({ prompt: 'p', allowedTools: ['WebFetch', 'Read'] });
    expect(options.tools).toEqual(['WebFetch']);
    expect(options.allowedTools).toEqual(['WebFetch']);
    expect(options.disallowedTools).toContain('Read');
  });

  it('uses a frozen scout model, including explicit null, ahead of worker env defaults', async () => {
    process.env.RESEARCH_SUBAGENT_MODEL = 'changed-worker-scout';
    const standard = await optionsFor({ prompt: 'Research.', allowedTools: ['WebSearch'], scoutModel: null });
    expect(standard.options).not.toHaveProperty('agents');
    expect(standard.prompt).toBe('Research.');
    const deep = await optionsFor({ prompt: 'Research.', allowedTools: ['WebSearch'], model: 'planned-researcher', scoutModel: 'planned-scout' });
    expect(deep.options.model).toBe('planned-researcher');
    expect(deep.options.agents).toMatchObject({ 'source-scout': { model: 'planned-scout' } });
  });

  it('confines additional action exhibits to fixed names in the same workspace', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    sdk.inspect = async ({ options }) => {
      const workspace = options.cwd as string;
      expect(await readFile(path.join(workspace, 'action-1-snapshot.png'), 'utf8')).toBe('action exhibit');
      const hooks = options.hooks as { PreToolUse: { hooks: ((input: unknown) => Promise<unknown>)[] }[] };
      expect(await hooks.PreToolUse[0]!.hooks[0]!({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'action-1-snapshot.png' } })).toEqual({});
    };
    await optionsFor({ prompt: 'Verify an action.', allowedTools: ['Read'], archivedExhibits: { additional: [{ filename: 'action-1-snapshot.png', body: Buffer.from('action exhibit') }] } });
    sdk.inspect = undefined;
    const { runSession } = await import('./session.js');
    const calls = sdk.calls.length;
    await expect(runSession({ prompt: 'p', allowedTools: ['Read'], archivedExhibits: { additional: [{ filename: '../secret', body: Buffer.from('bad') }] } })).rejects.toThrow('invalid fixed action');
    expect(sdk.calls).toHaveLength(calls);
  });
});

describe('sessionEnv', () => {
  it('passes the model client configuration, proxy settings, and P2.1 CLI safety caps, nothing else', async () => {
    const {
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
      CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION,
      sessionEnv,
    } = await import('./session.js');
    expect(
      sessionEnv({
        ...SECRETS,
        PATH: '/usr/bin',
        HOME: '/home/pwuser',
        ANTHROPIC_API_KEY: 'k',
        ANTHROPIC_BASE_URL: 'https://gateway',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
        no_proxy: 'localhost',
        RESEARCH_SUBAGENT_MODEL: 'claude-sonnet-5',
      }),
    ).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/pwuser',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'https://gateway',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
      CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION,
      no_proxy: 'localhost',
    });
  });

  it('sets CLAUDE_CODE_SUBAGENT_MODEL explicitly when subagentModel is configured', async () => {
    const { sessionEnv } = await import('./session.js');
    const env = sessionEnv(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'k' },
      { subagentModel: 'claude-haiku-5-5' },
    );
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-haiku-5-5');
    expect(env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION).toBe('8');
    expect(env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION).toBe('40');
  });
});

describe('sessionEnv with a planned page reader', () => {
  it('reads fetched pages through the plan’s page reader instead of the worker’s setting, on either key', async () => {
    const { sessionEnv } = await import('./session.js');
    const worker = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_SMALL_FAST_MODEL: 'worker-reader' };
    const caps = { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '8', CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '40' };
    expect(sessionEnv(worker, { pageReaderModel: 'planned-reader' })).toEqual({
      ...worker,
      ...caps,
      ANTHROPIC_SMALL_FAST_MODEL: 'planned-reader',
    });
    expect(sessionEnv(worker, { apiKey: 'sk-ant-org-key', pageReaderModel: 'planned-reader' })).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-org-key',
      ANTHROPIC_SMALL_FAST_MODEL: 'planned-reader',
      ...caps,
    });
  });

  it('keeps the worker’s page reader when the plan recorded none, or a blank one', async () => {
    const { sessionEnv } = await import('./session.js');
    const worker = { PATH: '/usr/bin', ANTHROPIC_SMALL_FAST_MODEL: 'worker-reader' };
    const caps = { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '8', CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '40' };
    expect(sessionEnv(worker, {})).toEqual({ ...worker, ...caps });
    expect(sessionEnv(worker, { pageReaderModel: '  ' })).toEqual({ ...worker, ...caps });
  });
});

describe('sessionEnv with an organization key (SPEC-v7 §4)', () => {
  const deployment = {
    PATH: '/usr/bin',
    HTTPS_PROXY: 'http://egress:3128',
    ANTHROPIC_API_KEY: 'sk-ant-deployment',
    ANTHROPIC_MODEL: 'claude-sonnet-5',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
    // Deployment credentials and routing that must not outrank or receive the organization's key.
    ANTHROPIC_AUTH_TOKEN: 'deployment-bearer',
    ANTHROPIC_BASE_URL: 'https://gateway.internal',
    ANTHROPIC_CUSTOM_HEADERS: 'X-Gateway-Auth: deployment',
    CLAUDE_CODE_OAUTH_TOKEN: 'deployment-oauth',
    CLAUDE_CODE_USE_BEDROCK: '1',
    ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.internal',
  };

  it('replaces the deployment key with the organization key and withholds deployment credentials', async () => {
    const { sessionEnv } = await import('./session.js');
    expect(sessionEnv({ ...SECRETS, ...deployment }, { apiKey: 'sk-ant-org-key' })).toEqual({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://egress:3128',
      ANTHROPIC_API_KEY: 'sk-ant-org-key',
      ANTHROPIC_MODEL: 'claude-sonnet-5',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '8',
      CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '40',
    });
  });

  it('leaves the environment as it was without one (plus P2.1 CLI safety caps)', async () => {
    const { sessionEnv } = await import('./session.js');
    const expected = {
      ...deployment,
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '8',
      CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '40',
    };
    expect(sessionEnv(deployment, {})).toEqual(expected);
    expect(sessionEnv(deployment, { apiKey: '' })).toEqual(expected);
  });

  it('hands the organization key to the session subprocess only', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-deployment';
    try {
      const { runSession } = await import('./session.js');
      sdk.calls.length = 0;
      await runSession({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false, apiKey: 'sk-ant-org-key' });
      const { options, prompt } = sdk.calls.at(-1)!;
      expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-ant-org-key');
      // Nowhere else in what the SDK is given.
      expect(prompt).not.toContain('sk-ant-org-key');
      expect(JSON.stringify({ ...options, env: undefined })).not.toContain('sk-ant-org-key');
      // The worker's own environment is untouched.
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-deployment');
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('redacts the key from text that is stored', async () => {
    const { redactSecret } = await import('./session.js');
    expect(redactSecret('auth failed for sk-ant-org-key (sk-ant-org-key)', 'sk-ant-org-key')).toBe(
      'auth failed for [redacted API key] ([redacted API key])',
    );
    expect(redactSecret('nothing to hide', undefined)).toBe('nothing to hide');
  });
});

describe('extractJson', () => {
  it('reads one balanced value and ignores the prose after it', async () => {
    const { extractJson } = await import('./session.js');
    expect(extractJson('{"summary":"s","impacts":[]}\n\nNote: figures are estimates {roughly}.')).toEqual({
      value: { summary: 's', impacts: [] },
      salvaged: false,
    });
    expect(extractJson('Here it is:\n```json\n{"a":"has } and ] inside"}\n```\nDone.').value).toEqual({ a: 'has } and ] inside' });
    expect(extractJson('[{"kind":"gap"}] trailing words')).toEqual({ value: [{ kind: 'gap' }], salvaged: false });
  });

  it('skips bracketed prose when the caller wants an object', async () => {
    const { extractJson } = await import('./session.js');
    const text = 'The [3] largest effects are below.\n{"summary":"s"}';
    expect(extractJson(text)).toEqual({ value: [3], salvaged: false });
    expect(extractJson(text, { kind: 'object' })).toEqual({ value: { summary: 's' }, salvaged: false });
  });

  it('prefers a fenced block, and throws when there is no JSON at all', async () => {
    const { extractJson } = await import('./session.js');
    expect(extractJson('{not json} then ```json\n{"x":1}\n```')).toEqual({ value: { x: 1 }, salvaged: false });
    expect(() => extractJson('I could not assess this policy.')).toThrow(/no JSON/);
    expect(() => extractJson('{"unterminated": ')).toThrow(/no JSON/);
  });

  it('marks a fragment of malformed output as salvaged', async () => {
    const { extractJson } = await import('./session.js');
    // A trailing comma in finding 2 makes the array unparseable; finding 1 is all that reads.
    expect(extractJson('```json\n[{"indicator_slug":"a"},{"indicator_slug":"b",}]\n```')).toEqual({
      value: { indicator_slug: 'a' },
      salvaged: true,
    });
    // A reply cut off mid-array (an unclosed fence, the turn cap) leaves the array unclosed.
    expect(extractJson('```json\n[{"indicator_slug":"a"},{"indicator_slug":"b"},{"indicator_sl')).toEqual({
      value: { indicator_slug: 'a' },
      salvaged: true,
    });
    // An object answer with a malformed tail: the nested object is not the answer.
    expect(extractJson('{"summary":"s","impacts":[{"dimension_slug":"housing"},]}', { kind: 'object' })).toEqual({
      value: { dimension_slug: 'housing' },
      salvaged: true,
    });
    // Prose in braces BEFORE the answer is not part of it.
    expect(extractJson('Findings {see notes}: [{"indicator_slug":"a"}]')).toEqual({
      value: [{ indicator_slug: 'a' }],
      salvaged: false,
    });
  });
});

// ---- Metering (docs/haiku-5-5.md §3.1) -----------------------------------------

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

/**
 * One assistant frame: a content block of API call `id`, carrying the usage
 * the frame was serialized with. CLI 0.3.220 serializes a call's frames at
 * each content_block_stop with message_start's usage — output_tokens a
 * placeholder, stop_reason null — and only later writes the final figures
 * into those already-sent objects, so the tests give frames placeholder
 * output unless they say otherwise.
 */
function frame(
  id: string,
  usage: Usage,
  extra: {
    model?: string;
    stop_reason?: string | null;
    parent_tool_use_id?: string | null;
    error?: string;
    request_id?: string;
    text?: string;
  } = {},
) {
  return {
    type: 'assistant',
    parent_tool_use_id: extra.parent_tool_use_id ?? null,
    ...(extra.error ? { error: extra.error } : {}),
    ...(extra.request_id ? { request_id: extra.request_id } : {}),
    message: {
      id,
      model: extra.model ?? 'claude-sonnet-5-20260301',
      stop_reason: extra.stop_reason ?? null,
      usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
      content: extra.text ? [{ type: 'text', text: extra.text }] : [],
    },
  };
}

/** A raw API stream event as the SDK forwards it with includePartialMessages (SDKPartialAssistantMessage). */
const streamEvent = (event: unknown, parent: string | null = null) => ({
  type: 'stream_event',
  event,
  parent_tool_use_id: parent,
  uuid: 'u',
  session_id: 's',
});

/** message_start: the call's id, model and prompt usage, with the placeholder output count the API sends there. */
const messageStart = (id: string, usage: Omit<Usage, 'output_tokens'>, model = 'claude-sonnet-5-20260301') =>
  streamEvent({
    type: 'message_start',
    message: {
      id,
      model,
      type: 'message',
      role: 'assistant',
      content: [],
      stop_reason: null,
      usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage, output_tokens: 1 },
    },
  });

/** message_delta: the call's final output count (the prompt fields as the API sends them: null). */
const messageDelta = (outputTokens: number, stopReason: string = 'end_turn') =>
  streamEvent({
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null, container: null, stop_details: null },
    usage: { output_tokens: outputTokens, input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null },
  });

const messageStop = () => streamEvent({ type: 'message_stop' });

/**
 * One main-loop API call as CLI 0.3.220 streams it with partial messages
 * on: message_start, one frame per content block (placeholder output, as
 * serialized), message_delta with the final output, message_stop.
 */
const streamedCall = (id: string, usage: Usage, opts: { blocks?: number; model?: string; stopReason?: string } = {}) => [
  messageStart(id, usage, opts.model),
  ...Array.from({ length: opts.blocks ?? 2 }, () => frame(id, { ...usage, output_tokens: 1 }, { model: opts.model })),
  messageDelta(usage.output_tokens, opts.stopReason),
  messageStop(),
];

const init = (model = 'claude-sonnet-5') => ({ type: 'system', subtype: 'init', model });

const modelUsage = (inputTokens: number, outputTokens: number, cacheRead = 0, cacheWrite = 0, webSearchRequests = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheWrite,
  webSearchRequests,
  costUSD: 123.45,
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  canonicalModel: 'claude-sonnet-5',
});

describe('SessionMeter', () => {
  it('counts each API call once, with the final output count from its stream, however many frames it sent', async () => {
    const { SessionMeter } = await import('./session.js');
    const meter = new SessionMeter();
    for (const m of [
      init(),
      // Three content blocks; every frame says output_tokens 1, the delta says 250.
      ...streamedCall('msg_1', { input_tokens: 1000, output_tokens: 250, cache_read_input_tokens: 5000 }, { blocks: 3 }),
      ...streamedCall('msg_2', { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 300 }),
      // A scout's call: the CLI forwards its frames but not its stream, so the frames are all there is.
      frame('msg_3', { input_tokens: 70, output_tokens: 2 }, { model: 'claude-haiku-5-5', parent_tool_use_id: 'toolu_1' }),
      frame('msg_3', { input_tokens: 70, output_tokens: 7 }, { model: 'claude-haiku-5-5', parent_tool_use_id: 'toolu_1' }),
      // The CLI's own placeholder messages are not API calls.
      frame('msg_4', { input_tokens: 0, output_tokens: 0 }, { model: '<synthetic>' }),
    ]) {
      meter.observe(m as never);
    }

    expect(meter.usage()).toEqual({
      input_tokens: 1200,
      output_tokens: 290,
      cache_read_tokens: 5000,
      cache_write_tokens: 300,
      model: 'claude-sonnet-5',
      by_model: {
        'claude-sonnet-5-20260301': { input_tokens: 1200, output_tokens: 290, cache_read_tokens: 5000, cache_write_tokens: 300, web_search_requests: 0 },
        // Frames-only: the largest figure any frame gave, never their sum.
        'claude-haiku-5-5': { input_tokens: 70, output_tokens: 7, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
      },
      refusals: 0,
      partial: true,
    });
  });

  it('never lets a frame that arrives after the delta, or a placeholder, change a streamed call', async () => {
    const { SessionMeter } = await import('./session.js');
    const meter = new SessionMeter();
    meter.observe(messageStart('m', { input_tokens: 500, cache_read_input_tokens: 9000 }) as never);
    // Before the delta, the call reads its prompt and the placeholder output…
    expect(meter.usage().output_tokens).toBe(1);
    meter.observe(messageDelta(320) as never);
    // …after it, the final output, whatever frames say later.
    meter.observe(frame('m', { input_tokens: 500, output_tokens: 1, cache_read_input_tokens: 9000 }) as never);
    meter.observe(frame('m', { input_tokens: 999_999, output_tokens: 999_999 }) as never);
    meter.observe(messageStop() as never);
    expect(meter.usage()).toMatchObject({ input_tokens: 500, output_tokens: 320, cache_read_tokens: 9000 });
    // A delta with no open call (a stream already stopped) changes nothing.
    meter.observe(messageDelta(77) as never);
    expect(meter.usage().output_tokens).toBe(320);
  });

  it('splits off calls whose prompt exceeded 100K tokens, final output included, and joins the split to the result’s total', async () => {
    const { SessionMeter } = await import('./session.js');
    const meter = new SessionMeter();
    const haiku = { model: 'claude-haiku-5-5-20261001' };
    for (const m of [
      init('claude-haiku-5-5'),
      // 40K + 60K + 1K = 101K prompt: the long card. 30K + 70K = exactly 100K: not over.
      ...streamedCall('a', { input_tokens: 40_000, output_tokens: 900, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 1_000 }, haiku),
      ...streamedCall('b', { input_tokens: 30_000, output_tokens: 100, cache_read_input_tokens: 70_000 }, haiku),
    ]) {
      meter.observe(m as never);
    }
    expect(meter.usage().by_model?.['claude-haiku-5-5-20261001']?.long_prompt).toEqual({
      input_tokens: 40_000,
      // The delta's figure: the frames said 1, which would price this call's output on the wrong card.
      output_tokens: 900,
      cache_read_tokens: 60_000,
      cache_write_tokens: 1_000,
    });

    meter.observe({
      type: 'result',
      subtype: 'success',
      result: '[]',
      num_turns: 2,
      stop_reason: 'end_turn',
      terminal_reason: 'completed',
      total_cost_usd: 99,
      usage: { input_tokens: 70_000, output_tokens: 1_000, cache_read_input_tokens: 130_000, cache_creation_input_tokens: 1_000 },
      // Keyed as the CLI requested the model (undated), with the page reader's side calls alongside.
      modelUsage: {
        'claude-haiku-5-5': modelUsage(70_500, 1_100, 130_000, 1_000, 3),
        'claude-haiku-4-5-20251001': modelUsage(9_000, 400),
      },
    } as never);
    const usage = meter.usage();
    expect(usage).toEqual({
      input_tokens: 70_000,
      output_tokens: 1_000,
      cache_read_tokens: 130_000,
      cache_write_tokens: 1_000,
      model: 'claude-haiku-5-5',
      by_model: {
        'claude-haiku-5-5': {
          input_tokens: 70_500,
          output_tokens: 1_100,
          cache_read_tokens: 130_000,
          cache_write_tokens: 1_000,
          web_search_requests: 3,
          long_prompt: { input_tokens: 40_000, output_tokens: 900, cache_read_tokens: 60_000, cache_write_tokens: 1_000 },
        },
        'claude-haiku-4-5-20251001': { input_tokens: 9_000, output_tokens: 400, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
      },
      num_turns: 2,
      result_subtype: 'success',
      terminal_reason: 'completed',
      stop_reason: 'end_turn',
      refusals: 0,
    });
    // The SDK's own prices are never stored.
    expect(JSON.stringify(usage)).not.toMatch(/cost|canonical/i);
  });

  it('counts a refusal once per request and records a fallback to another model', async () => {
    const { SessionMeter } = await import('./session.js');
    const meter = new SessionMeter();
    meter.observe(init('claude-opus-5') as never);
    // The same refused request, reported by its stream, on its frame (which names the request) and as the CLI's notice.
    meter.observe(messageStart('m1', { input_tokens: 10 }, 'claude-opus-5') as never);
    meter.observe(frame('m1', { input_tokens: 10, output_tokens: 1 }, { model: 'claude-opus-5', request_id: 'req_1' }) as never);
    meter.observe(messageDelta(3, 'refusal') as never);
    meter.observe(frame('m1', { input_tokens: 10, output_tokens: 3 }, { model: 'claude-opus-5', stop_reason: 'refusal', request_id: 'req_1' }) as never);
    meter.observe({ type: 'system', subtype: 'model_refusal_no_fallback', original_model: 'claude-opus-5', request_id: 'req_1', content: '', uuid: 'u1' } as never);
    expect(meter.usage().refusals).toBe(1);
    // A second refusal the CLI retried on another model: the verdict then comes from a different judge.
    meter.observe({
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-opus-5',
      fallback_model: 'claude-opus-4-8',
      request_id: 'req_2',
      api_refusal_category: 'cyber',
      content: '',
      uuid: 'u2',
    } as never);
    const usage = meter.usage();
    expect(usage.refusals).toBe(2);
    expect(usage.refusal_fallbacks).toEqual([{ original_model: 'claude-opus-5', fallback_model: 'claude-opus-4-8', category: 'cyber' }]);
  });

  it('counts a refusal only its stream reported, and matches the CLI’s notice to it', async () => {
    const { SessionMeter } = await import('./session.js');
    // A Haiku refusal with no content block: no frame, so nothing names the request but the notice.
    const meter = new SessionMeter();
    meter.observe(init('claude-haiku-5-5') as never);
    meter.observe(messageStart('r1', { input_tokens: 2000 }, 'claude-haiku-5-5') as never);
    meter.observe(messageDelta(0, 'refusal') as never);
    meter.observe(messageStop() as never);
    expect(meter.usage().refusals).toBe(1);
    meter.observe({ type: 'system', subtype: 'model_refusal_no_fallback', original_model: 'claude-haiku-5-5', request_id: 'req_9', content: '', uuid: 'u9' } as never);
    expect(meter.usage().refusals).toBe(1);
    // A later refusal is a new one.
    meter.observe(messageStart('r2', { input_tokens: 2100 }, 'claude-haiku-5-5') as never);
    meter.observe(messageDelta(0, 'refusal') as never);
    expect(meter.usage().refusals).toBe(2);
  });

  it('remembers the API error on the session’s own messages, not a subagent’s, with its text', async () => {
    const { SessionMeter } = await import('./session.js');
    const meter = new SessionMeter();
    meter.observe(frame('s1', { input_tokens: 0, output_tokens: 0 }, { model: '<synthetic>', parent_tool_use_id: 'toolu_9', error: 'model_not_found' }) as never);
    expect(meter.apiError).toBeUndefined();
    meter.observe(frame('s2', { input_tokens: 0, output_tokens: 0 }, { model: '<synthetic>', error: 'billing_error', text: 'Credit balance is too low' }) as never);
    expect(meter.apiError).toBe('billing_error');
    expect(meter.apiErrorText).toBe('Credit balance is too low');
  });
});

describe('runSession and runSessionWithRetry metering', () => {
  beforeEach(() => {
    sdk.calls.length = 0;
    sdk.scripts.length = 0;
  });

  const success = (text = '[]') => ({
    type: 'result',
    subtype: 'success',
    result: text,
    num_turns: 3,
    stop_reason: 'end_turn',
    terminal_reason: 'completed',
    usage: { input_tokens: 300, output_tokens: 30, cache_read_input_tokens: 3000, cache_creation_input_tokens: 100 },
    modelUsage: { 'claude-sonnet-5': modelUsage(300, 30, 3000, 100, 4), 'claude-haiku-4-5-20251001': modelUsage(800, 50) },
  });

  it('asks for the raw stream to meter from, and keeps it out of the stored transcript', async () => {
    const { runSession } = await import('./session.js');
    sdk.scripts.push({ messages: [init(), ...streamedCall('m1', { input_tokens: 300, output_tokens: 30 }), success()] });
    const result = await runSession({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });
    expect(sdk.calls.at(-1)!.options.includePartialMessages).toBe(true);
    const lines = gunzipSync(result.transcript).toString().split('\n').map((l) => JSON.parse(l) as { type: string });
    // init, the call's two frames, the result: no stream events.
    expect(lines.map((l) => l.type)).toEqual(['system', 'assistant', 'assistant', 'result']);
  });

  it('throws a SessionRunError carrying the streamed usage, marked partial', async () => {
    const { runSession, SessionRunError } = await import('./session.js');
    sdk.scripts.push({
      messages: [init(), ...streamedCall('m1', { input_tokens: 500, output_tokens: 60, cache_read_input_tokens: 4000 })],
      throws: new Error('Connection closed mid-response'),
    });
    const err = await runSession({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionRunError);
    expect((err as InstanceType<typeof SessionRunError>).message).toBe('Connection closed mid-response');
    expect((err as InstanceType<typeof SessionRunError>).usage).toMatchObject({
      input_tokens: 500,
      // The final count from the stream, not the frames' placeholder.
      output_tokens: 60,
      cache_read_tokens: 4000,
      model: 'claude-sonnet-5',
      partial: true,
      by_model: { 'claude-sonnet-5-20260301': { input_tokens: 500, output_tokens: 60, cache_read_tokens: 4000 } },
    });
  });

  it('folds both attempts of a retried session, by_model included', async () => {
    const { runSessionWithRetry } = await import('./session.js');
    sdk.scripts.push(
      { messages: [init(), ...streamedCall('m1', { input_tokens: 500, output_tokens: 60 })], throws: new Error('overloaded') },
      { messages: [init(), ...streamedCall('m2', { input_tokens: 300, output_tokens: 30 }), success()] },
    );
    const result = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });
    expect(sdk.calls).toHaveLength(2);
    expect(result.succeeded).toBe(true);
    expect(result.usage).toEqual({
      input_tokens: 800,
      output_tokens: 90,
      cache_read_tokens: 3000,
      cache_write_tokens: 100,
      model: 'claude-sonnet-5',
      by_model: {
        'claude-sonnet-5-20260301': { input_tokens: 500, output_tokens: 60, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
        'claude-sonnet-5': { input_tokens: 300, output_tokens: 30, cache_read_tokens: 3000, cache_write_tokens: 100, web_search_requests: 4 },
        'claude-haiku-4-5-20251001': { input_tokens: 800, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
      },
      num_turns: 3,
      result_subtype: 'success',
      terminal_reason: 'completed',
      stop_reason: 'end_turn',
      refusals: 0,
      // The first attempt's side calls were never reported.
      partial: true,
    });
  });

  /** A session the API refuses for the key itself: the CLI reports the error, then exits non-zero. */
  const refused = (error: string, text = 'Credit balance is too low') => ({
    messages: [
      init(),
      frame('s1', { input_tokens: 0, output_tokens: 0 }, { model: '<synthetic>', error, text }),
      { type: 'result', subtype: 'success', is_error: true, result: text, num_turns: 1, stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {} },
    ],
    throws: new Error('Claude Code process exited with code 1'),
  });

  it('stops an organization-key session the key itself failed, with a reason staff can act on', async () => {
    const { runSessionWithRetry } = await import('./session.js');
    const { OrgKeyUnavailableError } = await import('./org-key.js');
    const cases: [string, string, RegExp][] = [
      ['authentication_failed', 'Invalid API key · Fix external API key', /rejected this organization's own API key/],
      ['billing_error', 'Credit balance is too low', /billing problem/],
      ['model_not_found', "There's an issue with the selected model (claude-sonnet-5). It may not exist or you may not have access to it.", /did not find the model this needs \(claude-sonnet-5\)/],
      ['oauth_org_not_allowed', 'OAuth not allowed', /does not allow this organization's own API key/],
      // The two the CLI reports as invalid_request, told apart by the frame's text.
      ['invalid_request', 'Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable', /has been disabled/],
      ['invalid_request', 'Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY and run /login to sign in with your claude.ai account', /turned off API key access/],
    ];
    for (const [error, text, reason] of cases) {
      sdk.calls.length = 0;
      sdk.scripts.push(refused(error, text), { messages: [success()] });
      const err = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false, apiKey: 'sk-ant-org-key' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OrgKeyUnavailableError);
      // One CLI start, not two.
      expect(sdk.calls).toHaveLength(1);
      sdk.scripts.length = 0;
      const message = (err as Error).message;
      expect(message).toMatch(reason);
      expect(message).toMatch(/organization's own API key/);
      expect(message).toMatch(/deployment's own key is never used/);
      expect(message).not.toMatch(/administrator/);
      expect(message).not.toContain('sk-ant-org-key');
      expect(message.length).toBeLessThanOrEqual(400);
    }
  });

  it('does not retry those errors on the deployment key either, and still retries transient ones', async () => {
    const { runSessionWithRetry } = await import('./session.js');
    sdk.scripts.push(refused('billing_error'), { messages: [success()] });
    const failed = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });
    expect(failed.succeeded).toBe(false);
    expect(failed.apiError).toBe('billing_error');
    expect(failed.apiErrorText).toBe('Credit balance is too low');
    expect(sdk.calls).toHaveLength(1);

    sdk.calls.length = 0;
    sdk.scripts.length = 0;
    sdk.scripts.push(refused('overloaded', 'Overloaded'), { messages: [success()] });
    const retried = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false, apiKey: 'sk-ant-org-key' });
    expect(retried.succeeded).toBe(true);
    expect(sdk.calls).toHaveLength(2);

    // An ordinary invalid request may be the session's own doing: retried once, as before.
    sdk.calls.length = 0;
    sdk.scripts.length = 0;
    sdk.scripts.push(refused('invalid_request', 'API Error: 400 messages: text content blocks must be non-empty'), { messages: [success()] });
    const invalid = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false, apiKey: 'sk-ant-org-key' });
    expect(invalid.succeeded).toBe(true);
    expect(sdk.calls).toHaveLength(2);
  });

  it('keeps the organization key out of the error text it hands back', async () => {
    const { runSessionWithRetry } = await import('./session.js');
    sdk.scripts.push(refused('billing_error', 'Credit balance is too low for sk-ant-org-key'));
    const failed = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false });
    // On the deployment key (no apiKey to redact) the text is as the CLI wrote it…
    expect(failed.apiErrorText).toContain('sk-ant-org-key');
    sdk.calls.length = 0;
    sdk.scripts.push(refused('rate_limit', 'Rate limited for sk-ant-org-key'), refused('rate_limit', 'Rate limited for sk-ant-org-key'));
    const limited = await runSessionWithRetry({ prompt: 'p', allowedTools: POLICY_SESSION_TOOLS, orchestrate: false, apiKey: 'sk-ant-org-key' });
    // …and on an organization's key, the key is redacted from it.
    expect(limited.apiErrorText).toBe('Rate limited for [redacted API key]');
  });
});

describe('submit_findings validation & deterministic computeScoring (P0.2)', () => {
  it('deterministically computes level_pct and scoring (fixing wrong LLM math or omitted scoring) and validates gates synchronously', async () => {
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const { validateAndScoreSubmittedFindings } = await import('./session.js');
    const cfg = defaultPortraitConfig('City of Santa Cruz', 'City limits');
    const year = new Date().getUTCFullYear() - 1;

    // Minimal submission omitting target/level_pct/scoring — computed deterministically!
    const minimal = {
      kind: 'indicator',
      indicator_slug: 'cost-burdened-renters',
      name: 'Renter households paying over 30% of income on housing',
      value: 54.0,
      unit: '%',
      year,
      source: 'ACS 2024',
      source_url: 'https://data.census.gov/table/ACSDP5Y2024.DP04',
      source_tier: 2,
      evidence: {
        snapshot_path: 'evidence/acs.png',
        text_path: 'evidence/acs.txt',
        captured_at: '2026-10-01T00:00:00Z',
      },
      confidence: 'high',
      geographic_scale: 'city',
    };

    const files: Record<string, string> = {
      'evidence/acs.txt': 'Table DP04: Gross rent 30% or more of household income: 54.0%',
    };
    const ok = await validateAndScoreSubmittedFindings(
      [minimal],
      { config: cfg, dimensionSlug: 'housing' },
      async (p) => files[p]!,
    );
    expect(ok.accepted).toBe(true);
    expect(ok.errors).toEqual([]);
    expect(ok.findings).toHaveLength(1);
    const scored = ok.findings[0]!;
    expect(scored.kind).toBe('indicator');
    if (scored.kind === 'indicator') {
      // housing.cost-burdened-renters has target 30, lower_is_better, scale 30 -> (54 - 30) / 30 * 100 = 80
      expect(scored.target).toBe(30);
      expect(scored.level_pct).toBe(80);
      expect(scored.scoring.threshold_ref).toBe('housing.cost-burdened-renters');
      expect(scored.scoring.worked_math).toContain('+80');
    }

    // Wrong LLM mental arithmetic is deterministically overwritten too!
    const wrongMath = {
      ...minimal,
      target: 30,
      level_pct: -999,
      scoring: { threshold_ref: 'housing.cost-burdened-renters', function: 'lower_is_better', inputs: { value: 54, target: 30 }, worked_math: 'hallucinated' },
    };
    const fixed = await validateAndScoreSubmittedFindings(
      [wrongMath],
      { config: cfg, dimensionSlug: 'housing' },
      async (p) => files[p]!,
    );
    expect(fixed.accepted).toBe(true);
    expect(fixed.findings[0]!.kind === 'indicator' && fixed.findings[0]!.level_pct).toBe(80);

    // Fails synchronously with concrete errors for home-page link, stale year, disallowed scale, and value_not_found.
    const bad = {
      ...minimal,
      value: 91.7,
      year: 2010,
      geographic_scale: 'national',
      source_url: 'https://www.cityofsantacruz.com/housing',
    };
    const rejected = await validateAndScoreSubmittedFindings(
      [bad],
      { config: cfg, dimensionSlug: 'housing' },
      async (p) => files[p]!,
    );
    expect(rejected.accepted).toBe(false);
    expect(rejected.errors).toHaveLength(1);
    const msgs = rejected.errors[0]!.errors.join('\n');
    expect(msgs).toContain('home_page_link');
    expect(msgs).toContain('recency_failed');
    expect(msgs).toContain('scale_failed');
    expect(msgs).toContain('value_not_found');
  });
});

describe('mcp__evidence__read_source & extraMcpServers hooks (P1.2)', () => {
  type RegisteredTool = {
    handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text: string }>;
    }>;
  };
  type McpServerWithTools = {
    instance?: { _registeredTools?: Record<string, RegisteredTool> };
  };

  function memoryStorage(): import('./storage.js').TenantStorage & {
    objects: Map<string, { body: Buffer; contentType: string }>;
  } {
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    return {
      objects,
      describe: () => 'memory:session-test',
      async put(storagePath, body, contentType) {
        if (objects.has(storagePath)) throw new Error(`evidence object already exists: ${storagePath}`);
        objects.set(storagePath, { body: Buffer.from(body), contentType });
        return storagePath;
      },
      async get(storagePath) {
        const obj = objects.get(storagePath);
        if (!obj) throw new Error(`ENOENT: ${storagePath}`);
        return obj.body;
      },
    };
  }

  beforeEach(() => {
    sdk.calls.length = 0;
    sdk.scripts.length = 0;
    sdk.inspect = undefined;
  });

  it('exposes read_source with query/page_range excerpting, shares SourceCache with capture_evidence, and blocks private IPs', async () => {
    const { runSession } = await import('./session.js');
    const { SourceCache } = await import('./source-cache.js');
    const { PDF_PAGE_BREAK } = await import('./text-extract.js');

    const storage = memoryStorage();
    const pages = Array.from({ length: 8 }, (_, idx) =>
      idx === 4
        ? 'Page 5 Table 2: Median rent burden in 2024 was 54.2% of renter households.'
        : `Page ${idx + 1} general context and methodology notes.`,
    );
    const pdfText = `Text of the PDF document\n\n${pages.join(PDF_PAGE_BREAK)}\n`;
    const render = vi.fn(async (url: string) => ({
      url,
      finalUrl: url,
      contentType: 'application/pdf',
      status: 200,
      capturedAt: '2026-11-24T12:00:00.000Z',
      pngBytes: Buffer.from('png-bytes'),
      pdfBytes: Buffer.from('%PDF-1.4 bytes'),
      readableText: pdfText,
    }));
    const sourceCache = new SourceCache({ render, now: () => new Date('2026-11-24T12:00:00Z') });

    const observed: Record<string, unknown> = {};
    sdk.inspect = async ({ options }) => {
      const servers = options.mcpServers as Record<string, McpServerWithTools>;
      const tools = servers.evidence?.instance?._registeredTools ?? {};
      expect(Object.keys(tools)).toEqual(
        expect.arrayContaining(['read_source', 'capture_evidence', 'submit_findings']),
      );

      // 1. First read_source call with page_range (public IP literal avoids live DNS while exercising real egress guard).
      const url = 'https://93.184.216.34/housing-element-2024.pdf';
      const firstRaw = await tools.read_source!.handler({ url, page_range: '5' }, {});
      observed.first = JSON.parse(firstRaw.content[0]!.text);

      // 2. Second read_source call with query hits SourceCache (no second render).
      const secondRaw = await tools.read_source!.handler({ url, query: '54.2% rent burden' }, {});
      observed.second = JSON.parse(secondRaw.content[0]!.text);

      // 3. capture_evidence on the same URL promotes from SourceCache without re-rendering!
      const captureRaw = await tools.capture_evidence!.handler({ url, check_value: 54.2 }, {});
      observed.capture = JSON.parse(captureRaw.content[0]!.text);

      // 4. Private IP is refused cleanly by egress guard inside read_source.
      const blockedRaw = await tools.read_source!.handler({ url: 'https://127.0.0.1/admin' }, {});
      observed.blocked = JSON.parse(blockedRaw.content[0]!.text);
    };

    const result = await runSession({
      prompt: 'Research housing.',
      allowedTools: [
        'WebSearch',
        'WebFetch',
        'mcp__evidence__read_source',
        'mcp__evidence__capture_evidence',
        'mcp__evidence__submit_findings',
      ],
      storage,
      sourceCache,
      orchestrate: false,
    });

    expect(result.succeeded).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(observed.first).toMatchObject({
      url: 'https://93.184.216.34/housing-element-2024.pdf',
      final_url: 'https://93.184.216.34/housing-element-2024.pdf',
      content_type: 'application/pdf',
      text_char_count: pdfText.length,
      cache_hit: false,
      truncated: true,
      pages_included: [5],
      total_pages: 8,
    });
    expect((observed.first as { excerpt: string }).excerpt).toContain('54.2%');
    expect(observed.second).toMatchObject({
      cache_hit: true,
      content_type: 'application/pdf',
    });
    expect((observed.second as { excerpt: string }).excerpt).toContain('54.2%');
    expect(observed.capture).toMatchObject({
      value_on_page: 'found',
    });
    expect((observed.capture as { snapshot_path: string }).snapshot_path).toMatch(/^evidence\/[0-9a-f]{16}\.png$/);
    expect(result.capturedSnapshotPaths).toContain((observed.capture as { snapshot_path: string }).snapshot_path);
    expect((observed.blocked as { error: string }).error).toMatch(/read_source failed:.*non-public/);
  });

  it('mounts read_source for region_context sessions even when storage is omitted', async () => {
    const { runSession } = await import('./session.js');
    const { SourceCache } = await import('./source-cache.js');
    const render = vi.fn(async (url: string) => ({
      url,
      finalUrl: url,
      contentType: 'text/html',
      status: 200,
      capturedAt: '2026-11-24T12:00:00.000Z',
      pngBytes: Buffer.from('png'),
      readableText: 'City of Santa Cruz population 62,956 (2020 Census).\n',
    }));
    const sourceCache = new SourceCache({ render });

    let toolNames: string[] = [];
    let readResult: Record<string, unknown> | undefined;
    sdk.inspect = async ({ options }) => {
      const servers = options.mcpServers as Record<string, McpServerWithTools>;
      const tools = servers.evidence?.instance?._registeredTools ?? {};
      toolNames = Object.keys(tools);
      const raw = await tools.read_source!.handler({ url: 'https://93.184.216.34/about' }, {});
      readResult = JSON.parse(raw.content[0]!.text);
    };

    const res = await runSession({
      prompt: 'Build region brief.',
      allowedTools: ['WebSearch', 'WebFetch', 'mcp__evidence__read_source'],
      sourceCache,
      orchestrate: false,
    });
    expect(res.succeeded).toBe(true);
    expect(toolNames).toEqual(['read_source']);
    expect(readResult).toMatchObject({
      cache_hit: false,
      truncated: false,
      excerpt: 'City of Santa Cruz population 62,956 (2020 Census).',
    });
  });

  it('merges extraMcpServers and extraAllowedTools while preserving tool containment', async () => {
    const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    const { runSession } = await import('./session.js');

    const civicServer = createSdkMcpServer({
      name: 'civic_data',
      version: '1.0.0',
      tools: [
        tool(
          'query_census_acs',
          'Query Census ACS table',
          { table: z.string() },
          async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ table: args.table }) }] }),
        ),
      ],
    });

    await runSession({
      prompt: 'Research with civic APIs.',
      allowedTools: ['WebSearch', 'WebFetch', 'mcp__evidence__read_source'],
      extraMcpServers: { civic_data: civicServer },
      extraAllowedTools: ['mcp__civic_data__query_census_acs', 'mcp__evidence__read_source', 'Read'],
      orchestrate: false,
    });

    const { options } = sdk.calls.at(-1)!;
    const servers = options.mcpServers as Record<string, unknown>;
    expect(Object.keys(servers).sort()).toEqual(['civic_data', 'evidence']);
    // Deduplicated, MCP tools kept out of built-in tools, Read still refused without archivedExhibits!
    expect(options.allowedTools).toEqual([
      'WebSearch',
      'WebFetch',
      'mcp__evidence__read_source',
      'mcp__civic_data__query_census_acs',
    ]);
    expect(options.tools).toEqual(['WebSearch', 'WebFetch']);
    expect(options.disallowedTools).toContain('Read');
    expect(options.disallowedTools).toContain('Bash');
  });
});

describe('P2.1 & P2.2 runtime governance: direct Anthropic dispatch, scout caps, synthesis recovery & semaphore', () => {
  beforeEach(() => {
    sdk.calls.length = 0;
    sdk.scripts.length = 0;
    sdk.inspect = undefined;
  });

  it('enforces SCOUT_MAX_TURNS = 8 on SCOUT_AGENT and sets CLAUDE_CODE_SUBAGENT_MODEL + CLI caps in env', async () => {
    const { runSession, SCOUT_MAX_TURNS } = await import('./session.js');
    expect(SCOUT_MAX_TURNS).toBe(8);
    await runSession({
      prompt: 'Research housing.',
      allowedTools: ['WebSearch', 'WebFetch'],
      model: 'claude-opus-5-5',
      scoutModel: 'claude-haiku-5-5',
    });
    const call = sdk.calls.at(-1)!;
    expect(call.options.agents).toMatchObject({
      'source-scout': { model: 'claude-haiku-5-5', maxTurns: 8 },
    });
    const env = call.options.env as Record<string, string>;
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-haiku-5-5');
    expect(env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION).toBe('8');
    expect(env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION).toBe('40');
  });

  it('runs direct: true Anthropic verifier/auditor sessions via Messages API without spawning the Claude Code CLI', async () => {
    const { runSession } = await import('./session.js');
    const create = vi.fn(async () => ({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"content_supported":"pass","verifier_note":"Verified directly"}' }],
      usage: { input_tokens: 450, output_tokens: 35, cache_read_input_tokens: 200 },
    }));

    const res = await runSession({
      prompt: 'Verify finding.',
      allowedTools: ['WebFetch', 'Read'],
      model: 'claude-opus-5-5',
      direct: true,
      archivedExhibits: { pdfExcerpt: Buffer.from('Verified figure: 42%') },
      anthropicClient: { messages: { create } },
    });

    // Zero CLI subprocess spawned!
    expect(sdk.calls).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.succeeded).toBe(true);
    expect(JSON.parse(res.resultText)).toEqual({
      content_supported: 'pass',
      verifier_note: 'Verified directly',
    });
    expect(res.usage.input_tokens).toBe(450);
    expect(res.usage.cache_read_tokens).toBe(200);
  });

  it('recovers from error_max_turns with a bounded 6-turn synthesis-only prompt instead of retrying 60 turns of web search', async () => {
    const { MAX_TURNS_RECOVERY_LIMIT, runSessionWithRetry } = await import('./session.js');
    expect(MAX_TURNS_RECOVERY_LIMIT).toBe(6);

    sdk.scripts.push(
      {
        messages: [
          { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
          {
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
              id: 'm1',
              model: 'claude-sonnet-5',
              content: [{ type: 'text', text: 'Gathered ACS DP04 figure: 54.0% cost-burdened renters (2024).' }],
              usage: { input_tokens: 1_000, output_tokens: 120 },
            },
          },
          {
            type: 'result',
            subtype: 'error_max_turns',
            terminal_reason: 'max_turns',
            num_turns: 60,
            stop_reason: 'end_turn',
            usage: { input_tokens: 1_000, output_tokens: 120 },
            modelUsage: {
              'claude-sonnet-5': { inputTokens: 1_000, outputTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 12 },
            },
          },
        ],
      },
      {
        messages: [
          { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
          {
            type: 'result',
            subtype: 'success',
            result: '[{"kind":"gap","indicator_slug":"cost-burdened-renters","reason":"Gathered 54.0% before turn limit","scales_tried":["city"],"searched_at":"2026-11-24T00:00:00Z"}]',
            num_turns: 2,
            stop_reason: 'end_turn',
            usage: { input_tokens: 400, output_tokens: 80 },
            modelUsage: {
              'claude-sonnet-5': { inputTokens: 400, outputTokens: 80, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 },
            },
          },
        ],
      },
    );

    const res = await runSessionWithRetry({
      prompt: 'Research housing indicators.',
      allowedTools: ['WebSearch', 'WebFetch', 'mcp__evidence__read_source', 'mcp__evidence__capture_evidence', 'mcp__evidence__submit_findings'],
      extraAllowedTools: ['mcp__civic_data__query_census_acs'],
      model: 'claude-sonnet-5',
      scoutModel: 'claude-haiku-5-5',
      maxTurns: 60,
    });

    expect(res.succeeded).toBe(true);
    expect(sdk.calls).toHaveLength(2);
    const recoveryCall = sdk.calls[1]!;
    // Bounded 6-turn synthesis-only recovery: no web search, no scouts, only submit_findings retained!
    expect(recoveryCall.options.maxTurns).toBe(6);
    expect(recoveryCall.options.tools).toEqual([]);
    expect(recoveryCall.options.allowedTools).toEqual(['mcp__evidence__submit_findings']);
    expect(recoveryCall.options).not.toHaveProperty('agents');
    expect(recoveryCall.prompt).toContain('Synthesis-only recovery');
    expect(recoveryCall.prompt).toContain('54.0% cost-burdened renters');
    // Token usage folded from both passes.
    expect(res.usage.input_tokens).toBe(1_400);
    expect(res.usage.output_tokens).toBe(200);
  });

  it('bounds concurrent runSession calls through the shared SessionSemaphore', async () => {
    const { runSession } = await import('./session.js');
    const { SessionSemaphore } = await import('./session-semaphore.js');
    const sem = new SessionSemaphore(2);
    let inFlight = 0;
    let peak = 0;

    sdk.inspect = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        runSession({
          prompt: 'Concurrent session',
          allowedTools: ['WebFetch'],
          orchestrate: false,
          semaphore: sem,
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(sem.activeCount).toBe(0);
  });
});
