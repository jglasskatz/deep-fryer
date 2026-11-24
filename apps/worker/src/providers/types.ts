import { z } from 'zod';
import type { ResearchProvider, SessionTokenUsage } from '@deep-fryer/core';

/**
 * Provider-agnostic tool execution & runtime types for non-Anthropic research
 * and verification sessions (OpenAI Chat Completions, Google Gemini).
 *
 * Bridges local tool handlers (`read_source`, `capture_evidence`,
 * `submit_findings`, `@deep-fryer/civic-data` connectors, and read-only
 * `read_exhibit` for verifiers) into each provider's native function-calling
 * schema so every model runs with the exact same deterministic tool surface.
 */

export interface ProviderToolDefinition {
  /** Tool name exposed to the model (letters, digits, underscores, hyphens). */
  name: string;
  description: string;
  /** Standard JSON Schema object for the tool's input arguments. */
  parameters: Record<string, unknown>;
  /** Execute the tool with parsed object arguments and return a string result (usually JSON). */
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface OpenAiToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Convert a Zod schema (Zod v4) into a clean JSON Schema object suitable for
 * OpenAI tool definitions, OpenAI `response_format`, and Gemini schemas.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const cleaned = { ...raw };
  delete cleaned.$schema;
  return cleaned;
}

const GEMINI_SUPPORTED_STRING_FORMATS = new Set(['enum', 'date-time']);

/**
 * Sanitize a standard JSON Schema into the subset accepted by Google Gemini's
 * `functionDeclarations[].parameters` and `generationConfig.responseSchema`.
 *
 * Strips `$schema`, `additionalProperties`, `default`, `propertyNames`,
 * `$defs`/`definitions`, and unsupported string formats; collapses simple
 * nullable `anyOf`/`oneOf` unions into `{ ...inner, nullable: true }`.
 */
export function sanitizeSchemaForGemini(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { type: 'object', properties: {} };
  }
  const src = node as Record<string, unknown>;

  // Handle anyOf / oneOf unions (e.g., nullable fields or string|number unions).
  const union = Array.isArray(src.anyOf) ? src.anyOf : Array.isArray(src.oneOf) ? src.oneOf : null;
  if (union && union.length > 0) {
    const nonNull = union.filter(
      (item) => !(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'null'),
    );
    const hasNull = nonNull.length < union.length;
    if (nonNull.length === 1) {
      const inner = sanitizeSchemaForGemini(nonNull[0]);
      if (hasNull) inner.nullable = true;
      if (typeof src.description === 'string' && !inner.description) inner.description = src.description;
      return inner;
    }
    // Multi-type primitive union (e.g. string | number or string | string[]):
    // Gemini Schema does not support arbitrary `anyOf` cleanly on all versions;
    // prefer string (which accepts serialized representations) or first object.
    const objectBranch = nonNull.find(
      (item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'object',
    );
    if (objectBranch) {
      const inner = sanitizeSchemaForGemini(objectBranch);
      if (hasNull) inner.nullable = true;
      if (typeof src.description === 'string' && !inner.description) inner.description = src.description;
      return inner;
    }
    return {
      type: 'string',
      ...(typeof src.description === 'string' ? { description: src.description } : {}),
      ...(hasNull ? { nullable: true } : {}),
    };
  }

  const out: Record<string, unknown> = {};

  if (typeof src.type === 'string') {
    out.type = src.type;
  } else if (Array.isArray(src.type)) {
    const nonNullTypes = src.type.filter((t) => t !== 'null');
    out.type = typeof nonNullTypes[0] === 'string' ? nonNullTypes[0] : 'string';
    if (nonNullTypes.length < src.type.length) out.nullable = true;
  }

  if (typeof src.description === 'string') out.description = src.description;
  if (typeof src.nullable === 'boolean') out.nullable = src.nullable;
  if (Array.isArray(src.enum)) {
    out.enum = src.enum.map((v) => String(v));
    if (!out.type) out.type = 'string';
  }
  if (src.const !== undefined) {
    out.enum = [String(src.const)];
    if (!out.type) out.type = 'string';
  }
  if (typeof src.format === 'string' && GEMINI_SUPPORTED_STRING_FORMATS.has(src.format)) {
    out.format = src.format;
  }
  if (typeof src.minimum === 'number') out.minimum = src.minimum;
  if (typeof src.maximum === 'number') out.maximum = src.maximum;
  if (typeof src.minItems === 'number') out.minItems = src.minItems;
  if (typeof src.maxItems === 'number') out.maxItems = src.maxItems;

  if (src.type === 'array' || src.items !== undefined) {
    out.type = 'array';
    out.items = src.items ? sanitizeSchemaForGemini(src.items) : { type: 'string' };
  }

  if (src.type === 'object' || (src.properties && typeof src.properties === 'object')) {
    out.type = 'object';
    const props: Record<string, unknown> = {};
    if (src.properties && typeof src.properties === 'object') {
      for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
        props[k] = sanitizeSchemaForGemini(v);
      }
    }
    // Gemini rejects `type: 'object'` with completely empty `properties` on some models
    // when used inside responseSchema; for generic record objects (e.g. submit_findings
    // items), leave properties omitted when empty so Gemini accepts arbitrary JSON objects.
    if (Object.keys(props).length > 0) {
      out.properties = props;
    }
    if (Array.isArray(src.required) && src.required.length > 0 && Object.keys(props).length > 0) {
      const validReq = src.required.filter((r): r is string => typeof r === 'string' && r in props);
      if (validReq.length > 0) out.required = validReq;
    }
  }

  if (!out.type) out.type = 'string';
  return out;
}

