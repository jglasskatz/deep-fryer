/**
 * Architecture data for deep-fryer.
 *
 * Generated following the architecture-visualizer skill schema at
 * /Users/joe/Dev/architecture-visualizer/. Re-run after major topology
 * changes (new packages, new layers, new external services wired up).
 */

export interface LayerConfig {
  label: string;
  subtitle: string;
  color: string;
  iconPath: string;
}

export interface ConnectionTypeConfig {
  label: string;
  dash: string;
}

export interface NodeDetails {
  fileCount: number;
  linesOfCode: string;
  language: string;
  keyFiles: string[];
  keyFunctionality: string[];
}

export interface ArchitectureNode {
  id: string;
  label: string;
  layer: string;
  iconPath: string;
  tech: string;
  description: string;
  details: NodeDetails;
}

export interface Connection {
  from: string;
  to: string;
  type: keyof typeof CONNECTION_TYPES;
  label: string;
}

const ICONS = {
  monitor: 'M2 3h20v14H2V3zm2 2v10h16V5H4zm-1 14h18v2H3v-2z',
  server: 'M2 2h20v6H2V2zm0 8h20v6H2v-6zm0 8h20v4H2v-4zm3-14h2v2H5V4zm0 8h2v2H5v-2z',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  database: 'M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 2c4.42 0 8 1.34 8 3s-3.58 3-8 3-8-1.34-8-3 3.58-3 8-3zM4 9.26C5.81 10.36 8.78 11 12 11s6.19-.64 8-1.74V12c0 1.66-3.58 3-8 3s-8-1.34-8-3V9.26zM4 14.26C5.81 15.36 8.78 16 12 16s6.19-.64 8-1.74V18c0 1.66-3.58 3-8 3s-8-1.34-8-3v-3.74z',
  cloud: 'M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  code: 'M8 3l-6 9 6 9M16 3l6 9-6 9',
  zap: 'M13 2L3 14h9l-1 10 10-12h-9l1-10z',
  globe: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  settings:
    'M12 15.5A3.5 3.5 0 1012 8.5a3.5 3.5 0 000 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65z',
};

export const LAYER_ORDER = ['frontend', 'core', 'database', 'data', 'external'] as const;

export const LAYER_CONFIG: Record<string, LayerConfig> = {
  frontend: {
    label: 'Frontend',
    subtitle: 'Next.js 15 · React 19 · Tailwind v4',
    color: '#00AFF0',
    iconPath: ICONS.monitor,
  },
  core: {
    label: 'Core',
    subtitle: 'Shared types · Zod · Scoring',
    color: '#10B981',
    iconPath: ICONS.layers,
  },
  database: {
    label: 'Database',
    subtitle: 'Drizzle schema (not yet wired)',
    color: '#A78BFA',
    iconPath: ICONS.database,
  },
  data: {
    label: 'Data',
    subtitle: 'Mock data · Seed defaults',
    color: '#3B82F6',
    iconPath: ICONS.code,
  },
  external: {
    label: 'External (planned)',
    subtitle: 'Supabase · Anthropic · Vercel',
    color: '#F43F5E',
    iconPath: ICONS.cloud,
  },
};

export const CONNECTION_TYPES = {
  uses: { label: 'Uses', dash: 'none' },
  reads: { label: 'Reads', dash: 'none' },
  renders: { label: 'Renders', dash: 'none' },
  links: { label: 'Links to', dash: '6 3' },
  hosts: { label: 'Hosts', dash: '3 3' },
  authn: { label: 'Auth', dash: '3 3' },
  planned: { label: 'Planned', dash: '2 4' },
} as const satisfies Record<string, ConnectionTypeConfig>;

