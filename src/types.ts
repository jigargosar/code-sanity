// ============================================================================
// types.ts — shared graph data model
// ============================================================================
// The extractor produces FileGraph; the UI consumes FileGraph. Keep the shape
// minimal and additive — every field added here should earn its place by
// answering a question no other field does.
// ============================================================================

export type FunctionId = string;

export type FunctionKind = 'function' | 'method' | 'arrow' | 'expression';

export interface FunctionNode {
  id: FunctionId;
  name: string;
  // ── source location ─────────────────────────────────────────────────────
  startLine: number;
  endLine: number;
  // ── basic shape ─────────────────────────────────────────────────────────
  loc: number;
  argCount: number;
  localCount: number;       // local variable declarations inside the body
  cyclomatic: number;       // approximate; counts branching keywords + && || ??
  nestingDepth: number;     // max nesting depth of statements inside the body
  // ── purity heuristic ────────────────────────────────────────────────────
  // No proof — flagged "maybe pure" if function does not touch any
  // module-level non-function binding. Function calls are not considered.
  maybePure: boolean;
  // ── kind ────────────────────────────────────────────────────────────────
  kind: FunctionKind;
  exported: boolean;
}

export type EdgeKind = 'call' | 'state' | 'type';

export interface Edge {
  from: FunctionId;
  to: FunctionId;
  kind: EdgeKind;
  // weight reserved for future use (e.g. number of call sites between A and B)
  weight?: number;
}

export interface ModuleStateRef {
  name: string;
  readers: FunctionId[];   // functions that read this binding
  writers: FunctionId[];   // functions that write to this binding
}

export interface FileGraph {
  filePath: string;
  extractedAt: string;
  functions: FunctionNode[];
  edges: Edge[];
  // module-level non-function bindings — used to derive 'state' edges between
  // any two functions that both touch the same binding.
  moduleState: ModuleStateRef[];
}
