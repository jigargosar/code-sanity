# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Structural sanity-check tool for a *single* source file (not a project, not a module — one file). Treats the file as a multi-layer graph (calls, state, types) and surfaces *disagreements between signals* so judgments rest on triangulation rather than any one metric. Heuristics, not proofs — the point of the extractor is to feed multiple imperfect signals to the UI; the user triangulates.

The motivating insight (see `docs/conversations/initial.md`): graph view of a single file should never be the *output* of analysis — it should be an *input device* (point at things, get answers as text/numbers). Decomposition shuffles mass between nodes and edges; a refactor that lowers LOC may raise edge weight. There is no single coupling number.

## Commands

Package manager is **pnpm** (`pnpm-workspace.yaml` is present).

1. `pnpm install` — install deps.
2. `pnpm extract` — run extractor on `samples/messy.ts`, write `src/data/sample.json`. The UI imports this JSON statically, so re-extraction + page reload is the dev loop.
3. `pnpm dev` — Vite dev server (default http://localhost:5173).
4. `pnpm build` — `tsc -b && vite build`. Use this as the type-check + build gate; there is no separate `lint` or `test` script.
5. `pnpm preview` — serve the production build.
6. `pnpm exec tsx tools/extract.ts <input.ts> [output.json]` — extract any file. Output defaults to `src/data/sample.json` (which is what the UI reads).

There is no test runner configured. There is no separate lint step — TypeScript strict mode via `tsc -b` is the only static check.

## Architecture

The system is a one-way pipeline; understanding the seam is essential before editing either side.

```
source file  ──►  tools/extract.ts  ──►  src/data/sample.json  ──►  src/App.tsx
                  (Node, ts-morph)       (FileGraph JSON)            (React UI, read-only)
```

1. **`src/types.ts` is the contract.** `FileGraph` is the only shape that crosses the seam between extractor and UI. Both sides import from it. When adding a new signal, the change starts here. The file's own comment is the rule: *every field added here should earn its place by answering a question no other field does.*

2. **`tools/extract.ts` runs in Node (via `tsx`), not in the browser.** It uses `ts-morph` to walk the AST of one input file. It is structured as discovery → per-function metrics → call edges → module-state index → state edges → orchestration. The extractor never imports browser code, never reads `src/App.tsx`. Do not blur this boundary.

3. **`src/App.tsx` is read-only over `FileGraph`.** It does no analysis — every metric, every edge, every reader/writer set is computed in the extractor and shipped via JSON. The UI's job is to *present* the graph from multiple angles (the "tab registry" at the top of `App.tsx` enumerates them: Lists, Graph, Matrix, Treemap, Heatmap — only Lists is built today). Adding a view = adding a tab entry + a component that consumes `FileGraph`. If a view needs a new derived field, derive it in the extractor, not in the component.

4. **Edge kinds are `'call' | 'state' | 'type'`** (`type` not yet emitted). State edges connect any two functions that both touch the same module-level non-function binding — this is the layer that catches stealth coupling missed by call graphs. Read vs write distinction is by inspecting the parent of the identifier reference (assignment LHS = write, anything else = read).

5. **Extractor heuristics are deliberately lossy.**
   1. Call edges match on identifier short-name (so `obj.foo()` matches any in-file function named `foo`). Lossy on overloads — good enough to see graph shape before investing in type resolution.
   2. `maybePure` flags a function that doesn't reference any module-level non-function binding *directly*. Transitive impurity through callees is **not** tracked — a function whose body calls `bumpCounter()` is flagged pure even though `bumpCounter` writes module state. Direct-touch purity is a feature of the heuristic, not a bug to silently fix; tightening it changes what the flag means.
   3. `cyclomatic` counts branching keywords + `&&`/`||`/`??`. Approximate.
   4. When tightening a heuristic, document the assumption in a comment near it (existing code does this); don't silently change semantics.

6. **`src/data/sample.json` is committed.** The UI imports it via `import rawData from './data/sample.json'` and casts to `FileGraph`. This makes the dev loop "edit extractor → `pnpm extract` → reload" rather than "wire a runtime fetch." Don't replace this with a fetch unless there's a reason.

7. **TypeScript project references**: `tsconfig.json` is a solution file; the real configs are `tsconfig.app.json` (covers `src/`, JSX, DOM lib) and `tsconfig.node.json` (covers `vite.config.ts` and `tools/**`). The extractor's TS settings live in `tsconfig.node.json`, not `tsconfig.app.json`.

## Stack

Vite 6, React 18, TypeScript 5.6 strict, Tailwind CSS 4 (via `@tailwindcss/vite`, imported with `@import "tailwindcss"` in `src/index.css` — no `tailwind.config.js`), ts-morph 24, `@xyflow/react` 12 (installed for the planned Graph tab; not yet used).

## Conventions specific to this repo

1. The `FileGraph` is treated like a small wire format. New fields must be additive; renames break the extractor/UI contract silently because the UI casts the JSON.
2. The tab registry in `App.tsx` (`TABS` array + `TabId` union) is the one place to declare a new view. Toggle `built: true` only when the tab actually renders something.
3. Function IDs are `name@startLine` (see `makeId` in `tools/extract.ts`). Methods are `Class.method@line`. The UI's `shortId` helper strips the `@line` suffix for display only — never for identity.
4. Comments in this codebase explain *why* a heuristic is approximate or *what* a section is responsible for. Match that tone — don't add WHAT-comments.
5. **`samples/messy.ts` is the canary.** Its named groups (A pipeline, B mutual recursion, C isolated utility, D shared-state-no-call group, E god function, F dead function) are wired so each extractor signal lights up at least one group. The thesis-validating moment specifically: `bumpCounter` / `resetCounter` / `readCounter` have **zero call edges between them** but **are coupled through `counter`** via state edges. Any rewrite that breaks this contrast breaks the demo of why the tool exists. Keep this in mind before "simplifying" the fixture or the state-edge logic.

## Roadmap and constraints

This section captures direction set across the design conversation in `docs/conversations/initial.md`. It is not a phase plan — pick the next move based on what's missing in practice. But the *constraints* in §"Layout constraints" below are hard and should not be relitigated without explicit input from the user.

### What's done
1. ts-morph extractor: per-fn metrics, call edges, state edges, module-state index with reader/writer split, direct-touch purity flag.
2. React/Vite shell with the tab registry and a Lists view (3-column readout: functions / edges / module state).

### What's open, roughly in payoff order
1. **Graph view** — React Flow canvas, code-order vertical lane (Y bound to source line, X user-draggable), edges as bezier curves. Click a node → highlight transitive callers in one hue, transitive callees in another, with depth gradient. Sidebar shows the selected fn's metrics. This is the smallest move that converts the current JSON-viewer into the exploration tool the project was built for.
2. **Layer toggle** — show/hide call vs state vs type edges independently. The diagnostic moment is watching apparently-isolated groups merge into one component as state layer turns on. This is the differentiator vs. every existing call-graph tool.
3. **Type-touch edges** — third edge kind, already declared in `EdgeKind` (`'type'`) but not yet emitted. Walks function bodies via the ts-morph type checker and records type/symbol references.
4. **Matrix / DSM view** — rows × columns of functions, cells shaded by edge presence/strength, reordered to surface diagonal blocks. Hairball-immune by construction; the right family for dense graphs.
5. **Treemap view** — area = LOC, color = fan-in or fan-out. "Where is the mass and is it where the coupling is too?" in one chart.
6. **Composite smell score** — rank-sum across metrics (LOC, cyclomatic, locals, args, fan-in, fan-out, purity); color the top decile. Multiple imperfect signals combined; the user's "every metric is a smell, multiple polls beat one" framing.
7. **Articulation points** (Tarjan) — facade discovery, ~10 lines on top of the call graph. Highlight nodes whose removal disconnects a component.
8. **Cycle highlighting** (Tarjan SCC) — call cycles are usually abstraction-boundary smells; isEven/isOdd in `samples/messy.ts` is the canary.
9. **Pin-aware layouts** — pinned nodes are positional constraints that survive view switches. Every layout algorithm added must honor pins.
10. **Series contraction** — collapse trivial A→B→C chains (B with in-degree 1, out-degree 1) into a glyph, expandable on click.
11. **Counterfactual / API-surface delta** — select a subset of functions, compute what the extracted module's import list and original file's public surface become.
12. **AI-generated report** — bolt-on consumer of the same `FileGraph`; ranks candidates by composite smell.

### Layout constraints
1. **No force-directed layout.** A small change destabilizes the whole graph; the user has explicitly rejected this. Code-order vertical lane is the default.
2. **Pinning must survive view switches.** Don't add a layout algorithm that can't accept pinned nodes as positional constraints.
3. **Cap visual channels at two per node** (e.g. area + color, or border + fill). Beyond two, the view becomes unreadable. Push everything else to the sidebar.
4. **Don't pre-commit to phased plans the user didn't author.** Recommend the next move based on the current state of the tool, not a roadmap pretending to be a schedule. The list above is a parking lot, not a sequence.
