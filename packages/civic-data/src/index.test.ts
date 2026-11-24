import { describe, expect, it } from 'vitest';
import {
  CIVIC_DATA_MCP_SERVER_NAME,
  CIVIC_DATA_MCP_TOOL_NAMES,
  CIVIC_DATA_TOOL_NAMES,
  CivicDataError,
  DEFAULT_SOCRATA_DOMAINS,
  createCivicDataTools,
} from './index.js';

describe('@deep-fryer/civic-data barrel exports and error contract', () => {
  it('exports MCP server metadata, tool names, and factory cleanly', () => {
    expect(CIVIC_DATA_MCP_SERVER_NAME).toBe('civic_data');
    expect(CIVIC_DATA_TOOL_NAMES).toHaveLength(7);
    expect(CIVIC_DATA_MCP_TOOL_NAMES).toEqual(
      CIVIC_DATA_TOOL_NAMES.map((name) => `mcp__civic_data__${name}`),
    );
    expect(DEFAULT_SOCRATA_DOMAINS.length).toBeGreaterThan(0);
    expect(typeof createCivicDataTools).toBe('function');
  });

  it('preserves structured code, status, and url on CivicDataError', () => {
    const err = new CivicDataError('HTTP_ERROR', 'upstream failed', {
      status: 503,
      url: 'https://api.census.gov/data/2023/acs/acs5',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CivicDataError');
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.status).toBe(503);
    expect(err.url).toBe('https://api.census.gov/data/2023/acs/acs5');
    expect(err.message).toBe('upstream failed');
  });
});
