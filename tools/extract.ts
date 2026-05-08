// ============================================================================
// extract.ts — ts-morph file-graph extractor
// ============================================================================
// Reads one TypeScript/JavaScript file and produces a FileGraph: function
// nodes with per-function metrics, call edges, state edges (functions that
// touch the same module-level binding), and the module-state index.
//
// Heuristics, not proofs. Approximations are flagged in comments. The point
// of this extractor is to feed multiple imperfect signals to the UI; the user
// triangulates.
//
// Run: npm run extract
//   or: npx tsx tools/extract.ts <path-to-file.ts> [output.json]
// ============================================================================

import {
  Project,
  SyntaxKind,
  Node,
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
} from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {
  FileGraph,
  FunctionNode,
  FunctionId,
  Edge,
  ModuleStateRef,
} from '../src/types.ts';

// ── types internal to extraction ────────────────────────────────────────────

type Analyzable =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression;

interface FoundFunction {
  id: FunctionId;
  name: string;
  shortName: string;        // for class methods: just the method name
  node: Analyzable;
  kind: FunctionNode['kind'];
  exported: boolean;
  startLine: number;
  endLine: number;
}

const makeId = (name: string, line: number): FunctionId => `${name}@${line}`;

// ── discovery ───────────────────────────────────────────────────────────────

function collectFunctions(sf: SourceFile): FoundFunction[] {
  const found: FoundFunction[] = [];

  // top-level function declarations
  for (const fn of sf.getFunctions()) {
    const name = fn.getName() ?? '<anonymous>';
    const startLine = fn.getStartLineNumber();
    found.push({
      id: makeId(name, startLine),
      name,
      shortName: name,
      node: fn,
      kind: 'function',
      exported: fn.isExported(),
      startLine,
      endLine: fn.getEndLineNumber(),
    });
  }

  // class methods
  for (const cls of sf.getClasses()) {
    const className = cls.getName() ?? '<anonymous>';
    for (const m of cls.getMethods()) {
      const shortName = m.getName();
      const name = `${className}.${shortName}`;
      const startLine = m.getStartLineNumber();
      found.push({
        id: makeId(name, startLine),
        name,
        shortName,
        node: m,
        kind: 'method',
        exported: cls.isExported(),
        startLine,
        endLine: m.getEndLineNumber(),
      });
    }
  }

  // top-level arrow functions or function expressions assigned to a name
  for (const stmt of sf.getVariableStatements()) {
    const exported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const k = init.getKind();
      if (k !== SyntaxKind.ArrowFunction && k !== SyntaxKind.FunctionExpression) continue;
      const name = decl.getName();
      const startLine = init.getStartLineNumber();
      found.push({
        id: makeId(name, startLine),
        name,
        shortName: name,
        node: init as Analyzable,
        kind: k === SyntaxKind.ArrowFunction ? 'arrow' : 'expression',
        exported,
        startLine,
        endLine: init.getEndLineNumber(),
      });
    }
  }

  return found;
}

// ── per-function metrics ────────────────────────────────────────────────────

function getBody(fn: Analyzable): Node | undefined {
  return fn.getBody();
}

function countCyclomatic(body: Node): number {
  let count = 1;
  body.forEachDescendant((node) => {
    const k = node.getKind();
    if (
      k === SyntaxKind.IfStatement ||
      k === SyntaxKind.ForStatement ||
      k === SyntaxKind.ForInStatement ||
      k === SyntaxKind.ForOfStatement ||
      k === SyntaxKind.WhileStatement ||
      k === SyntaxKind.DoStatement ||
      k === SyntaxKind.CaseClause ||
      k === SyntaxKind.CatchClause ||
      k === SyntaxKind.ConditionalExpression
    ) {
      count++;
    } else if (k === SyntaxKind.BinaryExpression) {
      const op = node.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind();
      if (
        op === SyntaxKind.AmpersandAmpersandToken ||
        op === SyntaxKind.BarBarToken ||
        op === SyntaxKind.QuestionQuestionToken
      ) {
        count++;
      }
    }
  });
  return count;
}

