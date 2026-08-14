/**
 * Build a full-book digest Markdown that mirrors LensDigestView:
 * same module/axis order, display heading levels, and stable outline numbers.
 */
import {
  digestAnchorId,
  digestPageDisplayLevel,
  digestPathAnchorId,
  digestSectionDisplayLevel,
  filterChapters,
  filterChaptersWithContent,
  filterChaptersWithoutContent,
  filterSectionsByAllowlist,
  filterSectionsByShowLevel,
  defaultSelection,
  groupChaptersForDigest,
  layerOptions,
  lensAxisIds,
  lensNodeTitle,
  lensQueryFromSelection,
  lensSelectionFromQuery,
  pageVisibleInSelection,
  sectionAllowlistFor,
  sectionLensLeaves,
  selectionToFlatIds,
  visibleTocSections,
  type LensQueryInput,
  type ReaderShowLevel,
} from './lenses';
import { outlineNumbers } from './outlineNumbers';
import { filterRulerKeysBySelection } from './outlineKeys';
import {
  assembleModuleView,
  axisBucketAnchorId,
  filterRulerAssembleView,
  filterRulerModuleIndexIds,
  filterRulerOutlineEntries,
  findRulerModuleIndexId,
  listLeafModules,
  moduleMatchesRulerLeaf,
  normalizeRulerPick,
  rulerAxisLeaves,
  rulerOutlineEntries,
  rulerSidebarKeepIds,
  type LeafModule,
  type RulerAssembleView,
  type RulerTickHangFilter,
} from './ruler';
import { extractSectionBodies, type SectionBody } from './sections';
import { collectTableRowMarkers, TABLE_ROW_ID_LINE_RE } from './tableRowId';
import type {
  BookToc,
  LensAxisId,
  LensSelection,
  PageLayer,
  TocChapter,
} from './types';

/** Standalone section marker line: `{#id}` or `{#id rank=N}`. */
const BLOCK_ID_LINE_RE = /^\{#([A-Za-z0-9_-]+)(?:\s+rank=\d+)?\}\s*$/;

/** GFM separator row (`| --- | --- |`). */
function isGfmSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  return /^\|?[\s|:.-]+\|[\s|:.-]*\|?\s*$/.test(t) && /:-|-:|---/.test(t);
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/** Split a GFM table line into cell strings (inner content between pipes). */
export function splitGfmTableCells(line: string): string[] {
  let inner = line.trim();
  if (!inner.includes('|')) return [];
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  return inner.split('|');
}

export function joinGfmTableCells(cells: string[]): string {
  return `|${cells.join('|')}|`;
}

/** Drop trailing whitespace-only cells (id-placeholder column after `{#id}` strip). */
export function dropTrailingEmptyGfmCells(cells: string[]): string[] {
  const out = [...cells];
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop();
  return out;
}

/**
 * After row ids are stripped, drop the trailing empty column used only for `{#id}`
 * (e.g. header `| 场景 | 操作 | 系统 | |` → `| 场景 | 操作 | 系统 |`).
 */
export function normalizeExportTables(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableLine(lines[i]!)) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isTableLine(lines[i]!)) i++;
    out.push(...normalizeExportTableBlock(lines.slice(start, i)));
  }
  return out.join('\n');
}

function normalizeExportTableBlock(block: string[]): string[] {
  const rows = block.map((line) => {
    if (isGfmSeparatorLine(line)) {
      return { sep: true as const, cells: splitGfmTableCells(line) };
    }
    return {
      sep: false as const,
      cells: dropTrailingEmptyGfmCells(splitGfmTableCells(line)),
    };
  });
  const contentCols = rows.filter((r) => !r.sep).map((r) => r.cells.length);
  const colCount = contentCols.length ? Math.max(...contentCols) : 0;
  if (colCount <= 0) return block;
  return rows.map((r) => {
    if (r.sep) {
      const cells = r.cells.slice(0, colCount);
      while (cells.length < colCount) cells.push(' --- ');
      return joinGfmTableCells(cells);
    }
    const cells = [...r.cells];
    while (cells.length < colCount) cells.push(' ');
    return joinGfmTableCells(cells.slice(0, colCount));
  });
}

/**
 * Remove section ids from exported markdown:
 * - drop standalone `{#id}` / `{#id rank=N}` lines
 * - strip trailing `{#id}` from GFM table rows
 * - drop trailing empty table columns left by the id placeholder
 */
export function stripSectionIdsFromMarkdown(md: string): string {
  const out: string[] = [];
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw;
    if (BLOCK_ID_LINE_RE.test(line.trim())) continue;
    const row = line.match(TABLE_ROW_ID_LINE_RE);
    if (row) {
      let prefix = row[1]!.replace(/\s+$/, '');
      if (!prefix.endsWith('|')) prefix = `${prefix}|`;
      out.push(joinGfmTableCells(dropTrailingEmptyGfmCells(splitGfmTableCells(prefix))));
      continue;
    }
    out.push(line);
  }
  return normalizeExportTables(out.join('\n').replace(/\n{3,}/g, '\n\n'));
}

