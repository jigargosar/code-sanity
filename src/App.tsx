import { useState } from 'react';
import rawData from './data/sample.json';
import type { FileGraph, Edge } from './types';

const graph = rawData as unknown as FileGraph;

// ── tiny helpers ────────────────────────────────────────────────────────────
const shortId = (id: string) => id.split('@')[0];

function edgeLabel(e: Edge): string {
  if (e.kind === 'state') return e.stateAccess === 'write' ? 'WRITE' : 'READ';
  return e.kind.toUpperCase();
}

function edgeColor(e: Edge): string {
  if (e.kind === 'call')  return 'text-blue-600';
  if (e.kind === 'type')  return 'text-emerald-600';
  // state: write is red, read is amber
  return e.stateAccess === 'write' ? 'text-red-600' : 'text-amber-600';
}

// ── tab registry ────────────────────────────────────────────────────────────
// Each entry is one analysis lens over the same underlying FileGraph.
// Add new tabs here as they're built; toggle `built` when wiring them up.
type TabId = 'lists' | 'graph' | 'matrix' | 'treemap' | 'heatmap';

const TABS: { id: TabId; label: string; built: boolean }[] = [
  { id: 'lists',   label: 'Lists',   built: true  },
  { id: 'graph',   label: 'Graph',   built: false },
  { id: 'matrix',  label: 'Matrix',  built: false },
  { id: 'treemap', label: 'Treemap', built: false },
  { id: 'heatmap', label: 'Heatmap', built: false },
];

// ── Lists view (existing 3-column readout, unchanged) ───────────────────────
function ListsView() {
  const hasData = graph.functions.length > 0;

  if (!hasData) {
    return (
      <div className="bg-white border border-gray-200 rounded p-6 text-sm text-gray-600">
        No data yet. Run{' '}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs">
          pnpm extract
        </code>{' '}
        and refresh.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Functions */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
          Functions
        </h2>
        <ul className="space-y-1">
          {graph.functions.map((fn) => (
            <li key={fn.id} className="bg-white rounded px-3 py-2 border border-gray-200">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{fn.name}</span>
                <span className="text-xs text-gray-400 font-mono">L{fn.startLine}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1 font-mono">
                loc {fn.loc} · args {fn.argCount} · locals {fn.localCount} · cc {fn.cyclomatic} · nest {fn.nestingDepth}
                {fn.maybePure && <span className="ml-2 text-emerald-600">pure?</span>}
                {fn.exported && <span className="ml-2 text-gray-400">exported</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Edges */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
          Edges
        </h2>
        <ul className="space-y-1">
          {graph.edges.map((e, i) => (
            <li
              key={`${e.from}-${e.to}-${e.kind}-${i}`}
              className="bg-white rounded px-3 py-2 border border-gray-200 font-mono text-sm"
            >
              <span className={`text-xs font-medium mr-2 ${edgeColor(e)}`}>
                {edgeLabel(e)}
              </span>
              <span>{shortId(e.from)}</span>
              <span className="text-gray-400 mx-2">→</span>
              <span>{e.kind === 'state' ? e.to : shortId(e.to)}</span>
            </li>
          ))}
          {graph.edges.length === 0 && (
            <li className="text-xs text-gray-400 px-3">No edges.</li>
          )}
        </ul>
      </section>

      {/* Module state */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
          Module state
        </h2>
        <ul className="space-y-1">
          {graph.moduleState.map((s) => (
            <li key={s.name} className="bg-white rounded px-3 py-2 border border-gray-200">
              <div className="font-mono text-sm">{s.name}</div>
              <div className="text-xs text-gray-500 mt-1 font-mono">
                readers: {s.readers.length === 0 ? '—' : s.readers.map(shortId).join(', ')}
              </div>
              <div className="text-xs text-gray-500 font-mono">
                writers: {s.writers.length === 0 ? '—' : s.writers.map(shortId).join(', ')}
              </div>
            </li>
          ))}
          {graph.moduleState.length === 0 && (
            <li className="text-xs text-gray-400 px-3">No module-level bindings.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

// ── Placeholder for unbuilt analyses ────────────────────────────────────────
function PlaceholderView({ name }: { name: string }) {
  return (
    <div className="bg-white border border-gray-200 border-dashed rounded p-12 text-center">
      <p className="text-sm font-medium text-gray-700 mb-1">{name}</p>
      <p className="text-xs text-gray-400">Not built yet.</p>
    </div>
  );
}

// ── App shell ───────────────────────────────────────────────────────────────
export function App() {
  const [active, setActive] = useState<TabId>('lists');
  const callCount  = graph.edges.filter((e) => e.kind === 'call').length;
  const stateCount = graph.edges.filter((e) => e.kind === 'state').length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-8 pt-8 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">code-sanity</h1>
        <p className="text-xs text-gray-500 mt-1 font-mono break-all">{graph.filePath}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {graph.functions.length} functions · {callCount} call · {stateCount} state · {graph.moduleState.length} bindings
        </p>
      </header>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <nav className="px-8 border-b border-gray-200 bg-white">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const isActive = t.id === active;
            const cls = isActive
              ? 'border-blue-600 text-blue-600'
              : t.built
                ? 'border-transparent text-gray-600 hover:text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600';
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setActive(t.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${cls}`}
                >
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <main className="p-8">
        {active === 'lists'   && <ListsView />}
        {active === 'graph'   && <PlaceholderView name="Graph" />}
        {active === 'matrix'  && <PlaceholderView name="Matrix" />}
        {active === 'treemap' && <PlaceholderView name="Treemap" />}
        {active === 'heatmap' && <PlaceholderView name="Heatmap" />}
      </main>
    </div>
  );
}
