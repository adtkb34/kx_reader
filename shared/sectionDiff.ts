import {
  extractSectionBodies,
  normalizeSectionBody,
} from './sections';

export type DiffLineOp = 'eq' | 'add' | 'del';

export interface DiffLine {
  op: DiffLineOp;
  text: string;
  /** 1-based line in from body; omitted for pure adds */
  oldLine?: number;
  /** 1-based line in to body; omitted for pure deletes */
  newLine?: number;
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
      out.push({ op: 'eq', text: a[i], oldLine, newLine });
      i++;
      j++;
      oldLine++;
      newLine++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', text: a[i], oldLine });
      i++;
      oldLine++;
    } else {
      out.push({ op: 'add', text: b[j], newLine });
      j++;
      newLine++;
    }
  }
  while (i < n) {
    out.push({ op: 'del', text: a[i], oldLine });
    i++;
    oldLine++;
  }
  while (j < m) {
    out.push({ op: 'add', text: b[j], newLine });
    j++;
    newLine++;
  }
  return out;
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
  const toMap = new Map(toSlices.map((s) => [s.id, s]));

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
