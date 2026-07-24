import {
  extractSectionBodies,
  normalizeSectionBody,
} from './sections';

export type DiffLineOp = 'eq' | 'add' | 'del';

export type DiffPartOp = 'eq' | 'add' | 'del';

export interface DiffPart {
  op: DiffPartOp;
  text: string;
}

export interface DiffLine {
  op: DiffLineOp;
  text: string;
  /** 1-based line in from body; omitted for pure adds */
  oldLine?: number;
  /** 1-based line in to body; omitted for pure deletes */
  newLine?: number;
  /** Inline segments for paired change lines; omit = whole line same as op */
  parts?: DiffPart[];
}

export type SectionChangeKind = 'unchanged' | 'changed' | 'added' | 'removed';

export interface SectionCompareItem {
  id: string;
  title: string;
  kind: SectionChangeKind;
  lines: DiffLine[];
}

export type CompareMode = 'unified' | 'sideBySide';

export interface ChapterCompareResult {
  from: string;
  to: string;
  mode: CompareMode;
  sections: SectionCompareItem[];
}

interface SectionSlice {
  id: string;
  title: string;
  body: string;
}

/** Skip inline diff when token DP would be too large. */
const INLINE_TOKEN_PRODUCT_LIMIT = 250_000;
/** Absorb eq islands this short when between edits (recall-first). */
const SHORT_EQ_MAX_CHARS = 2;

function collectSlices(markdown: string): SectionSlice[] {
  const { intro, sections } = extractSectionBodies(markdown);
  const out: SectionSlice[] = [];
  if (intro != null && intro.length > 0) {
    out.push({ id: '_intro', title: '引言', body: normalizeSectionBody(intro) });
  }
  for (const s of sections) {
    out.push({
      id: s.id,
      title: s.title,
      body: normalizeSectionBody(s.body),
    });
  }
  return out;
}

/**
 * Hybrid tokenize: letter runs and digit runs as separate tokens (so `xxxx1234`
 * → `xxxx`+`1234`); whitespace/punct as tokens; other code points (CJK) one each.
 */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z_]/.test(s[j]!)) j++;
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[0-9]/.test(s[j]!)) j++;
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    // ASCII punctuation as single-char tokens; non-ASCII (CJK) via code points
    if (ch.charCodeAt(0) < 128) {
      out.push(ch);
      i += 1;
    } else {
      const cp = Array.from(s.slice(i))[0]!;
      out.push(cp);
      i += cp.length;
    }
  }
  return out;
}

function lcsOps(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ op: 'eq', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ op: 'del', text: a[i]! });
      i++;
    } else {
      raw.push({ op: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    raw.push({ op: 'del', text: a[i]! });
    i++;
  }
  while (j < m) {
    raw.push({ op: 'add', text: b[j]! });
    j++;
  }
  return mergeAdjacentParts(raw);
}

function mergeAdjacentParts(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.op === p.op) last.text += p.text;
    else out.push({ op: p.op, text: p.text });
  }
  return out;
}

/**
 * Recall-first: fold short eq islands between edits into surrounding edits
 * so tiny matches (`,` / single letter) do not fragment change blocks.
 */
export function cleanupShortEq(parts: DiffPart[]): DiffPart[] {
  if (parts.length === 0) return parts;
  const next = parts.map((p) => ({ ...p }));
  for (let i = 0; i < next.length; i++) {
    const p = next[i]!;
    if (p.op !== 'eq' || p.text.length > SHORT_EQ_MAX_CHARS) continue;
    const prev = i > 0 ? next[i - 1] : undefined;
    const following = i + 1 < next.length ? next[i + 1] : undefined;
    const prevEdit = prev && prev.op !== 'eq';
    const nextEdit = following && following.op !== 'eq';
    if (!prevEdit || !nextEdit) continue;
    // Only fold when bridging a replace (del↔add); same-op neighbors would duplicate.
    if (prev!.op === following!.op) continue;

    // Split the short eq into both sides so the change block stays contiguous (recall).
    prev!.text += p.text;
    following!.text = p.text + following!.text;
    next[i] = { op: 'eq', text: '' }; // mark removed
  }
  return mergeAdjacentParts(next.filter((p) => p.text.length > 0));
}

