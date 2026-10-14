import { notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import {
  ARCHITECTURE_NODES,
  CONNECTIONS,
  CONNECTION_TYPES,
  LAYER_CONFIG,
  LAYER_ORDER,
  type ArchitectureNode,
  type Connection,
} from './architecture-data';

export const metadata = {
  title: 'Architecture (internal)',
  robots: { index: false },
};

function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function NodeIcon({ path, color }: { path: string; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={color} aria-hidden>
      <path d={path} />
    </svg>
  );
}

function NodeCard({ node, color }: { node: ArchitectureNode; color: string }) {
  return (
    <article
      className="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md"
      style={{ borderColor: hexToRgba(color, 0.35) }}
    >
      <header className="flex items-center gap-2">
        <NodeIcon path={node.iconPath} color={color} />
        <h3 className="font-semibold text-[15px] leading-tight">{node.label}</h3>
      </header>
      <p className="mt-1 text-xs uppercase tracking-wide" style={{ color }}>
        {node.tech}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-muted)]">{node.description}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="uppercase tracking-wide text-[color:var(--color-muted)]">Files</dt>
          <dd className="font-mono">{node.details.fileCount || '—'}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-[color:var(--color-muted)]">LOC</dt>
          <dd className="font-mono">{node.details.linesOfCode}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-[color:var(--color-muted)]">Lang</dt>
          <dd className="font-mono truncate">{node.details.language}</dd>
        </div>
      </dl>
      {node.details.keyFiles.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] font-mono text-[color:var(--color-muted)]">
          {node.details.keyFiles.map((f) => (
            <li key={f} className="truncate">
              {f}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function LayerSection({ layerKey }: { layerKey: string }) {
  const layer = LAYER_CONFIG[layerKey];
  const nodes = ARCHITECTURE_NODES.filter((n) => n.layer === layerKey);
  if (!layer || nodes.length === 0) return null;

  return (
    <section className="mt-10">
      <header
        className="flex items-center gap-3 border-l-4 pl-3"
        style={{ borderColor: layer.color }}
      >
        <NodeIcon path={layer.iconPath} color={layer.color} />
        <div>
          <h2 className="text-xl font-bold">{layer.label}</h2>
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
            {layer.subtitle} · {nodes.length} node{nodes.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <NodeCard key={node.id} node={node} color={layer.color} />
        ))}
      </div>
    </section>
  );
}

function ConnectionRow({
  conn,
  nodesById,
}: {
  conn: Connection;
  nodesById: Record<string, ArchitectureNode>;
}) {
  const fromNode = nodesById[conn.from];
  const toNode = nodesById[conn.to];
  const fromLayer = fromNode && LAYER_CONFIG[fromNode.layer];
  const toLayer = toNode && LAYER_CONFIG[toNode.layer];
  if (!fromNode || !toNode || !fromLayer || !toLayer) return null;
  const typeMeta = CONNECTION_TYPES[conn.type];
  const fromColor = fromLayer.color;
  const toColor = toLayer.color;
  const isPlanned = conn.type === 'planned';

  return (
    <li className="flex items-center gap-2 py-2 text-sm">
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs"
        style={{ background: hexToRgba(fromColor, 0.12), color: fromColor }}
      >
        {fromNode.label}
      </span>
      <span
        className={`text-xs uppercase tracking-wider ${isPlanned ? 'text-[color:var(--color-muted)] italic' : ''}`}
      >
        {typeMeta.label}
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs"
        style={{ background: hexToRgba(toColor, 0.12), color: toColor }}
      >
        {toNode.label}
      </span>
      <span className="ml-2 font-mono text-xs text-[color:var(--color-muted)] truncate">
        {conn.label}
      </span>
    </li>
  );
}

export default async function ArchitecturePage() {
  // Internal M0-era diagram; staff only. The canonical, verified map is
  // architecture/data.ts at the repo root (keel verify).
  const auth = await getAuth();
  if (!auth.isStaff) notFound();

  const nodesById = Object.fromEntries(ARCHITECTURE_NODES.map((n) => [n.id, n]));
  const totalNodes = ARCHITECTURE_NODES.length;
  const totalConns = CONNECTIONS.length;
  const plannedConns = CONNECTIONS.filter((c) => c.type === 'planned').length;

  return (
    <>
      <SiteHeader variant="architecture" />
      <main id="main" className="mx-auto max-w-6xl px-6 py-12">
        <header>
          <h1 className="text-3xl font-bold">Architecture</h1>
        <p className="mt-3 max-w-2xl text-[color:var(--color-muted)]">
          System map for the deep-fryer monorepo. Generated following the{' '}
          <code className="rounded bg-black/5 px-1 py-0.5 text-xs">architecture-visualizer</code>{' '}
          skill schema. Regenerate after major topology changes.
        </p>
        <dl className="mt-6 flex flex-wrap gap-6 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Nodes
            </dt>
            <dd className="font-mono text-xl">{totalNodes}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Connections
            </dt>
            <dd className="font-mono text-xl">{totalConns}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Planned
            </dt>
            <dd className="font-mono text-xl">{plannedConns}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Layers
            </dt>
            <dd className="font-mono text-xl">{LAYER_ORDER.length}</dd>
          </div>
        </dl>
      </header>

      {LAYER_ORDER.map((key) => (
        <LayerSection key={key} layerKey={key} />
      ))}

      <section className="mt-12">
        <h2 className="text-xl font-bold">Connections</h2>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Live edges in italics are planned (not yet wired up).
        </p>
        <ul className="mt-4 divide-y rounded-lg border bg-white px-4">
          {CONNECTIONS.map((c) => (
            <ConnectionRow key={`${c.from}->${c.to}:${c.type}`} conn={c} nodesById={nodesById} />
          ))}
        </ul>
      </section>

      <footer className="mt-12 border-t pt-6 text-xs text-[color:var(--color-muted)]">
        Source of truth:{' '}
        <code className="font-mono">apps/web/app/architecture/architecture-data.ts</code>
      </footer>
    </main>
    </>
  );
}
