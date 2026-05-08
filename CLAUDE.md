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
   2. `maybePure` flags a function that doesn't reference any module-level non-function binding. Function calls are *not* considered. It's a "maybe" — no proof.
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
