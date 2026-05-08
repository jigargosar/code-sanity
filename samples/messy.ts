// samples/messy.ts
// Deliberately messy file for testing code-sanity extraction.
// Designed to exercise every extractor signal:
//  - chained pipeline with single facade (Group A)
//  - mutual recursion / cycle (Group B)
//  - isolated pure utility (Group C)
//  - shared-state group: no call edges between them but coupled via state (D)
//  - god function calling many things (Group E)
//  - dead function with no callers (Group F)

let counter = 0;
let lastSeen: string | null = null;

// === Group A: chained pipeline ===
function fetchData(url: string): string {
  if (url.startsWith('http')) {
    return `data-from-${url}`;
  }
  return '';
}

function parseData(raw: string): string[] {
  return raw.split('-').map((s) => s.trim());
}

function transformData(parts: string[]): string[] {
  const result: string[] = [];
  for (const p of parts) {
    if (p.length > 2) {
      result.push(p.toUpperCase());
    }
  }
  return result;
}

function pipeline(url: string): string[] {
  const raw = fetchData(url);
  const parts = parseData(raw);
  return transformData(parts);
}

// === Group B: mutual recursion (cycle) ===
function isEven(n: number): boolean {
  if (n === 0) return true;
  return isOdd(n - 1);
}

function isOdd(n: number): boolean {
  if (n === 0) return false;
  return isEven(n - 1);
}

// === Group C: isolated pure utility ===
function addOne(x: number): number {
  return x + 1;
}

// === Group D: shared-state group, no call edges between them ===
function bumpCounter(): void {
  counter += 1;
}

function resetCounter(): void {
  counter = 0;
}

function readCounter(): number {
  return counter;
}

function recordSeen(s: string): void {
  lastSeen = s;
}

// === Group E: god function calling many things ===
function doEverything(): void {
  bumpCounter();
  recordSeen('start');
  const x = addOne(readCounter());
  const result = pipeline('http://example.com');
  if (isEven(x) && result.length > 0) {
    resetCounter();
  } else if (isOdd(x) || result.length === 0) {
    bumpCounter();
  }
  for (let i = 0; i < x; i++) {
    if (i % 2 === 0) {
      bumpCounter();
    }
  }
}

// === Group F: dead function (no callers in this file) ===
function unusedHelper(s: string): string {
  return s.toLowerCase();
}

export { doEverything, unusedHelper };
