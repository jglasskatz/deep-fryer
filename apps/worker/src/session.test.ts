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
const sdk = vi.hoisted(() => ({ calls: [] as { prompt: string; options: Record<string, unknown> }[] }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn((args: { prompt: string; options: Record<string, unknown> }) => {
    sdk.calls.push(args);
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 2 } };
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
});

describe('sessionEnv', () => {
  it('passes the model client configuration and proxy settings, nothing else', async () => {
    const { sessionEnv } = await import('./session.js');
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
      no_proxy: 'localhost',
    });
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
    });
  });

  it('leaves the environment as it was without one', async () => {
    const { sessionEnv } = await import('./session.js');
    expect(sessionEnv(deployment, {})).toEqual(deployment);
    expect(sessionEnv(deployment, { apiKey: '' })).toEqual(deployment);
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
      summary: 's',
      impacts: [],
    });
    expect(extractJson('Here it is:\n```json\n{"a":"has } and ] inside"}\n```\nDone.')).toEqual({ a: 'has } and ] inside' });
    expect(extractJson('[{"kind":"gap"}] trailing words')).toEqual([{ kind: 'gap' }]);
  });

  it('skips bracketed prose when the caller wants an object', async () => {
    const { extractJson } = await import('./session.js');
    const text = 'The [3] largest effects are below.\n{"summary":"s"}';
    expect(extractJson(text)).toEqual([3]);
    expect(extractJson(text, { kind: 'object' })).toEqual({ summary: 's' });
  });

  it('prefers a fenced block, and throws when there is no JSON at all', async () => {
    const { extractJson } = await import('./session.js');
    expect(extractJson('{not json} then ```json\n{"x":1}\n```')).toEqual({ x: 1 });
    expect(() => extractJson('I could not assess this policy.')).toThrow(/no JSON/);
    expect(() => extractJson('{"unterminated": ')).toThrow(/no JSON/);
  });
});