/**
 * Locate GFM header + separator above `rowLine` in the same table.
 * Mirrors UI `extractTableRowFragment` copying `<thead>` into hang-off slices.
 */
export function findGfmTableHeader(
  lines: string[],
  rowLine: number,
): { header: string; separator: string } | null {
  if (rowLine < 0 || rowLine >= lines.length) return null;
  let top = 0;
  for (let i = rowLine; i >= 0; i--) {
    if (!isTableLine(lines[i]!)) {
      top = i + 1;
      break;
    }
    if (i === 0) top = 0;
  }
  let sep = -1;
  for (let i = top; i < rowLine; i++) {
    if (isGfmSeparatorLine(lines[i]!)) sep = i;
  }
  if (sep <= top) return null;
  const header = lines[sep - 1]!;
  if (!isTableLine(header) || isGfmSeparatorLine(header)) return null;
  return { header, separator: lines[sep]! };
}

function bodyHasTableSeparator(body: string): boolean {
  return body.split('\n').some((l) => isGfmSeparatorLine(l));
}

/**
 * For table-row sections, prepend the source table header when the slice has
 * only body rows (UI already copies thead into HTML fragments).
 */
export function ensureTableHeaderInBody(
  chapterMarkdown: string,
  sectionId: string,
  body: string,
): string {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  if (!trimmed || bodyHasTableSeparator(trimmed)) return body;
  const first = trimmed.split('\n').find((l) => l.trim());
  if (!first || !isTableLine(first)) return body;

  const lines = chapterMarkdown.replace(/\r\n/g, '\n').split('\n');
  const row = collectTableRowMarkers(chapterMarkdown).find((r) => r.id === sectionId);
  if (!row) return body;
  const hdr = findGfmTableHeader(lines, row.startLine);
  if (!hdr) return body;
  return `${hdr.header}\n${hdr.separator}\n${body.replace(/^\n+/, '')}`;
}

/** Strip ids and restore table headers for a section body before export. */
export function prepareExportSectionBody(
  chapterMarkdown: string,
  section: Pick<SectionBody, 'id' | 'body'>,
): string {
  const withHeader = ensureTableHeaderInBody(chapterMarkdown, section.id, section.body);
  return stripSectionIdsFromMarkdown(withHeader);
}

export type DigestExportOptions = {
  selection: LensSelection | null;
  rulerPick?: string | null;
  readerShowLevel?: ReaderShowLevel;
  /** Body hang filter (matches topbar). Numbers always use stable `'all'`. */
  hangFilter?: RulerTickHangFilter;
  /** When set, only export these leaf modules (index chapter ids) or plain chapters. */
  focusModuleIds?: string[] | null;
  /** @deprecated Prefer `focusModuleIds`. */
  focusModuleId?: string | null;
  /**
   * Per-module selected outline key section ids (same as reading filter).
   * Missing module ⇒ no key filter for that module.
   */
  outlineKeyIdsByModule?: Record<string, string[]> | null;
};

function rawFocusModuleIds(opts: DigestExportOptions): string[] | null {
  if (opts.focusModuleIds?.length) return opts.focusModuleIds;
  if (opts.focusModuleId) return [opts.focusModuleId];
  return null;
}

function focusModuleIdSet(toc: BookToc, opts: DigestExportOptions): Set<string> | null {
  const ids = resolveExportFocusModuleIds(toc, rawFocusModuleIds(opts));
  return ids ? new Set(ids) : null;
}

type MdBlock = {
  id: string;
  level: number;
  title: string;
  /** Raw markdown body (may include ATX headings); empty for synthetic titles. */
  body: string;
  /** Original markdown heading level before digest demotion. */
  sourceLevel?: number;
  /** When true, emit only a synthetic heading (path / page / axis). */
  synthetic?: boolean;
};

function clampLevel(level: number): number {
  return Math.min(6, Math.max(1, level));
}

/** Shift ATX heading depths by `delta` (clamped 1–6), like `shiftHeadingLevels` for HTML. */
export function shiftAtxHeadingLevels(md: string, delta: number): string {
  if (!delta || !md) return md;
  return md.replace(/^(#{1,6})(?=\s|$)/gm, (hashes) => {
    const next = clampLevel(hashes.length + delta);
    return '#'.repeat(next);
  });
}

/**
 * Ensure the block starts with a heading at `displayLevel`, prefixed with outline number.
 * Existing first ATX heading is rewritten; otherwise a synthetic heading is prepended.
 */