/**
 * Deterministic local tool registry bridging worker tools (civic-data,
 * read_source, capture_evidence, submit_findings, read_exhibit) into
 * OpenAI and Google Gemini function-calling loops.
 */
export class ToolExecutor {
  private readonly tools = new Map<string, ProviderToolDefinition>();

  constructor(definitions: readonly ProviderToolDefinition[] = []) {
    for (const def of definitions) {
      this.tools.set(def.name, def);
    }
  }

  get size(): number {
    return this.tools.size;
  }

  list(): ProviderToolDefinition[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  toOpenAiTools(): OpenAiToolSpec[] {
    return this.list().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  toGeminiFunctionDeclarations(): GeminiFunctionDeclaration[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForGemini(t.parameters),
    }));
  }

  async execute(name: string, rawArgs: unknown): Promise<{ output: string; isError: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        output: JSON.stringify({ error: `Tool "${name}" is not available in this session.` }),
        isError: true,
      };
    }

    let parsedArgs: Record<string, unknown>;
    if (typeof rawArgs === 'string') {
      try {
        const parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {};
        parsedArgs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      } catch (err) {
        return {
          output: JSON.stringify({
            error: `Invalid JSON arguments for tool "${name}": ${err instanceof Error ? err.message : String(err)}`,
          }),
          isError: true,
        };
      }
    } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      parsedArgs = rawArgs as Record<string, unknown>;
    } else {
      parsedArgs = {};
    }

    try {
      const output = await tool.execute(parsedArgs);
      return { output, isError: false };
    } catch (err) {
      return {
        output: JSON.stringify({
          error: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
        isError: true,
      };
    }
  }
}

export interface ProviderSessionInput {
  provider?: ResearchProvider;
  model: string;
  prompt: string;
  systemPrompt?: string;
  apiKey?: string | null;
  /** True when `apiKey` belongs to the organization (never send to custom base URLs; throw OrgKeyUnavailableError on key rejection). */
  isOrganizationKey?: boolean;
  maxTurns: number;
  tools?: ToolExecutor;
  /** Optional custom API base URL (ignored when `isOrganizationKey` is true). */
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Optional structured JSON schema contract for single-shot or final-answer output. */
  responseJsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface ProviderSessionOutput {
  resultText: string;
  transcriptLines: string[];
  usage: SessionTokenUsage;
  succeeded: boolean;
  apiError?: string;
  apiErrorText?: string;
}

export interface ProviderStructuredMessageInput<T> {
  provider?: ResearchProvider;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  apiKey?: string | null;
  isOrganizationKey?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  baseUrl?: string;
  fetch?: FetchLike;
}

export type ProviderStructuredMessageResult<T> =
  | { ok: true; data: T; rawText: string; model: string; usage: SessionTokenUsage }
  | { ok: false; error: string; rawText?: string; model: string; usage: SessionTokenUsage };

/** Parse strict JSON from raw text or a single fenced ```json block. */
export function parseStrictJsonText(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: false, error: 'Model returned empty text' };

  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function redactProviderSecret(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted API key]');
}
