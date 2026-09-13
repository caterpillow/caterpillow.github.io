import type { FeatureMeta } from './codegen/features';

export const TABS = [
  { id: 'treap', label: 'Treap' },
  { id: 'ops', label: 'Operations' },
  { id: 'values', label: 'Values' },
  { id: 'style', label: 'Style' },
] as const;
export type TabId = typeof TABS[number]['id'];

// Group sections into navigable tabs instead of fixed-width columns.
export function settingsTab(feature: FeatureMeta): TabId {
  if (['signature', 'comments', 'template'].includes(feature.key)) return 'style';
  if (['key_type', 'size_option', 'persistent'].includes(feature.key)) return 'treap';
  if (['Pointer/Iterators', 'Wrapper'].includes(feature.section)) return 'treap';
  if (['Value/Aggregates', 'Lazy/Range Ops', 'Treap Beats'].includes(feature.section)) return 'values';
  if (['Style', 'Namespaces & Typedefs'].includes(feature.section)) return 'style';
  return 'ops';
}

export function clampRatio(ratio: number, extent: number) {
  const minimum = extent > 0 ? Math.min(0.45, Math.min(160, Math.max(96, extent * 0.2)) / Math.max(1, extent - 12)) : 0.2;
  return Math.max(minimum, Math.min(1 - minimum, Number.isFinite(ratio) ? ratio : 0.5));
}

export interface DiffLine {
  kind: 'equal' | 'add' | 'remove';
  text: string;
  oldText?: string;
  oldLine?: number;
  newLine?: number;
}

// Compute line-by-line diff.
export function diffLines(previous: string, current: string): DiffLine[] {
  const oldLines = previous ? previous.split('\n') : [];
  const newLines = current ? current.split('\n') : [];
  // Compare trimmed keys to ignore whitespace-only changes without discarding duplicate lines.
  const oldKeys = oldLines.map(line => line.trim());
  const newKeys = newLines.map(line => line.trim());
  const result: DiffLine[] = [];
  const equal = (i: number, j: number) => result.push({ kind: 'equal', text: newLines[j], oldText: oldLines[i], oldLine: i + 1, newLine: j + 1 });
  // Find lines that were added and highlight them green.
  const add = (j: number) => result.push({ kind: 'add', text: newLines[j], newLine: j + 1 });
  // Find lines that were removed, preserving their old source positions.
  const remove = (i: number) => result.push({ kind: 'remove', text: oldLines[i], oldLine: i + 1 });

  function compare(a: number, b: number, c: number, d: number, depth = 0) {
    while (a < b && c < d && oldKeys[a] === newKeys[c]) equal(a++, c++);
    let suffix = 0;
    while (a < b - suffix && c < d - suffix && oldKeys[b - suffix - 1] === newKeys[d - suffix - 1]) suffix++;
    const endOld = b - suffix, endNew = d - suffix;
    const n = endOld - a, m = endNew - c;
    if (n && m && (n + 1) * (m + 1) <= 250_000) {
      const width = m + 1;
      const lcs = new Uint16Array((n + 1) * width);
      for (let i = n - 1; i >= 0; --i) for (let j = m - 1; j >= 0; --j) {
        lcs[i * width + j] = oldKeys[a + i] === newKeys[c + j] ? 1 + lcs[(i + 1) * width + j + 1] : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (oldKeys[a + i] === newKeys[c + j]) equal(a + i++, c + j++);
        // Render removed text as its own row, never as red highlighting on an unrelated new line.
        else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) remove(a + i++);
        else add(c + j++);
      }
      while (i < n) remove(a + i++);
      while (j < m) add(c + j++);
    } else if (n && m && depth < 8) {
      // Anchor larger changes before comparing their gaps, keeping memory bounded on mobile.
      const unique = (keys: string[], start: number, end: number) => {
        const positions = new Map<string, number>();
        for (let i = start; i < end; ++i) positions.set(keys[i], positions.has(keys[i]) ? -1 : i);
        return positions;
      };
      const left = unique(oldKeys, a, endOld), right = unique(newKeys, c, endNew);
      const pairs: [number, number][] = [];
      for (const [text, i] of left) if (i >= 0 && (right.get(text) ?? -1) >= 0) pairs.push([i, right.get(text)!]);
      const tails: number[] = [], links = new Int32Array(pairs.length).fill(-1);
      for (let i = 0; i < pairs.length; ++i) {
        let lo = 0, hi = tails.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1;
          else hi = mid;
        }
        if (lo) links[i] = tails[lo - 1];
        tails[lo] = i;
      }
      const anchors: [number, number][] = [];
      for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = links[i]) anchors.push(pairs[i]);
      anchors.reverse();
      // Keep repeated lines in order rather than treating source lines as an unordered set.
      if (anchors.length) {
        let i = a, j = c;
        for (const [x, y] of anchors) { compare(i, x, j, y, depth + 1); equal(x, y); i = x + 1; j = y + 1; }
        compare(i, endOld, j, endNew, depth + 1);
      } else {
        for (let i = a; i < endOld; ++i) remove(i);
        for (let j = c; j < endNew; ++j) add(j);
      }
    } else {
      // Keep deleted trailing lines after the last matching source line.
      for (let i = a; i < endOld; ++i) remove(i);
      for (let j = c; j < endNew; ++j) add(j);
    }
    // Matching suffixes retain both old and new line numbers.
    for (let i = 0; i < suffix; ++i) equal(endOld + i, endNew + i);
  }
  compare(0, oldLines.length, 0, newLines.length);
  return result;
}