export function formatBlockMarkdown(
  displayLevel: number,
  number: string,
  title: string,
  body: string,
  opts?: { synthetic?: boolean; sourceLevel?: number },
): string {
  const level = clampLevel(displayLevel);
  const hashes = '#'.repeat(level);
  const label = number ? `${number} ${title}` : title;
  if (opts?.synthetic || !body.trim()) {
    return `${hashes} ${label}`.trimEnd();
  }
  const sourceLevel = opts?.sourceLevel ?? guessBodyLevel(body, level);
  const shifted = shiftAtxHeadingLevels(body.replace(/\r\n/g, '\n'), level - sourceLevel);
  const headingRe = /^(#{1,6})([ \t]+)(.*)$/m;
  if (headingRe.test(shifted)) {
    return shifted.replace(headingRe, `${hashes} ${label}`).replace(/\s+$/, '');
  }
  return `${hashes} ${label}\n\n${shifted}`.replace(/\s+$/, '');
}

function guessBodyLevel(body: string, fallback: number): number {
  const m = body.match(/^(#{1,6})\s/m);
  return m ? m[1]!.length : fallback;
}

function pageAnchorId(chapterId: string, leaf?: PageLayer): string {
  return leaf ? `page-${leaf}-${chapterId}` : `page-${chapterId}`;
}

/** Whole-page layer leaf ids across axes (declaration order). */
function chapterLayerLeaves(toc: BookToc, chapter: TocChapter): PageLayer[] {
  const out: PageLayer[] = [];
  const seen = new Set<PageLayer>();
  for (const axis of lensAxisIds(toc)) {
    for (const id of layerOptions(chapter.layers?.[axis])) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Heading text for export: prefer section/tick title; if empty (table-row hangs),
 * fall back to lens leaf titles so `####` is not blank after the number.
 */
export function exportSectionHeadingTitle(
  toc: BookToc,
  chapter: TocChapter,
  sectionId: string,
  preferred: string,
): string {
  const text = preferred.trim();
  if (text) return text;
  const leaves = sectionLensLeaves(chapter, sectionId, toc);
  const ids = leaves.length > 0 ? leaves : chapterLayerLeaves(toc, chapter);
  if (ids.length === 0) return sectionId;
  return ids.map((id) => lensNodeTitle(toc, id)).join(' · ');
}

function sectionBodiesById(markdown: string): Map<string, SectionBody> {
  const { sections } = extractSectionBodies(markdown);
  const out = new Map<string, SectionBody>();
  for (const s of sections) {
    out.set(s.id, { ...s, body: prepareExportSectionBody(markdown, s) });
  }
  return out;
}

function takeBody(
  byChapter: Map<string, Map<string, SectionBody>>,
  chapterId: string,
  sectionId: string,
): SectionBody | null {
  return byChapter.get(chapterId)?.get(sectionId) ?? null;
}

function joinBodies(
  parts: SectionBody[],
  id: string,
  title: string,
  level: number,
): SectionBody | null {
  if (parts.length === 0) return null;
  return {
    id,
    title: title || parts[0]!.title,
    level,
    body: parts.map((p) => p.body).join('\n\n'),
  };
}

function visiblePlainChapters(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel,
  hangFilter: RulerTickHangFilter,
): TocChapter[] {
  if (hangFilter === 'content') {
    return filterChaptersWithContent(toc.chapters, selection, toc, readerShowLevel);
  }
  if (hangFilter === 'empty') {
    return filterChaptersWithoutContent(toc.chapters, selection, toc, readerShowLevel);
  }
  return filterChapters(toc.chapters, selection, toc);
}

function listRulerModules(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel,
  hangFilter: RulerTickHangFilter,
  focusIds?: Set<string> | null,
): LeafModule[] {
  const keep = rulerSidebarKeepIds(toc, selection);
  let modules = listLeafModules(toc).filter((m) => keep.has(m.indexChapterId));
  if (hangFilter === 'content' || hangFilter === 'empty') {
    const ids = filterRulerModuleIndexIds(toc, selection, readerShowLevel, hangFilter);
    modules = modules.filter((m) => ids.has(m.indexChapterId));
  }
  if (focusIds) {
    modules = modules.filter((m) => focusIds.has(m.indexChapterId));
  }
  return modules;
}

function outlineKeysForModule(
  opts: DigestExportOptions,
  moduleIndexId: string,
): string[] | null | undefined {
  const map = opts.outlineKeyIdsByModule;
  if (!map) return undefined;
  return Object.prototype.hasOwnProperty.call(map, moduleIndexId)
    ? map[moduleIndexId]
    : undefined;
}

/** Apply hang filter then optional outline-key selection to an assemble view. */
function filterAssembleViewForExport(
  toc: BookToc,
  selection: LensSelection | null,
  showLevel: ReaderShowLevel,
  view: RulerAssembleView,
  hangFilter: RulerTickHangFilter,
  outlineKeyIds: string[] | null | undefined,
): RulerAssembleView {
  const hung = filterRulerAssembleView(toc, selection, showLevel, view, hangFilter);
  if (outlineKeyIds == null) return hung;
  const buckets = hung.buckets.map((b) => ({
    ...b,
    keys: filterRulerKeysBySelection(b.keys, outlineKeyIds),
  }));
  return { preamble: hung.preamble, buckets };
}

/** Chapter ids whose markdown is needed for the export. */
export function listDigestExportChapterIds(
  toc: BookToc,
  opts: DigestExportOptions,
): string[] {
  const selection = opts.selection ?? null;
  const hangFilter = opts.hangFilter ?? 'all';
  const showLevel = opts.readerShowLevel;
  const ids = new Set<string>();

  if (!toc.ruler) {
    const focus = focusModuleIdSet(toc, opts);
    for (const ch of visiblePlainChapters(toc, selection, showLevel, hangFilter)) {
      if (focus && !focus.has(ch.id)) continue;
      ids.add(ch.id);
    }
    return [...ids];
  }

  const pick = normalizeRulerPick(toc, opts.rulerPick);
  const modules = listRulerModules(
    toc,
    selection,
    showLevel,
    hangFilter,
    focusModuleIdSet(toc, opts),
  );
  for (const mod of modules) {
    const raw = assembleModuleView(toc, selection, showLevel, mod.indexChapterId, pick);
    if (!raw) continue;
    const view = filterAssembleViewForExport(
      toc,
      selection,
      showLevel,
      raw,
      hangFilter,
      outlineKeysForModule(opts, mod.indexChapterId),
    );
    for (const p of view.preamble) ids.add(p.chapterId);
    for (const b of view.buckets) {
      for (const k of b.keys) {
        ids.add(k.chapterId);
        for (const g of k.groups) for (const x of g.blocks) ids.add(x.chapterId);
      }
    }
  }
  return [...ids];
}

function stablePlainNumberMap(
  toc: BookToc,
  selection: LensSelection | null,
  showLevel: ReaderShowLevel,
): Map<string, string> {
  const chapters = filterChapters(toc.chapters, selection, toc);
  const items: { id: string; level: number }[] = [];
  const emitted = new Set<string>();
  for (const g of groupChaptersForDigest(toc, chapters)) {
    for (let i = 0; i < g.groupPath.length; i++) {
      const key = g.groupPath.slice(0, i + 1).join('/');
      if (emitted.has(key)) continue;
      emitted.add(key);
      items.push({ id: digestPathAnchorId(key), level: i + 1 });
    }
    for (const ch of g.pages) {
      const sections = visibleTocSections(ch, selection, toc, showLevel, false);
      if (sections.length === 0) continue;
      const pageLevel = digestPageDisplayLevel(g.groupPath.length);
      items.push({ id: pageAnchorId(ch.id), level: pageLevel });
      for (const s of sections) {
        items.push({
          id: digestAnchorId(ch.id, s.id),
          level: digestSectionDisplayLevel(g.groupPath.length, s.level),
        });
      }
    }
  }
  return outlineNumbers(items);
}

function stableModuleNumberMap(
  toc: BookToc,
  selection: LensSelection | null,
  showLevel: ReaderShowLevel,
  pick: string,
): Map<string, string> {
  const keep = rulerSidebarKeepIds(toc, selection);
  const modules = listLeafModules(toc).filter((m) => keep.has(m.indexChapterId));
  const items: { id: string; level: number }[] = [];

  if (pick === 'index') {
    const emitted = new Set<string>();
    for (const mod of modules) {
      for (let i = 0; i < mod.groupPath.length; i++) {
        const key = mod.groupPath.slice(0, i + 1).join('/');
        if (emitted.has(key)) continue;
        emitted.add(key);
        items.push({ id: digestPathAnchorId(key), level: i + 1 });
      }
      const pageLevel = digestPageDisplayLevel(mod.groupPath.length);
      items.push({ id: pageAnchorId(mod.indexChapterId), level: pageLevel });
      const entries = filterRulerOutlineEntries(
        toc,
        selection,
        showLevel,
        rulerOutlineEntries(toc, selection, showLevel, mod.indexChapterId, pick),
        'all',
      );
      for (const e of entries) {
        if (!e.title) continue;
        items.push({
          id: e.anchorId ?? digestAnchorId(e.chapterId, e.sectionId),
          level: digestSectionDisplayLevel(mod.groupPath.length, e.level),
        });
      }
    }
  } else {
    const axis = pick as LensAxisId;
    for (const leaf of rulerAxisLeaves(toc, axis)) {
      const leafMods = modules.filter((m) =>
        moduleMatchesRulerLeaf(toc, m.indexChapterId, axis, leaf),
      );
      if (leafMods.length === 0) continue;
      const axisId = axisBucketAnchorId(leaf);
      items.push({ id: axisId, level: 1 });
      const boost = 1;
      const emitted = new Set<string>();
      for (const mod of leafMods) {
        const entries = filterRulerOutlineEntries(
          toc,
          selection,
          showLevel,
          rulerOutlineEntries(toc, selection, showLevel, mod.indexChapterId, pick),
          'all',
        );
        const leafEntries = [];
        let bucketLeaf: PageLayer | null = null;
        for (const e of entries) {
          if (e.anchorId?.startsWith('ruler-bucket-')) {
            bucketLeaf = e.sectionId as PageLayer;
            continue;
          }
          if (bucketLeaf !== leaf || !e.title) continue;
          leafEntries.push(e);
        }
        for (let i = 0; i < mod.groupPath.length; i++) {
          const key = mod.groupPath.slice(0, i + 1).join('/');
          const emitKey = `${leaf}/${key}`;
          if (emitted.has(emitKey)) continue;
          emitted.add(emitKey);
          items.push({
            id: `${axisId}--${digestPathAnchorId(key)}`,
            level: i + 1 + boost,
          });
        }
        items.push({
          id: pageAnchorId(mod.indexChapterId, leaf),
          level: digestPageDisplayLevel(mod.groupPath.length) + boost,
        });
        for (const e of leafEntries) {
          items.push({
            id: `${axisId}--${digestAnchorId(e.chapterId, e.sectionId)}`,
            level: digestSectionDisplayLevel(mod.groupPath.length, e.level) + boost,
          });
        }
      }
    }
  }
  return outlineNumbers(items);
}

function emitPathBlocks(
  groupPath: string[],
  emitted: Set<string>,
  numberMap: Map<string, string>,
  opts?: { levelBoost?: number; idPrefix?: string },
): MdBlock[] {
  const boost = opts?.levelBoost ?? 0;
  const prefix = opts?.idPrefix ?? '';
  const out: MdBlock[] = [];
  for (let i = 0; i < groupPath.length; i++) {
    const key = groupPath.slice(0, i + 1).join('/');
    const emitKey = prefix ? `${prefix}/${key}` : key;
    if (emitted.has(emitKey)) continue;
    emitted.add(emitKey);
    const id = prefix ? `${prefix}--${digestPathAnchorId(key)}` : digestPathAnchorId(key);
    out.push({
      id,
      title: groupPath[i]!,
      level: i + 1 + boost,
      body: '',
      synthetic: true,
    });
  }
  return out;
}

function buildModuleBlocks(
  toc: BookToc,
  mod: LeafModule,
  selection: LensSelection | null,
  showLevel: ReaderShowLevel,
  pick: string,
  hangFilter: RulerTickHangFilter,
  bodies: Map<string, Map<string, SectionBody>>,
  chapterById: Map<string, TocChapter>,
  axisLeaf?: PageLayer,
  outlineKeyIds?: string[] | null,
): MdBlock[] {
  const raw = assembleModuleView(toc, selection, showLevel, mod.indexChapterId, pick);
  if (!raw) return [];
  const view = filterAssembleViewForExport(
    toc,
    selection,
    showLevel,
    raw,
    hangFilter,
    outlineKeyIds,
  );
  const buckets = axisLeaf ? view.buckets.filter((b) => b.leaf === axisLeaf) : view.buckets;
  if (axisLeaf && buckets.length === 0) return [];
  if (buckets.every((b) => b.keys.length === 0) && (axisLeaf || view.preamble.length === 0)) {
    return [];
  }

  const pathLen = mod.groupPath.length;
  const boost = axisLeaf ? 1 : 0;
  const pageLevel = digestPageDisplayLevel(pathLen) + boost;
  const pageId = pageAnchorId(mod.indexChapterId, axisLeaf);
  const out: MdBlock[] = [];

  if (!axisLeaf) {
    for (const p of view.preamble) {
      const ch = chapterById.get(p.chapterId);
      for (const sid of p.sectionIds) {
        const s = takeBody(bodies, p.chapterId, sid);
        if (!s || !ch) continue;
        const level = digestSectionDisplayLevel(pathLen, s.level) + boost;
        out.push({
          id: digestAnchorId(p.chapterId, s.id),
          title: exportSectionHeadingTitle(toc, ch, s.id, s.title),
          level,
          body: s.body,
          sourceLevel: s.level,
        });
      }
    }
  }

  for (const bucket of buckets) {
    if (bucket.leafTitle && !axisLeaf && bucket.leaf) {
      const bid = axisBucketAnchorId(bucket.leaf);
      out.push({
        id: bid,
        title: bucket.leafTitle,
        level: pageLevel + 1,
        body: '',
        synthetic: true,
      });
    }
    for (const key of bucket.keys) {
      const keyCh = chapterById.get(key.chapterId);
      const bodyIds = key.bodySectionIds.length ? key.bodySectionIds : [key.sectionId];
      const parts = bodyIds
        .map((id) => takeBody(bodies, key.chapterId, id))
        .filter((s): s is SectionBody => !!s);
      const joined = joinBodies(parts, key.sectionId, key.title, key.level);
      if (joined && keyCh) {
        const level = digestSectionDisplayLevel(pathLen, joined.level) + boost;
        const anchorId = axisLeaf
          ? `${axisBucketAnchorId(axisLeaf)}--${digestAnchorId(key.chapterId, joined.id)}`
          : digestAnchorId(key.chapterId, joined.id);
        out.push({
          id: anchorId,
          title: exportSectionHeadingTitle(toc, keyCh, joined.id, joined.title || key.title),
          level,
          body: joined.body,
          sourceLevel: joined.level,
        });
      } else if (key.title) {
        const level = digestSectionDisplayLevel(pathLen, key.level) + boost;
        const anchorId = axisLeaf
          ? `${axisBucketAnchorId(axisLeaf)}--${digestAnchorId(key.chapterId, key.sectionId)}`
          : digestAnchorId(key.chapterId, key.sectionId);
        out.push({
          id: anchorId,
          title: key.title,
          level,
          body: '',
          synthetic: true,
        });
      }
      for (const g of key.groups) {
        for (const b of g.blocks) {
          const bch = chapterById.get(b.chapterId);
          const s = takeBody(bodies, b.chapterId, b.sectionId);
          if (!bch || !s) continue;
          const rawLevel = Math.max(s.level, key.level + 1);
          const level = digestSectionDisplayLevel(pathLen, rawLevel) + boost;
          const anchorId = axisLeaf
            ? `${axisBucketAnchorId(axisLeaf)}--${digestAnchorId(b.chapterId, s.id)}`
            : digestAnchorId(b.chapterId, s.id);
          out.push({
            id: anchorId,
            title: exportSectionHeadingTitle(toc, bch, s.id, s.title || b.title),
            level,
            body: s.body,
            sourceLevel: s.level,
          });
        }
      }
    }
  }

  if (out.length === 0) return [];

  return [
    {
      id: pageId,
      title: mod.title,
      level: pageLevel,
      body: '',
      synthetic: true,
    },
    ...out,
  ];
}

function buildPlainBlocks(
  toc: BookToc,
  selection: LensSelection | null,
  showLevel: ReaderShowLevel,
  hangFilter: RulerTickHangFilter,
  bodies: Map<string, Map<string, SectionBody>>,
  numberMap: Map<string, string>,
  focusIds?: Set<string> | null,
): MdBlock[] {
  const chapters = visiblePlainChapters(toc, selection, showLevel, hangFilter).filter(
    (ch) => !focusIds || focusIds.has(ch.id),
  );
  const out: MdBlock[] = [];
  const emitted = new Set<string>();
  const contentOnly =
    hangFilter === 'content' && selectionToFlatIds(toc, selection).length > 0;
  const emptyOnly = hangFilter === 'empty' && selectionToFlatIds(toc, selection).length > 0;

  for (const g of groupChaptersForDigest(toc, chapters)) {
    for (const ch of g.pages) {
      let sectionList: { id: string; title: string; level: number }[];
      if (contentOnly && (!ch.layers || !pageVisibleInSelection(ch, selection, toc))) {
        continue;
      }
      if (emptyOnly) {
        sectionList = filterSectionsByShowLevel(ch.sections, ch, showLevel);
      } else {
        const allow = sectionAllowlistFor(ch, selection, toc);
        sectionList = filterSectionsByShowLevel(
          filterSectionsByAllowlist(ch.sections, allow),
          ch,
          showLevel,
        );
      }
      sectionList = sectionList.filter((s) => s.title.length > 0);
      if (sectionList.length === 0) continue;

      out.push(...emitPathBlocks(g.groupPath, emitted, numberMap));
      const pageLevel = digestPageDisplayLevel(g.groupPath.length);
      out.push({
        id: pageAnchorId(ch.id),
        title: ch.title,
        level: pageLevel,
        body: '',
        synthetic: true,
      });
      for (const s of sectionList) {
        const body = takeBody(bodies, ch.id, s.id);
        const level = digestSectionDisplayLevel(g.groupPath.length, s.level);
        out.push({
          id: digestAnchorId(ch.id, s.id),
          title: s.title,
          level,
          body: body?.body ?? '',
          sourceLevel: body?.level ?? s.level,
          synthetic: !body,
        });
      }
    }
  }
  return out;
}

function renderBlocks(blocks: MdBlock[], numberMap: Map<string, string>): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const num = numberMap.get(b.id) ?? '';
    parts.push(
      formatBlockMarkdown(b.level, num, b.title, b.body, {
        synthetic: b.synthetic,
        sourceLevel: b.sourceLevel,
      }),
    );
  }
  return parts.filter(Boolean).join('\n\n') + (parts.length ? '\n' : '');
}

/**
 * Assemble one digest Markdown document for the current lens + ruler view.
 * `chapterMarkdown` maps chapter id → raw chapter markdown (including frontmatter).
 */
export function buildDigestMarkdown(
  toc: BookToc,
  chapterMarkdown: Map<string, string>,
  opts: DigestExportOptions,
): string {
  const selection = opts.selection ?? null;
  const hangFilter = opts.hangFilter ?? 'all';
  const showLevel = opts.readerShowLevel;
  const bodies = new Map<string, Map<string, SectionBody>>();
  for (const [id, md] of chapterMarkdown) {
    bodies.set(id, sectionBodiesById(md));
  }

  if (!toc.ruler) {
    const nums = stablePlainNumberMap(toc, selection, showLevel);
    const blocks = buildPlainBlocks(
      toc,
      selection,
      showLevel,
      hangFilter,
      bodies,
      nums,
      focusModuleIdSet(toc, opts),
    );
    return renderBlocks(blocks, nums);
  }

  const pick = normalizeRulerPick(toc, opts.rulerPick);
  const modules = listRulerModules(
    toc,
    selection,
    showLevel,
    hangFilter,
    focusModuleIdSet(toc, opts),
  );
  const nums = stableModuleNumberMap(toc, selection, showLevel, pick);
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const blocks: MdBlock[] = [];

  if (pick === 'index') {
    const emitted = new Set<string>();
    for (const mod of modules) {
      const modBlocks = buildModuleBlocks(
        toc,
        mod,
        selection,
        showLevel,
        pick,
        hangFilter,
        bodies,
        chapterById,
        undefined,
        outlineKeysForModule(opts, mod.indexChapterId),
      );
      if (modBlocks.length === 0) continue;
      blocks.push(...emitPathBlocks(mod.groupPath, emitted, nums));
      blocks.push(...modBlocks);
    }
  } else {
    const axis = pick as LensAxisId;
    for (const leaf of rulerAxisLeaves(toc, axis)) {
      const leafMods = modules.filter((m) =>
        moduleMatchesRulerLeaf(toc, m.indexChapterId, axis, leaf),
      );
      const axisId = axisBucketAnchorId(leaf);
      const leafBlocks: MdBlock[] = [];
      const emitted = new Set<string>();
      for (const mod of leafMods) {
        const modBlocks = buildModuleBlocks(
          toc,
          mod,
          selection,
          showLevel,
          pick,
          hangFilter,
          bodies,
          chapterById,
          leaf,
          outlineKeysForModule(opts, mod.indexChapterId),
        );
        if (modBlocks.length === 0) continue;
        leafBlocks.push(
          ...emitPathBlocks(mod.groupPath, emitted, nums, {
            levelBoost: 1,
            idPrefix: axisId,
          }),
        );
        leafBlocks.push(...modBlocks);
      }
      if (leafBlocks.length === 0) continue;
      blocks.push({
        id: axisId,
        title: lensNodeTitle(toc, leaf),
        level: 1,
        body: '',
        synthetic: true,
      });
      blocks.push(...leafBlocks);
    }
  }

  return renderBlocks(blocks, nums);
}

export type DigestExportFormat = 'md' | 'json' | 'zip' | 'auto';

export type DigestExportResult = {
  markdown: string;
  filename: string;
  chapterIds: string[];
  options: DigestExportOptions;
};

/** JSON body of GET /api/books/:bookId/export (format=json). */
export type DigestExportAsset = {
  path: string;
  contentType: string;
  byteLength: number;
  base64?: string;
};

export type DigestExportPayload = {
  bookId: string;
  title: string;
  filename: string;
  zipFilename: string | null;
  markdown: string;
  chapterIds: string[];
  selection: LensSelection | null;
  rulerPick: string | null;
  hangFilter: RulerTickHangFilter;
  readerShowLevel: number | null;
  focusModuleIds: string[] | null;
  outlineKeyIdsByModule: Record<string, string[]> | null;
  assets: DigestExportAsset[];
};

function uniquePreserve(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Split a query value that may be repeated, comma / plus / space separated. */
export function csvQueryValues(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'object' && !Array.isArray(raw)) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    for (const bit of p.split(/[,+\s]+/)) {
      const s = bit.trim();
      if (s) out.push(s);
    }
  }
  return uniquePreserve(out);
}

export function parseExportHangFilter(raw: unknown): RulerTickHangFilter {
  const v = (csvQueryValues(raw)[0] ?? '').toLowerCase();
  if (v === 'content' || v === 'empty' || v === 'all') return v;
  return 'all';
}

export function parseExportShowLevel(raw: unknown): ReaderShowLevel {
  const v = csvQueryValues(raw)[0];
  if (v == null || v === '' || v === 'null' || v === 'all') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseExportFormat(raw: unknown): DigestExportFormat {
  const v = (csvQueryValues(raw)[0] ?? '').toLowerCase();
  if (v === 'md' || v === 'markdown') return 'md';
  if (v === 'zip') return 'zip';
  if (v === 'auto') return 'auto';
  return 'json';
}

export type DigestExportImageMode = 'omit' | 'files' | 'embed' | 'base64';

/** `images=0` skip; `embed` data URIs in markdown; `1`/`base64` JSON bytes; default keep files for zip. */
export function parseExportImageMode(raw: unknown): DigestExportImageMode {
  const v = (csvQueryValues(raw)[0] ?? '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'none' || v === 'omit') return 'omit';
  if (v === 'embed' || v === 'data' || v === 'datauri') return 'embed';
  if (v === '1' || v === 'true' || v === 'base64') return 'base64';
  return 'files';
}

export function parseExportRulerPick(raw: unknown): string | null {
  const v = csvQueryValues(raw)[0];
  return v || null;
}

export function parseExportUseDefaults(raw: unknown): boolean {
  const v = (csvQueryValues(raw)[0] ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function parseExportModuleIds(query: Record<string, unknown>): string[] | null {
  const ids = uniquePreserve([
    ...csvQueryValues(query.modules),
    ...csvQueryValues(query.module),
    ...csvQueryValues(query.focus),
    ...csvQueryValues(query.chapters),
  ]);
  return ids.length ? ids : null;
}

function parseOutlineKeysJson(raw: unknown): Record<string, string[]> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const ids = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : csvQueryValues(v);
      out[k] = uniquePreserve(ids);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function outlineKeysFromNested(raw: unknown): Record<string, string[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ids = csvQueryValues(v);
    if (ids.length) out[k] = ids;
  }
  return Object.keys(out).length ? out : null;
}

export function parseExportOutlineKeys(
  query: Record<string, unknown>,
  moduleIds: string[] | null,
): Record<string, string[]> | null {
  let map: Record<string, string[]> = {};
  const fromJson = parseOutlineKeysJson(query.outlineKeys);
  if (fromJson) map = { ...map, ...fromJson };
  const nested =
    typeof query.keys === 'object' && query.keys != null && !Array.isArray(query.keys)
      ? outlineKeysFromNested(query.keys)
      : null;
  if (nested) map = { ...map, ...nested };
  const csv = csvQueryValues(query.keys);
  if (csv.length && moduleIds?.length) {
    for (const id of moduleIds) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) map[id] = csv;
    }
  }
  return Object.keys(map).length ? map : null;
}

/** Map hang-off page ids to the module index id (same as the reader export). */
export function resolveExportFocusModuleIds(
  toc: BookToc,
  ids: string[] | null | undefined,
): string[] | null {
  if (!ids?.length) return null;
  if (!toc.ruler) return uniquePreserve(ids);
  return uniquePreserve(ids.map((id) => findRulerModuleIndexId(toc, id) ?? id));
}

export function selectionForExport(
  toc: BookToc,
  query: LensQueryInput,
  useDefaults: boolean,
): LensSelection | null {
  const fromQuery = lensSelectionFromQuery(query, toc);
  if (!useDefaults) return fromQuery;
  const defaults = defaultSelection(toc);
  if (!defaults) return fromQuery;
  if (!fromQuery) return defaults;
  return { ...defaults, ...fromQuery };
}

function toLensQuery(query: Record<string, unknown>): LensQueryInput {
  const out: Record<string, string | Array<string | null> | undefined> = {};
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) {
      out[k] = v.map((x) => (typeof x === 'string' ? x : null));
    }
  }
  return out;
}

/** Safe filename segment (Windows / macOS friendly). */
export function sanitizeExportFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'export';
}