export const ARCHITECTURE_NODES: ArchitectureNode[] = [
  // --- frontend ---
  {
    id: 'fe-layout',
    label: 'Root Layout',
    layer: 'frontend',
    iconPath: ICONS.monitor,
    tech: 'Next.js · RSC',
    description:
      'Top-level App Router layout. Loads Inter font, Tailwind globals, and wraps every route.',
    details: {
      fileCount: 1,
      linesOfCode: '~20',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/app/layout.tsx', 'apps/web/app/globals.css'],
      keyFunctionality: ['Sets <html>/<body> shell', 'Imports global styles', 'Loads Inter font'],
    },
  },
  {
    id: 'fe-landing',
    label: 'Landing',
    layer: 'frontend',
    iconPath: ICONS.globe,
    tech: 'Server Component',
    description: 'Marketing landing page with a link into the demo tenant.',
    details: {
      fileCount: 1,
      linesOfCode: '~30',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/app/page.tsx'],
      keyFunctionality: ['Product intro', 'Links to /santacruz demo'],
    },
  },
  {
    id: 'fe-tenant-viewer',
    label: 'Tenant Viewer',
    layer: 'frontend',
    iconPath: ICONS.monitor,
    tech: 'Server Component',
    description:
      'Public-facing tenant route at /[tenant]. Currently reads mock data and renders the Doughnut chart. Will switch to Supabase reads in M1.',
    details: {
      fileCount: 1,
      linesOfCode: '~45',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/app/[tenant]/page.tsx'],
      keyFunctionality: [
        'Resolves tenant from URL',
        'Splits dimensions by ring',
        'Mounts <Doughnut>',
      ],
    },
  },
  {
    id: 'fe-doughnut',
    label: 'Doughnut Viz',
    layer: 'frontend',
    iconPath: ICONS.zap,
    tech: 'Client Component · D3',
    description:
      'Interactive D3-rendered doughnut chart, ported from doughnut-santa-cruz. Handles segment hover/select, tooltips, and color-coded shortfall/overshoot bars.',
    details: {
      fileCount: 1,
      linesOfCode: '~300',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/components/doughnut/Doughnut.tsx'],
      keyFunctionality: [
        'Renders concentric SVG rings',
        'Maps viz_level → arc radius + color',
        'Hover tooltips · click-to-select',
      ],
    },
  },
  {
    id: 'fe-admin-stub',
    label: 'Admin (stub)',
    layer: 'frontend',
    iconPath: ICONS.settings,
    tech: 'Placeholder',
    description:
      'Stub for the auth-gated tenant admin. Real implementation lands in M1 with Supabase OAuth + the draft/publish UI.',
    details: {
      fileCount: 1,
      linesOfCode: '~15',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/app/[tenant]/admin/page.tsx'],
      keyFunctionality: ['Placeholder copy', 'Auth integration pending'],
    },
  },
  {
    id: 'fe-embed-stub',
    label: 'Embed (stub)',
    layer: 'frontend',
    iconPath: ICONS.globe,
    tech: 'Placeholder',
    description:
      'Stub for the stripped-chrome embed view. M2 adds the iframe-friendly route + embed.js loader + CSP allowlist.',
    details: {
      fileCount: 1,
      linesOfCode: '~10',
      language: 'TypeScript (TSX)',
      keyFiles: ['apps/web/app/embed/[tenant]/page.tsx'],
      keyFunctionality: ['Placeholder route', 'postMessage protocol pending'],
    },
  },

  // --- core ---
  {
    id: 'core-types',
    label: 'Domain Types',
    layer: 'core',
    iconPath: ICONS.code,
    tech: 'TypeScript',
    description:
      'Shared types for tenants, dimensions, indicators, outreach contacts. Mirrors the DIMENSION DATA SHAPE jsonb in SPEC.md §5.',
    details: {
      fileCount: 1,
      linesOfCode: '~60',
      language: 'TypeScript',
      keyFiles: ['packages/core/src/types.ts'],
      keyFunctionality: ['DimensionData, Indicator, Ring, Role enums'],
    },
  },
  {
    id: 'core-validators',
    label: 'Validators',
    layer: 'core',
    iconPath: ICONS.code,
    tech: 'Zod',
    description:
      'Zod schemas matching every shared type. Used by the future API to validate writes from the admin UI and the AI research agent.',
    details: {
      fileCount: 1,
      linesOfCode: '~50',
      language: 'TypeScript',
      keyFiles: ['packages/core/src/validators.ts'],
      keyFunctionality: ['Zod parse for DimensionData', 'OutreachContact validators'],
    },
  },
  {
    id: 'core-scoring',
    label: 'viz_level Deriver',
    layer: 'core',
    iconPath: ICONS.zap,
    tech: 'Pure function',
    description:
      'Maps the rich shortfall_pct / overshoot_pct indicator data to a single -100..150 viz value the D3 chart consumes.',
    details: {
      fileCount: 1,
      linesOfCode: '~20',
      language: 'TypeScript',
      keyFiles: ['packages/core/src/scoring.ts'],
      keyFunctionality: ['deriveVizLevel(ring, data)'],
    },
  },
  {
    id: 'core-defaults',
    label: 'Framework Defaults',
    layer: 'core',
    iconPath: ICONS.layers,
    tech: 'Constant',
    description:
      'The canonical 12 social + 9 ecological dimensions seeded for every new tenant.',
    details: {
      fileCount: 1,
      linesOfCode: '~160',
      language: 'TypeScript',
      keyFiles: ['packages/core/src/framework-defaults.ts'],
      keyFunctionality: [
        'Social[] and Ecological[] arrays',
        'Slug, canonical_slug, name, icon per dimension',
      ],
    },
  },

  // --- database ---
  {
    id: 'db-schema',
    label: 'Drizzle Schema',
    layer: 'database',
    iconPath: ICONS.database,
    tech: 'Drizzle ORM · Postgres',
    description:
      'Full multi-tenant schema: tenants, members, dimensions, versions, outreach contacts, custom pages, audit log. Defined; not yet migrated.',
    details: {
      fileCount: 1,
      linesOfCode: '~260',
      language: 'TypeScript',
      keyFiles: ['packages/db/src/schema.ts'],
      keyFunctionality: ['9 tables', 'Versioned editing pattern', 'pgEnums for ring/role/status'],
    },
  },
  {
    id: 'db-client',
    label: 'DB Client',
    layer: 'database',
    iconPath: ICONS.server,
    tech: 'postgres-js',
    description:
      'Drizzle client factory. Throws lazily on first use if DATABASE_URL is unset, so the app boots without a DB during dev.',
    details: {
      fileCount: 1,
      linesOfCode: '~30',
      language: 'TypeScript',
      keyFiles: ['packages/db/src/client.ts'],
      keyFunctionality: ['Lazy DB connection', 'Re-exports drizzle helpers'],
    },
  },

  // --- data ---
  {
    id: 'data-mock',
    label: 'Mock Tenant Data',
    layer: 'data',
    iconPath: ICONS.code,
    tech: 'Static fixture',
    description:
      'Hardcoded Santa Cruz tenant with 21 dimensions. Replaced by Supabase reads in M1; kept for offline dev.',
    details: {
      fileCount: 1,
      linesOfCode: '~50',
      language: 'TypeScript',
      keyFiles: ['apps/web/lib/mock-data.ts'],
      keyFunctionality: ['12 social + 9 ecological dims', 'viz_level only (no rich indicators)'],
    },
  },
  {
    id: 'data-create-tenant',
    label: 'create-tenant CLI',
    layer: 'data',
    iconPath: ICONS.zap,
    tech: 'tsx · CLI',
    description:
      'Stub for the manual-provisioning CLI. Will insert a tenant row + seeded dimensions + published versions once Supabase is wired.',
    details: {
      fileCount: 1,
      linesOfCode: '~40',
      language: 'TypeScript',
      keyFiles: ['scripts/create-tenant.ts'],
      keyFunctionality: ['Arg parsing', 'Throws not-implemented (M1)'],
    },
  },

  // --- external ---
  {
    id: 'ext-vercel',
    label: 'Vercel',
    layer: 'external',
    iconPath: ICONS.cloud,
    tech: 'Hosting',
    description: 'Hosts the Next.js app. First production deploy pending.',
    details: {
      fileCount: 0,
      linesOfCode: 'External',
      language: '—',
      keyFiles: ['docs/deploy.md'],
      keyFunctionality: ['App hosting', 'CDN', 'Build pipeline'],
    },
  },
  {
    id: 'ext-supabase',
    label: 'Supabase',
    layer: 'external',
    iconPath: ICONS.database,
    tech: 'Postgres · Auth · Storage',
    description:
      'Planned source of truth for tenant data, Google OAuth, RLS isolation, and source-document storage. Not yet provisioned.',
    details: {
      fileCount: 0,
      linesOfCode: 'External',
      language: '—',
      keyFiles: ['.env.example'],
      keyFunctionality: ['Postgres host', 'Google OAuth', 'Storage buckets', 'RLS policies'],
    },
  },
  {
    id: 'ext-anthropic',
    label: 'Anthropic',
    layer: 'external',
    iconPath: ICONS.zap,
    tech: 'Claude API',
    description:
      'Powers the planned AI research agent (M4) that drafts indicator data for newly provisioned tenants.',
    details: {
      fileCount: 0,
      linesOfCode: 'External',
      language: '—',
      keyFiles: ['.env.example'],
      keyFunctionality: ['Research agent', 'Future MCP server consumer'],
    },
  },
];

