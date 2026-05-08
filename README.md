# code-sanity

Structural sanity-check environment for a single source file. Treats a file as a multi-layer graph (calls, state, types) across multiple coordinated views, surfacing the disagreements between signals so any judgment about the file rests on triangulation rather than any one metric.

## Day 1 status

- ts-morph extractor producing `FileGraph` JSON
- Per-function metrics: loc, args, locals, cyclomatic, nesting, maybe-pure, kind, exported
- Edges: call (today) + state (functions touching the same module-level binding)
- Module state index with reader/writer split
- Minimal React app displays the data as three columns (functions / edges / module state)

React Flow canvas: next step.

## Setup

```
pnpm install
pnpm extract           # writes src/data/sample.json
pnpm dev               # opens at http://localhost:5173
```

To analyze a different file, either edit the `extract` script in `package.json`, or run directly:

```
pnpm exec tsx tools/extract.ts <path-to-file.ts> [output.json]
```

## Layout

```
src/
  types.ts             FileGraph / FunctionNode / Edge / ModuleStateRef
  App.tsx              UI
  data/sample.json     extractor output (overwritten by `pnpm extract`)
tools/
  extract.ts           ts-morph CLI extractor
samples/
  messy.ts             deliberately messy file for testing
```

## Stack

- Vite 6 + React 18 + TypeScript
- Tailwind CSS 4
- ts-morph (TypeScript AST)
- @xyflow/react (canvas — wired in next step)