function countNestingDepth(body: Node): number {
  let max = 0;
  function walk(node: Node, depth: number): void {
    if (depth > max) max = depth;
    const k = node.getKind();
    const incrementsDepth =
      k === SyntaxKind.IfStatement ||
      k === SyntaxKind.ForStatement ||
      k === SyntaxKind.ForInStatement ||
      k === SyntaxKind.ForOfStatement ||
      k === SyntaxKind.WhileStatement ||
      k === SyntaxKind.DoStatement ||
      k === SyntaxKind.SwitchStatement ||
      k === SyntaxKind.TryStatement;
    node.forEachChild((c) => walk(c, incrementsDepth ? depth + 1 : depth));
  }
  walk(body, 0);
  return max;
}

function countLocals(body: Node): number {
  let count = 0;
  body.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.VariableDeclaration) count++;
  });
  return count;
}

// ── call edges ──────────────────────────────────────────────────────────────
// v1 is identifier-name based: matches `foo()` and `obj.foo()` to any
// function in the file with that name. Cheap, lossy on overloads — good
// enough to see whether the graph shape is interesting before investing in
// type resolution. Member calls match by method short name only.

function findCallEdges(fn: FoundFunction, byShortName: Map<string, FoundFunction[]>): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const body = getBody(fn.node);
  if (!body) return edges;

  body.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = call.getExpression();
    let calleeName: string | undefined;
    if (expr.getKind() === SyntaxKind.Identifier) {
      calleeName = expr.getText();
    } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      calleeName = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    }
    if (!calleeName) return;
    const candidates = byShortName.get(calleeName);
    if (!candidates) return;
    for (const c of candidates) {
      if (c.id === fn.id) continue;
      const key = `${fn.id}->${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: fn.id, to: c.id, kind: 'call' });
    }
  });
  return edges;
}

// ── module bindings ─────────────────────────────────────────────────────────
// A "module binding" here is a top-level let/const/var that is NOT a function
// expression or arrow function. These are the candidates for stealth coupling.

function collectModuleBindings(sf: SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const stmt of sf.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      const isFn =
        init !== undefined &&
        (init.getKind() === SyntaxKind.ArrowFunction ||
          init.getKind() === SyntaxKind.FunctionExpression);
      if (!isFn) bindings.add(decl.getName());
    }
  }
  return bindings;
}

// ── state index + state edges ───────────────────────────────────────────────
// State edge between A and B = both A and B touch the same module-level
// binding. This is the layer that catches stealth coupling missed by call
// graphs. Read vs write distinction is by inspecting parent of the identifier
// reference — naive but works for `x = ...`, `x += ...`, etc.

function findStateRefs(
  functions: FoundFunction[],
  moduleBindings: Set<string>,
): { state: ModuleStateRef[]; edges: Edge[] } {
  const readers = new Map<string, Set<FunctionId>>();
  const writers = new Map<string, Set<FunctionId>>();

  const recordRead = (binding: string, fnId: FunctionId) => {
    let s = readers.get(binding);
    if (!s) { s = new Set(); readers.set(binding, s); }
    s.add(fnId);
  };
  const recordWrite = (binding: string, fnId: FunctionId) => {
    let s = writers.get(binding);
    if (!s) { s = new Set(); writers.set(binding, s); }
    s.add(fnId);
  };

  for (const fn of functions) {
    const body = getBody(fn.node);
    if (!body) continue;
    body.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.Identifier) return;
      const name = node.getText();
      if (!moduleBindings.has(name)) return;

      let isWrite = false;
      const parent = node.getParent();
      if (parent && parent.getKind() === SyntaxKind.BinaryExpression) {
        const bin = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
        const op = bin.getOperatorToken().getKind();
        const isAssignment =
          op === SyntaxKind.EqualsToken ||
          op === SyntaxKind.PlusEqualsToken ||
          op === SyntaxKind.MinusEqualsToken ||
          op === SyntaxKind.AsteriskEqualsToken ||
          op === SyntaxKind.SlashEqualsToken;
        if (isAssignment && bin.getLeft() === node) isWrite = true;
      }
      if (isWrite) recordWrite(name, fn.id);
      else recordRead(name, fn.id);
    });
  }

  // build moduleState index
  const state: ModuleStateRef[] = [];
  for (const name of moduleBindings) {
    state.push({
      name,
      readers: Array.from(readers.get(name) ?? []).sort(),
      writers: Array.from(writers.get(name) ?? []).sort(),
    });
  }

  // build state edges: pair of any two functions that both touch the same binding
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const ref of state) {
    const touchers = Array.from(new Set([...ref.readers, ...ref.writers])).sort();
    for (let i = 0; i < touchers.length; i++) {
      for (let j = i + 1; j < touchers.length; j++) {
        const a = touchers[i];
        const b = touchers[j];
        const key = `${a}~${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: a, to: b, kind: 'state' });
      }
    }
  }
  return { state, edges };
}

