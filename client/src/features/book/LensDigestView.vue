<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import {
  renderChapter,
  splitSections,
  extractSectionFragment,
  joinSectionFragments,
  shiftHeadingLevels,
  type RenderedSection,
} from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { activateFigmaEmbedsIn, bindFigmaEmbedDetails } from '@/figmaEmbed';
import { activateOpenApiEmbedsIn, bindOpenApiEmbedDetails } from '@/openapiEmbed';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { enhanceTableRulerColIn } from '@/tableRulerCol';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel } from '@/stores/ui';
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
  groupChaptersForDigest,
  lensColorMap,
  lensNodeTitle,
  pageVisibleInSelection,
  sectionAllowlistFor,
  sectionLensLeaves,
  selectionLegendLeaves,
  selectionToFlatIds,
  visibleTocSections,
} from '@shared/lenses';
import { filterRulerKeysBySelection } from '@shared/outlineKeys';
import { outlineNumbers } from '@shared/outlineNumbers';
import {
  assembleModuleView,
  axisBucketAnchorId,
  filterRulerAssembleView,
  filterRulerModuleIndexIds,
  filterRulerOutlineEntries,
  listLeafModules,
  moduleMatchesRulerLeaf,
  normalizeRulerPick,
  rulerAxisLeaves,
  rulerOutlineEntries,
  rulerSidebarKeepIds,
  type LeafModule,
  type RulerTickHangFilter,
} from '@shared/ruler';
import type {
  BookToc,
  LensAxisId,
  LensSelection,
  PageLayer,
  RulerPick,
  TocChapter,
} from '@shared/types';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';

const props = defineProps<{
  bookId: string;
  toc: BookToc;
  lensSelection?: LensSelection | null;
  rulerPick?: RulerPick;
  /** Per-module selected outline keys (ruler digest reading filter). */
  outlineKeyIdsByModule?: Record<string, string[]> | null;
  /** When set, only render these leaf-module index ids (or plain chapter ids). */
  focusModuleIds?: string[] | null;
}>();

const emit = defineEmits<{
  outline: [rows: DigestOutlineRow[]];
}>();

interface PathHeading {
  id: string;
  title: string;
  level: number;
  number: string;
}

interface DigestSectionView {
  chapter: TocChapter;
  section: RenderedSection;
  level: number;
  number: string;
  anchorId: string;
}

interface DigestPageView {
  chapterId: string;
  /** DOM id for the page title heading (may be leaf-scoped). */
  pageId: string;
  title: string;
  level: number;
  number: string;
  sections: DigestSectionView[];
}

interface DigestBlockView {
  pathHeadings: PathHeading[];
  page: DigestPageView;
}

/** One digest slab: optional axis leaf (P0…) then modules in TOC path order. */
interface DigestGroupView {
  axis?: PathHeading;
  modules: DigestBlockView[];
}