export type TokenKind = 'text' | 'keyword' | 'type' | 'string' | 'number' | 'comment' | 'preprocessor' | 'function';
export interface Token { text: string; kind: TokenKind }
const keywords = new Set('auto class struct template typename using namespace const constexpr static if else while for return new delete nullptr true false operator friend public private protected inline noexcept throw try catch default case switch break continue do sizeof decltype alignas static_assert this virtual override final requires concept volatile unsigned signed'.split(' '));
const types = new Set('int long double float bool char void short wchar_t size_t ptrdiff_t uintmax_t nullptr_t ll ptr strong_ptr'.split(' '));

export function highlightCpp(source: string): Token[][] {
  const lines: Token[][] = [[]];
  const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|(?:u8|u|U|L)?R"([^()\\\s]{0,16})\([\s\S]*?\)\1"|(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"|(?:u8|u|U|L)?'(?:\\[\s\S]|[^'\\])*'|#[^\n]*|\b(?:0[xX][\da-fA-F']+|0[bB][01']+|\d[\d']*(?:\.\d[\d']*)?(?:[eE][+-]?\d+)?)[uUlLfF]*\b|\b[A-Za-z_]\w*\b/g;
  const append = (text: string, kind: TokenKind) => {
    const pieces = text.split('\n');
    pieces.forEach((piece, i) => {
      if (i) lines.push([]);
      if (piece) lines[lines.length - 1].push({ text: piece, kind });
    });
  };
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index!, text = match[0];
    append(source.slice(end, start), 'text');
    let kind: TokenKind = 'text';
    if (text.startsWith('//') || text.startsWith('/*')) kind = 'comment';
    else if (text.startsWith('#')) kind = 'preprocessor';
    else if (/^(?:(?:u8|u|U|L)?R?"|(?:u8|u|U|L)?')/.test(text)) kind = 'string';
    else if (/^\d/.test(text)) kind = 'number';
    else if (keywords.has(text)) kind = 'keyword';
    else if (types.has(text) || /^[A-Z]/.test(text)) kind = 'type';
    else if (/^\s*\(/.test(source.slice(start + text.length))) kind = 'function';
    append(text, kind);
    end = start + text.length;
  }
  append(source.slice(end), 'text');
  return lines;
}