/** Token LCS + short-eq cleanup → parts for a paired del/add line pair. */
export function diffInline(fromText: string, toText: string): {
  delParts: DiffPart[];
  addParts: DiffPart[];
} | null {
  const a = tokenize(fromText);
  const b = tokenize(toText);
  if (a.length * b.length > INLINE_TOKEN_PRODUCT_LIMIT) return null;

  const cleaned = cleanupShortEq(lcsOps(a, b));

  const delParts: DiffPart[] = [];
  const addParts: DiffPart[] = [];
  for (const p of cleaned) {
    if (p.op === 'eq') {
      delParts.push({ op: 'eq', text: p.text });
      addParts.push({ op: 'eq', text: p.text });
    } else if (p.op === 'del') {
      delParts.push({ op: 'del', text: p.text });
    } else {
      addParts.push({ op: 'add', text: p.text });
    }
  }
  return {
    delParts: mergeAdjacentParts(delParts),
    addParts: mergeAdjacentParts(addParts),
  };
}

/**
 * Pair consecutive del* + add* hunks and attach inline parts (1:1 by order).
 */
export function attachInlineParts(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.op === 'eq') {
      out.push(line);
      i++;
      continue;
    }

    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    let j = i;
    while (j < lines.length && lines[j]!.op === 'del') {
      dels.push(lines[j]!);
      j++;
    }
    while (j < lines.length && lines[j]!.op === 'add') {
      adds.push(lines[j]!);
      j++;
    }

    if (dels.length === 0 || adds.length === 0) {
      for (const d of dels) out.push(d);
      for (const a of adds) out.push(a);
      i = j;
      continue;
    }

    const pairCount = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      const d = dels[k]!;
      const a = adds[k]!;
      const inline = diffInline(d.text, a.text);
      if (inline) {
        out.push({ ...d, parts: inline.delParts });
        out.push({ ...a, parts: inline.addParts });
      } else {
        out.push(d);
        out.push(a);
      }
    }
    for (let k = pairCount; k < dels.length; k++) out.push(dels[k]!);
    for (let k = pairCount; k < adds.length; k++) out.push(adds[k]!);
    i = j;
  }
  return out;
}

/** Myers-style line LCS → unified op stream. Fine for section-sized texts. */
export function diffLines(fromText: string, toText: string): DiffLine[] {
  const a = fromText.length ? fromText.split('\n') : [];
  const b = toText.length ? toText.split('\n') : [];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'eq', text: a[i]!, oldLine, newLine });
      i++;
      j++;
      oldLine++;
      newLine++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: 'del', text: a[i]!, oldLine });
      i++;
      oldLine++;
    } else {
      out.push({ op: 'add', text: b[j]!, newLine });
      j++;
      newLine++;
    }
  }
  while (i < n) {
    out.push({ op: 'del', text: a[i]!, oldLine });
    i++;
    oldLine++;
  }
  while (j < m) {
    out.push({ op: 'add', text: b[j]!, newLine });
    j++;
    newLine++;
  }
  return attachInlineParts(out);
}

function bodyAsAdded(body: string): DiffLine[] {
  if (!body) return [];
  return body.split('\n').map((text, idx) => ({
    op: 'add' as const,
    text,
    newLine: idx + 1,
  }));
}

function bodyAsRemoved(body: string): DiffLine[] {
  if (!body) return [];
  return body.split('\n').map((text, idx) => ({
    op: 'del' as const,
    text,
    oldLine: idx + 1,
  }));
}

/** Align sections by stable id and produce per-section line diffs. */
export function compareMarkdownBySectionId(
  fromMarkdown: string,
  toMarkdown: string,
): SectionCompareItem[] {
  const fromSlices = collectSlices(fromMarkdown);
  const toSlices = collectSlices(toMarkdown);
  const fromMap = new Map(fromSlices.map((s) => [s.id, s]));

  const items: SectionCompareItem[] = [];
  const seen = new Set<string>();

  for (const to of toSlices) {
    seen.add(to.id);
    const from = fromMap.get(to.id);
    if (!from) {
      items.push({
        id: to.id,
        title: to.title,
        kind: 'added',
        lines: bodyAsAdded(to.body),
      });
      continue;
    }
    if (from.body === to.body) {
      items.push({
        id: to.id,
        title: to.title,
        kind: 'unchanged',
        lines: diffLines(from.body, to.body),
      });
    } else {
      items.push({
        id: to.id,
        title: to.title,
        kind: 'changed',
        lines: diffLines(from.body, to.body),
      });
    }
  }

  for (const from of fromSlices) {
    if (seen.has(from.id)) continue;
    items.push({
      id: from.id,
      title: from.title,
      kind: 'removed',
      lines: bodyAsRemoved(from.body),
    });
  }

  return items;
}