const groups = ref<DigestGroupView[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
const diagramHtml = ref('');
let unbindMermaid: (() => void) | null = null;
let unbindFigma: (() => void) | null = null;
let unbindOpenApi: (() => void) | null = null;
let loadGen = 0;

const pick = computed(() => normalizeRulerPick(props.toc, props.rulerPick ?? 'index'));
const blocksEmpty = computed(() => groups.value.length === 0);

function outlineFromGroups(gs: DigestGroupView[]): DigestOutlineRow[] {
  const rows: DigestOutlineRow[] = [];
  for (const g of gs) {
    if (g.axis) {
      rows.push({
        id: g.axis.id,
        title: g.axis.title,
        level: g.axis.level,
        number: g.axis.number,
      });
    }
    for (const block of g.modules) {
      for (const h of block.pathHeadings) {
        rows.push({
          id: h.id,
          title: h.title,
          level: h.level,
          number: h.number,
        });
      }
      rows.push({
        id: block.page.pageId,
        title: block.page.title,
        level: block.page.level,
        number: block.page.number,
        chapterId: block.page.chapterId,
      });
      for (const s of block.page.sections) {
        if (!s.section.title) continue;
        rows.push({
          id: s.anchorId,
          title: s.section.title,
          level: s.level,
          number: s.number,
          chapterId: s.chapter.id,
          sectionId: s.section.id,
        });
      }
    }
  }
  return rows;
}

const visibleChapters = computed(() => {
  const sel = props.lensSelection ?? null;
  const filterOn =
    ui.lensContentFilter !== 'all' && selectionToFlatIds(props.toc, sel).length > 0;
  let chapters = !filterOn
    ? filterChapters(props.toc.chapters, sel, props.toc)
    : ui.lensContentFilter === 'empty'
      ? filterChaptersWithoutContent(
          props.toc.chapters,
          sel,
          props.toc,
          getBookShowLevel(props.bookId),
        )
      : filterChaptersWithContent(
          props.toc.chapters,
          sel,
          props.toc,
          getBookShowLevel(props.bookId),
        );
  if (props.focusModuleIds?.length) {
    const want = new Set(props.focusModuleIds);
    chapters = chapters.filter((c) => want.has(c.id));
  }
  return chapters;
});

const activeLeaves = computed(
  () => new Set(selectionLegendLeaves(props.toc, props.lensSelection ?? null).map((i) => i.id)),
);
const lensChrome = computed(() => activeLeaves.value.size > 1);
const lensColors = computed(() => lensColorMap(props.toc));

function leavesFor(chapter: TocChapter, sectionId: string): PageLayer[] {
  return sectionLensLeaves(chapter, sectionId, props.toc);
}

function titlesFor(chapter: TocChapter): Record<string, string> {
  if (!chapter.sectionAllowlists) return {};
  const map: Record<string, string> = {};
  for (const byLeaf of Object.values(chapter.sectionAllowlists)) {
    for (const leaf of Object.keys(byLeaf ?? {})) {
      map[leaf] = lensNodeTitle(props.toc, leaf);
    }
  }
  return map;
}

function assignNumbers(items: { id: string; level: number }[]): Map<string, string> {
  return outlineNumbers(items);
}

/** Stable digest numbers from lens-visible structure (ignore 仅有/仅无内容). */
function stablePlainNumberMap(): Map<string, string> {
  const sel = props.lensSelection ?? null;
  const showLevel = getBookShowLevel(props.bookId);
  const chapters = filterChapters(props.toc.chapters, sel, props.toc);
  const items: { id: string; level: number }[] = [];
  const emitted = new Set<string>();
  for (const g of groupChaptersForDigest(props.toc, chapters)) {
    for (let i = 0; i < g.groupPath.length; i++) {
      const key = g.groupPath.slice(0, i + 1).join('/');
      if (emitted.has(key)) continue;
      emitted.add(key);
      items.push({ id: digestPathAnchorId(key), level: i + 1 });
    }
    for (const ch of g.pages) {
      const sections = visibleTocSections(ch, sel, props.toc, showLevel, false);
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
  return assignNumbers(items);
}

function stableModuleNumberMap(): Map<string, string> {
  const sel = props.lensSelection ?? null;
  const showLevel = getBookShowLevel(props.bookId);
  const keep = rulerSidebarKeepIds(props.toc, sel);
  const modules = listLeafModules(props.toc).filter((m) => keep.has(m.indexChapterId));
  const items: { id: string; level: number }[] = [];

  if (pick.value === 'index') {
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
        props.toc,
        sel,
        showLevel,
        rulerOutlineEntries(props.toc, sel, showLevel, mod.indexChapterId, pick.value),
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
    const axis = pick.value as LensAxisId;
    for (const leaf of rulerAxisLeaves(props.toc, axis)) {
      const leafMods = modules.filter((m) =>
        moduleMatchesRulerLeaf(props.toc, m.indexChapterId, axis, leaf),
      );
      if (leafMods.length === 0) continue;
      const axisId = axisBucketAnchorId(leaf);
      items.push({ id: axisId, level: 1 });
      const boost = 1;
      const emitted = new Set<string>();
      for (const mod of leafMods) {
        const entries = filterRulerOutlineEntries(
          props.toc,
          sel,
          showLevel,
          rulerOutlineEntries(props.toc, sel, showLevel, mod.indexChapterId, pick.value),
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
  return assignNumbers(items);
}

function demoteSection(section: RenderedSection, displayLevel: number): RenderedSection {
  const delta = displayLevel - section.level;
  if (delta === 0) return { ...section, level: displayLevel };
  return {
    ...section,
    level: displayLevel,
    html: shiftHeadingLevels(section.html, delta),
  };
}

function outlineNumStyle(num: string): Record<string, string> | undefined {
  if (!num) return undefined;
  return { '--outline-num': `"${num}"` };
}

function emitPathHeadings(
  groupPath: string[],
  emitted: Set<string>,
  numberMap: Map<string, string>,
  opts?: { levelBoost?: number; idPrefix?: string },
): PathHeading[] {
  const boost = opts?.levelBoost ?? 0;
  const prefix = opts?.idPrefix ?? '';
  const out: PathHeading[] = [];
  for (let i = 0; i < groupPath.length; i++) {
    const key = groupPath.slice(0, i + 1).join('/');
    const emitKey = prefix ? `${prefix}/${key}` : key;
    if (emitted.has(emitKey)) continue;
    emitted.add(emitKey);
    const id = prefix
      ? `${prefix}--${digestPathAnchorId(key)}`
      : digestPathAnchorId(key);
    out.push({
      id,
      title: groupPath[i]!,
      level: i + 1 + boost,
      number: numberMap.get(id) ?? '',
    });
  }
  return out;
}

function pageAnchorId(chapterId: string, leaf?: PageLayer): string {
  return leaf ? `page-${leaf}-${chapterId}` : `page-${chapterId}`;
}

async function loadPlain(): Promise<DigestGroupView[]> {
  const chapters = visibleChapters.value;
  const fileToChapter: Record<string, string> = {};
  for (const c of props.toc.chapters) {
    fileToChapter[c.file] = c.id;
    const base = c.file.split('/').pop();
    if (base) fileToChapter[base] = c.id;
  }

  const loaded = await Promise.all(
    chapters.map(async (ch) => {
      const content = await api.chapter(props.bookId, ch.id);
      const html = renderChapter(content.markdown, {
        bookId: props.bookId,
        fileToChapter,
      });
      const allow = sectionAllowlistFor(ch, props.lensSelection ?? null, props.toc);
      const sel = props.lensSelection ?? null;
      const contentOnly =
        ui.lensContentFilter === 'content' && selectionToFlatIds(props.toc, sel).length > 0;
      const emptyOnly =
        ui.lensContentFilter === 'empty' && selectionToFlatIds(props.toc, sel).length > 0;
      let sections: RenderedSection[];
      if (contentOnly && (!ch.layers || !pageVisibleInSelection(ch, sel, props.toc))) {
        sections = [];
      } else if (emptyOnly) {
        sections = filterSectionsByShowLevel(
          splitSections(html),
          ch,
          getBookShowLevel(props.bookId),
        );
      } else {
        sections = filterSectionsByShowLevel(
          filterSectionsByAllowlist(splitSections(html), allow),
          ch,
          getBookShowLevel(props.bookId),
        );
      }
      return {
        chapter: ch,
        title: content.title || ch.title,
        sections,
      };
    }),
  );

  const byId = new Map(loaded.map((p) => [p.chapter.id, p]));
  const structure = groupChaptersForDigest(props.toc, chapters);
  const outlineItems: { id: string; level: number }[] = [];
  const plan: {
    groupPath: string[];
    pageId: string;
    title: string;
    pageLevel: number;
    sections: { chapter: TocChapter; section: RenderedSection; level: number }[];
  }[] = [];

  for (const g of structure) {
    const pages = g.pages
      .map((ch) => byId.get(ch.id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.sections.length > 0);
    for (const page of pages) {
      const pageLevel = digestPageDisplayLevel(g.groupPath.length);
      for (let i = 0; i < g.groupPath.length; i++) {
        const key = g.groupPath.slice(0, i + 1).join('/');
        outlineItems.push({ id: digestPathAnchorId(key), level: i + 1 });
      }
      outlineItems.push({ id: `page-${page.chapter.id}`, level: pageLevel });
      const secs = page.sections.map((s) => {
        const level = digestSectionDisplayLevel(g.groupPath.length, s.level);
        return {
          chapter: page.chapter,
          section: demoteSection(s, level),
          level,
        };
      });
      for (const s of secs) {
        outlineItems.push({
          id: digestAnchorId(page.chapter.id, s.section.id),
          level: s.level,
        });
      }
      plan.push({
        groupPath: g.groupPath,
        pageId: page.chapter.id,
        title: page.title,
        pageLevel,
        sections: secs,
      });
    }
  }

  const nums = stablePlainNumberMap();
  const emitted = new Set<string>();
  return [
    {
      modules: plan.map((p) => ({
        pathHeadings: emitPathHeadings(p.groupPath, emitted, nums),
        page: {
          chapterId: p.pageId,
          pageId: pageAnchorId(p.pageId),
          title: p.title,
          level: p.pageLevel,
          number: nums.get(pageAnchorId(p.pageId)) ?? '',
          sections: p.sections.map((s) => ({
            chapter: s.chapter,
            section: s.section,
            level: s.level,
            number: nums.get(digestAnchorId(s.chapter.id, s.section.id)) ?? '',
            anchorId: digestAnchorId(s.chapter.id, s.section.id),
          })),
        },
      })),
    },
  ];
}

type ModuleSectionPlan = {
  chapter: TocChapter;
  section: RenderedSection;
  level: number;
  anchorId: string;
};

type ModulePlan = {
  mod: LeafModule;
  leaf?: PageLayer;
  pageLevel: number;
  pageId: string;
  sections: ModuleSectionPlan[];
};

async function loadModulePlan(
  mod: LeafModule,
  opts: {
    sel: LensSelection | null;
    showLevel: ReturnType<typeof getBookShowLevel>;
    chapterById: Map<string, TocChapter>;
    fileToChapter: Record<string, string>;
    /** When set, only that axis leaf's bucket; path/page levels boosted by 1. */
    axisLeaf?: PageLayer;
  },
): Promise<ModulePlan | null> {
  const raw = assembleModuleView(
    props.toc,
    opts.sel,
    opts.showLevel,
    mod.indexChapterId,
    pick.value,
  );
  if (!raw) return null;
  const hangMode = ui.lensContentFilter as RulerTickHangFilter;
  let view = filterRulerAssembleView(
    props.toc,
    opts.sel,
    opts.showLevel,
    raw,
    hangMode,
  );
  const keyIds = props.outlineKeyIdsByModule?.[mod.indexChapterId];
  if (keyIds != null) {
    view = {
      ...view,
      buckets: view.buckets.map((b) => ({
        ...b,
        keys: filterRulerKeysBySelection(b.keys, keyIds),
      })),
    };
  }

  const buckets = opts.axisLeaf
    ? view.buckets.filter((b) => b.leaf === opts.axisLeaf)
    : view.buckets;
  if (opts.axisLeaf && buckets.length === 0) return null;
  if (buckets.every((b) => b.keys.length === 0) && (opts.axisLeaf || view.preamble.length === 0)) {
    return null;
  }

  const chapterIds = new Set<string>();
  if (!opts.axisLeaf) {
    for (const p of view.preamble) chapterIds.add(p.chapterId);
  }
  for (const b of buckets) {
    for (const k of b.keys) {
      chapterIds.add(k.chapterId);
      for (const g of k.groups) for (const x of g.blocks) chapterIds.add(x.chapterId);
    }
  }

  const chapterHtml = new Map<string, string>();
  await Promise.all(
    [...chapterIds].map(async (id) => {
      const content = await api.chapter(props.bookId, id);
      chapterHtml.set(
        id,
        renderChapter(content.markdown, { bookId: props.bookId, fileToChapter: opts.fileToChapter }),
      );
    }),
  );

  function frag(chapterId: string, sectionId: string): RenderedSection | null {
    const html = chapterHtml.get(chapterId);
    if (!html) return null;
    return extractSectionFragment(html, sectionId);
  }

  const pathLen = mod.groupPath.length;
  const boost = opts.axisLeaf ? 1 : 0;
  const pageLevel = digestPageDisplayLevel(pathLen) + boost;
  const pageId = pageAnchorId(mod.indexChapterId, opts.axisLeaf);
  const sections: ModuleSectionPlan[] = [];

  if (!opts.axisLeaf) {
    for (const p of view.preamble) {
      const ch = opts.chapterById.get(p.chapterId);
      if (!ch) continue;
      for (const sid of p.sectionIds) {
        const s = frag(p.chapterId, sid);
        if (!s) continue;
        const level = digestSectionDisplayLevel(pathLen, s.level) + boost;
        const anchorId = digestAnchorId(ch.id, s.id);
        sections.push({
          chapter: ch,
          section: demoteSection(s, level),
          level,
          anchorId,
        });
      }
    }
  }

  for (const bucket of buckets) {
    // Axis digest already has Px as the group H1 — skip per-module bucket titles.
    if (bucket.leafTitle && !opts.axisLeaf) {
      const bid = axisBucketAnchorId(bucket.leaf!);
      const level = pageLevel + 1;
      sections.push({
        chapter: opts.chapterById.get(mod.indexChapterId)!,
        section: {
          id: bucket.leaf!,
          title: bucket.leafTitle,
          level,
          html: `<h${Math.min(level, 6)}>${bucket.leafTitle}</h${Math.min(level, 6)}>`,
        },
        level,
        anchorId: bid,
      });
    }
    for (const key of bucket.keys) {
      const ch = opts.chapterById.get(key.chapterId);
      if (!ch) continue;
      const bodyIds = key.bodySectionIds.length ? key.bodySectionIds : [key.sectionId];
      const parts = bodyIds
        .map((id) => frag(key.chapterId, id))
        .filter((s): s is RenderedSection => !!s);
      const joined = joinSectionFragments(parts, key.sectionId, key.title, key.level);
      if (joined) {
        const level = digestSectionDisplayLevel(pathLen, joined.level) + boost;
        const anchorId = opts.axisLeaf
          ? `${axisBucketAnchorId(opts.axisLeaf)}--${digestAnchorId(ch.id, joined.id)}`
          : digestAnchorId(ch.id, joined.id);
        sections.push({
          chapter: ch,
          section: demoteSection(joined, level),
          level,
          anchorId,
        });
      }
      for (const g of key.groups) {
        for (const b of g.blocks) {
          const bch = opts.chapterById.get(b.chapterId);
          const s = frag(b.chapterId, b.sectionId);
          if (!bch || !s) continue;
          const rawLevel = Math.max(s.level, key.level + 1);
          const level = digestSectionDisplayLevel(pathLen, rawLevel) + boost;
          const anchorId = opts.axisLeaf
            ? `${axisBucketAnchorId(opts.axisLeaf)}--${digestAnchorId(bch.id, s.id)}`
            : digestAnchorId(bch.id, s.id);
          sections.push({
            chapter: bch,
            section: demoteSection(s, level),
            level,
            anchorId,
          });
        }
      }
    }
  }

  if (sections.length === 0) return null;
  return { mod, leaf: opts.axisLeaf, pageLevel, pageId, sections };
}

async function loadModules(): Promise<DigestGroupView[]> {
  const sel = props.lensSelection ?? null;
  const keep = rulerSidebarKeepIds(props.toc, sel);
  const showLevel = getBookShowLevel(props.bookId);
  let modules = listLeafModules(props.toc).filter((m) => keep.has(m.indexChapterId));
  const hangMode = ui.lensContentFilter as RulerTickHangFilter;
  if (hangMode === 'content' || hangMode === 'empty') {
    const ids = filterRulerModuleIndexIds(props.toc, sel, showLevel, hangMode);
    modules = modules.filter((m) => ids.has(m.indexChapterId));
  }
  if (props.focusModuleIds?.length) {
    const want = new Set(props.focusModuleIds);
    modules = modules.filter((m) => want.has(m.indexChapterId));
  }
  const chapterById = new Map(props.toc.chapters.map((c) => [c.id, c]));

  const fileToChapter: Record<string, string> = {};
  for (const c of props.toc.chapters) {
    fileToChapter[c.file] = c.id;
    const base = c.file.split('/').pop();
    if (base) fileToChapter[base] = c.id;
  }

  const shared = { sel, showLevel, chapterById, fileToChapter };
  const outlineItems: { id: string; level: number }[] = [];
  const outGroups: { axis?: PathHeading; plans: ModulePlan[] }[] = [];

  if (pick.value === 'index') {
    const plans: ModulePlan[] = [];
    for (const mod of modules) {
      const plan = await loadModulePlan(mod, shared);
      if (!plan) continue;
      const pathLen = mod.groupPath.length;
      for (let i = 0; i < pathLen; i++) {
        outlineItems.push({
          id: digestPathAnchorId(mod.groupPath.slice(0, i + 1).join('/')),
          level: i + 1,
        });
      }
      outlineItems.push({ id: plan.pageId, level: plan.pageLevel });
      for (const s of plan.sections) {
        if (s.section.title) outlineItems.push({ id: s.anchorId, level: s.level });
      }
      plans.push(plan);
    }
    outGroups.push({ plans });
  } else {
    const axis = pick.value as LensAxisId;
    for (const leaf of rulerAxisLeaves(props.toc, axis)) {
      const leafMods = modules.filter((m) =>
        moduleMatchesRulerLeaf(props.toc, m.indexChapterId, axis, leaf),
      );
      const plans: ModulePlan[] = [];
      for (const mod of leafMods) {
        const plan = await loadModulePlan(mod, { ...shared, axisLeaf: leaf });
        if (plan) plans.push(plan);
      }
      if (plans.length === 0) continue;

      const axisId = axisBucketAnchorId(leaf);
      const axisLevel = 1;
      const boost = 1;
      outlineItems.push({ id: axisId, level: axisLevel });
      for (const plan of plans) {
        const pathLen = plan.mod.groupPath.length;
        for (let i = 0; i < pathLen; i++) {
          const key = plan.mod.groupPath.slice(0, i + 1).join('/');
          outlineItems.push({
            id: `${axisId}--${digestPathAnchorId(key)}`,
            level: i + 1 + boost,
          });
        }
        outlineItems.push({ id: plan.pageId, level: plan.pageLevel });
        for (const s of plan.sections) {
          if (s.section.title) outlineItems.push({ id: s.anchorId, level: s.level });
        }
      }
      outGroups.push({
        axis: {
          id: axisId,
          title: lensNodeTitle(props.toc, leaf),
          level: axisLevel,
          number: '',
        },
        plans,
      });
    }
  }

  const nums = stableModuleNumberMap();
  return outGroups.map((g) => {
    const emitted = new Set<string>();
    const idPrefix = g.axis?.id;
    return {
      axis: g.axis
        ? { ...g.axis, number: nums.get(g.axis.id) ?? '' }
        : undefined,
      modules: g.plans.map((p) => ({
        pathHeadings: emitPathHeadings(p.mod.groupPath, emitted, nums, {
          levelBoost: g.axis ? 1 : 0,
          idPrefix,
        }),
        page: {
          chapterId: p.mod.indexChapterId,
          pageId: p.pageId,
          title: p.mod.title,
          level: p.pageLevel,
          number: nums.get(p.pageId) ?? '',
          sections: p.sections.map((s) => ({
            chapter: s.chapter,
            section: s.section,
            level: s.level,
            number: nums.get(s.anchorId) ?? '',
            anchorId: s.anchorId,
          })),
        },
      })),
    };
  });
}

async function load(): Promise<void> {
  const gen = ++loadGen;
  loading.value = true;
  error.value = '';
  groups.value = [];
  emit('outline', []);
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  unbindOpenApi?.();
  unbindOpenApi = null;
  try {
    const next = props.toc.ruler ? await loadModules() : await loadPlain();
    if (gen !== loadGen) return;
    groups.value = next;
    emit('outline', outlineFromGroups(next));
    await nextTick();
    if (gen !== loadGen) return;
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    unbindFigma = bindFigmaEmbedDetails(contentEl.value);
    unbindOpenApi = bindOpenApiEmbedDetails(contentEl.value, props.bookId);
    await renderMermaidIn(contentEl.value);
    if (gen !== loadGen) return;
    activateFigmaEmbedsIn(contentEl.value);
    activateOpenApiEmbedsIn(contentEl.value, props.bookId);
    enhanceTableRulerColIn(contentEl.value, props.toc);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  } catch (e) {
    if (gen !== loadGen) return;
    error.value = e instanceof Error ? e.message : String(e);
    groups.value = [];
    emit('outline', []);
  } finally {
    if (gen === loadGen) loading.value = false;
  }
}

function applyDetailsPref(): void {
  const root = contentEl.value;
  if (!root) return;
  root.querySelectorAll<HTMLDetailsElement>('details.md-details').forEach((d) => {
    d.open = ui.detailsOpen;
  });
}

watch(
  () =>
    [
      props.bookId,
      JSON.stringify(props.lensSelection ?? null),
      visibleChapters.value.map((c) => c.id).join(','),
      getBookShowLevel(props.bookId),
      ui.lensContentFilter,
      pick.value,
      JSON.stringify(props.outlineKeyIdsByModule ?? null),
      (props.focusModuleIds ?? []).join(','),
    ] as const,
  load,
  { immediate: true },
);
watch(
  () => ui.chapterReloadToken,
  () => {
    void load();
  },
);
watch(
  () => ui.detailsOpen,
  async () => {
    applyDetailsPref();
    await nextTick();
    await renderMermaidIn(contentEl.value);
    activateFigmaEmbedsIn(contentEl.value);
    activateOpenApiEmbedsIn(contentEl.value, props.bookId);
    enhanceTableRulerColIn(contentEl.value, props.toc);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  unbindOpenApi?.();
  unbindOpenApi = null;
  diagramHtml.value = '';
});

function onContentClick(e: MouseEvent): void {
  const diagram = diagramZoomTarget(e.target);
  if (!diagram) return;
  e.preventDefault();
  diagramHtml.value = cloneDiagramHtml(diagram);
}

function headingTag(level: number): string {
  return `h${Math.min(Math.max(level, 1), 6)}`;
}
</script>

<template>
  <div class="chapter-wrap digest-wrap">
    <article ref="contentEl" class="page-card digest-card" @click="onContentClick">
      <div v-if="error" class="error-box">
        加载失败：{{ error }}
        <button class="btn" @click="load()">重试</button>
      </div>
      <template v-else>
        <div v-if="loading && blocksEmpty" class="muted">加载汇总…</div>
        <div v-else-if="!loading && blocksEmpty" class="muted">
          当前透镜下没有可见小节。
        </div>
        <template v-for="(g, gi) in groups" :key="g.axis?.id ?? `g-${gi}`">
          <component
            v-if="g.axis"
            :is="headingTag(g.axis.level)"
            :id="g.axis.id"
            class="digest-heading"
            :data-outline-num="g.axis.number || undefined"
            :class="{ 'outline-numbered': !!g.axis.number }"
            :style="outlineNumStyle(g.axis.number)"
          >
            {{ g.axis.title }}
          </component>
          <div
            v-for="block in g.modules"
            :key="(g.axis?.id ?? '') + '-' + block.page.chapterId"
            class="digest-group"
          >
            <component
              :is="headingTag(h.level)"
              v-for="h in block.pathHeadings"
              :id="h.id"
              :key="h.id"
              class="digest-heading"
              :data-outline-num="h.number || undefined"
              :class="{ 'outline-numbered': !!h.number }"
              :style="outlineNumStyle(h.number)"
            >
              {{ h.title }}
            </component>
            <component
              :is="headingTag(block.page.level)"
              :id="block.page.pageId"
              class="digest-heading"
              :data-outline-num="block.page.number || undefined"
              :class="{ 'outline-numbered': !!block.page.number }"
              :style="outlineNumStyle(block.page.number)"
            >
              {{ block.page.title }}
            </component>
            <SectionBlock
              v-for="s in block.page.sections"
              :id="s.anchorId"
              :key="s.anchorId"
              :book-id="bookId"
              :chapter-id="s.chapter.id"
              :section="s.section"
              :lens-leaves="leavesFor(s.chapter, s.section.id)"
              :lens-titles="titlesFor(s.chapter)"
              :lens-colors="lensColors"
              :lens-chrome="lensChrome"
              :cluster="null"
              :outline-number="s.number"
            />
          </div>
        </template>
      </template>
    </article>

    <DiagramLightbox v-if="diagramHtml" :html="diagramHtml" @close="diagramHtml = ''" />
  </div>
</template>