export function digestExportFilename(toc: BookToc, opts: DigestExportOptions): string {
  const focus = resolveExportFocusModuleIds(toc, rawFocusModuleIds(opts));
  if (focus?.length === 1) {
    const pageTitle = toc.chapters.find((c) => c.id === focus[0])?.title ?? focus[0]!;
    return `${sanitizeExportFilename(toc.title)}-${sanitizeExportFilename(pageTitle)}.md`;
  }
  const pickLabel = toc.ruler ? String(normalizeRulerPick(toc, opts.rulerPick)) : 'export';
  return `${sanitizeExportFilename(toc.title)}-${sanitizeExportFilename(pickLabel)}.md`;
}

/**
 * Parse HTTP / URL query into the same options the reader 导出 button uses.
 *
 * Omitted lens axes are **not** filtered (unlike the reader default of first
 * option per axis). Pass `defaults=1` to fill missing axes from that default.
 */
export function digestExportOptionsFromQuery(
  toc: BookToc,
  query: Record<string, unknown>,
): DigestExportOptions {
  const moduleIds = resolveExportFocusModuleIds(toc, parseExportModuleIds(query));
  return {
    selection: selectionForExport(
      toc,
      toLensQuery(query),
      parseExportUseDefaults(query.defaults ?? query.useDefaults),
    ),
    rulerPick: parseExportRulerPick(query.ruler ?? query.rulerPick),
    readerShowLevel: parseExportShowLevel(query.showLevel ?? query.level),
    hangFilter: parseExportHangFilter(query.hang ?? query.hangFilter ?? query.filter),
    focusModuleIds: moduleIds,
    outlineKeyIdsByModule: parseExportOutlineKeys(query, moduleIds),
  };
}