// ── purity heuristic ────────────────────────────────────────────────────────

function isMaybePure(fn: FoundFunction, moduleBindings: Set<string>): boolean {
  const body = getBody(fn.node);
  if (!body) return false;
  let touches = false;
  body.forEachDescendant((node) => {
    if (touches) return;
    if (node.getKind() !== SyntaxKind.Identifier) return;
    if (moduleBindings.has(node.getText())) touches = true;
  });
  return !touches;
}

// ── orchestration ───────────────────────────────────────────────────────────

function buildFileGraph(absPath: string): FileGraph {
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });
  const sf = project.addSourceFileAtPath(absPath);

  const found = collectFunctions(sf);

  const byShortName = new Map<string, FoundFunction[]>();
  for (const f of found) {
    let bucket = byShortName.get(f.shortName);
    if (!bucket) { bucket = []; byShortName.set(f.shortName, bucket); }
    bucket.push(f);
  }

  const moduleBindings = collectModuleBindings(sf);

  const functions: FunctionNode[] = found.map((f) => {
    const body = getBody(f.node);
    return {
      id: f.id,
      name: f.name,
      startLine: f.startLine,
      endLine: f.endLine,
      loc: f.endLine - f.startLine + 1,
      argCount: f.node.getParameters().length,
      localCount: body ? countLocals(body) : 0,
      cyclomatic: body ? countCyclomatic(body) : 1,
      nestingDepth: body ? countNestingDepth(body) : 0,
      maybePure: isMaybePure(f, moduleBindings),
      kind: f.kind,
      exported: f.exported,
    };
  });

  let edges: Edge[] = [];
  for (const f of found) edges = edges.concat(findCallEdges(f, byShortName));
  const { state, edges: stateEdges } = findStateRefs(found, moduleBindings);
  edges = edges.concat(stateEdges);

  return {
    filePath: absPath,
    extractedAt: new Date().toISOString(),
    functions,
    edges,
    moduleState: state,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(): void {
  const inputArg = process.argv[2];
  const outputArg = process.argv[3];

  if (!inputArg) {
    console.error('usage: tsx tools/extract.ts <input-file> [output-file]');
    console.error('       (default output: src/data/sample.json)');
    process.exit(1);
  }
  const absInput = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(absInput)) {
    console.error(`file not found: ${absInput}`);
    process.exit(1);
  }

  const graph = buildFileGraph(absInput);

  const outPath = path.resolve(process.cwd(), outputArg ?? 'src/data/sample.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));

  const callCount = graph.edges.filter((e) => e.kind === 'call').length;
  const stateCount = graph.edges.filter((e) => e.kind === 'state').length;
  console.log(
    `extracted ${graph.functions.length} functions · ${callCount} call · ${stateCount} state edges`,
  );
  console.log(`-> ${outPath}`);
}

main();