export const CONNECTIONS: Connection[] = [
  // Frontend graph
  { from: 'fe-landing', to: 'fe-tenant-viewer', type: 'links', label: '/santacruz' },
  { from: 'fe-tenant-viewer', to: 'fe-doughnut', type: 'renders', label: '<Doughnut>' },
  { from: 'fe-tenant-viewer', to: 'data-mock', type: 'reads', label: 'mockTenant' },
  { from: 'fe-doughnut', to: 'core-types', type: 'uses', label: 'Ring · DimensionData' },
  { from: 'fe-layout', to: 'fe-landing', type: 'renders', label: 'children' },
  { from: 'fe-layout', to: 'fe-tenant-viewer', type: 'renders', label: 'children' },

  // Core graph
  { from: 'core-validators', to: 'core-types', type: 'uses', label: 'z.infer<>' },
  { from: 'core-scoring', to: 'core-types', type: 'uses', label: 'Ring · DimensionData' },
  { from: 'core-defaults', to: 'core-types', type: 'uses', label: 'Ring' },

  // Database graph
  { from: 'db-schema', to: 'core-types', type: 'uses', label: '$type<DimensionData>()' },
  { from: 'db-client', to: 'db-schema', type: 'uses', label: 'drizzle(schema)' },

  // Data + CLI
  { from: 'data-mock', to: 'core-types', type: 'uses', label: 'Ring' },
  { from: 'data-create-tenant', to: 'db-client', type: 'planned', label: 'M1: insert tenant' },
  { from: 'data-create-tenant', to: 'core-defaults', type: 'planned', label: 'M1: seed dimensions' },

  // External (planned)
  { from: 'ext-vercel', to: 'fe-layout', type: 'hosts', label: 'apps/web/.next' },
  { from: 'db-client', to: 'ext-supabase', type: 'planned', label: 'M1: DATABASE_URL' },
  { from: 'fe-admin-stub', to: 'ext-supabase', type: 'planned', label: 'M1: Google OAuth' },
  { from: 'data-create-tenant', to: 'ext-anthropic', type: 'planned', label: 'M4: research agent' },
];