/** Serialize options back to query params (for the client / curl). */
export function digestExportQueryFromOptions(
  toc: BookToc,
  opts: DigestExportOptions,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {
    ...lensQueryFromSelection(opts.selection, toc),
  };
  const focus = resolveExportFocusModuleIds(toc, rawFocusModuleIds(opts));
  if (focus?.length) out.modules = focus.join(',');
  if (opts.rulerPick) out.ruler = String(opts.rulerPick);
  if (opts.hangFilter && opts.hangFilter !== 'all') out.hang = opts.hangFilter;
  if (opts.readerShowLevel != null) out.showLevel = String(opts.readerShowLevel);
  if (opts.outlineKeyIdsByModule && Object.keys(opts.outlineKeyIdsByModule).length) {
    out.outlineKeys = JSON.stringify(opts.outlineKeyIdsByModule);
  }
  return out;
}

export async function assembleDigestExport(
  toc: BookToc,
  loadMarkdown: (chapterId: string) => Promise<string | null | undefined>,
  opts: DigestExportOptions,
): Promise<DigestExportResult> {
  const resolved: DigestExportOptions = {
    ...opts,
    focusModuleIds: resolveExportFocusModuleIds(toc, rawFocusModuleIds(opts)),
    hangFilter: opts.hangFilter ?? 'all',
    rulerPick: toc.ruler ? normalizeRulerPick(toc, opts.rulerPick) : opts.rulerPick,
  };
  const chapterIds = listDigestExportChapterIds(toc, resolved);
  const chapterMarkdown = new Map<string, string>();
  await Promise.all(
    chapterIds.map(async (id) => {
      const md = await loadMarkdown(id);
      if (md) chapterMarkdown.set(id, md);
    }),
  );
  return {
    markdown: buildDigestMarkdown(toc, chapterMarkdown, resolved),
    filename: digestExportFilename(toc, resolved),
    chapterIds,
    options: resolved,
  };
}

