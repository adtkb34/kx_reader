<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import {
  renderChapter,
  extractSectionFragment,
  joinSectionFragments,
  shiftHeadingLevels,
  type RenderedSection,
} from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { activateFigmaEmbedsIn, bindFigmaEmbedDetails } from '@/figmaEmbed';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { enhanceTableRulerColIn } from '@/tableRulerCol';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel, getBookRulerPick } from '@/stores/ui';
import {
  lensColorMap,
  lensNodeTitle,
  lensQueryFromSelection,
  sectionClusterRole,
  sectionLensLeaves,
  selectionLegendLeaves,
} from '@shared/lenses';
import {
  assembleModuleView,
  axisBucketAnchorId,
  filterRulerAssembleView,
  filterRulerOutlineEntries,
  findLeafModule,
  findRulerModuleIndexId,
  normalizeRulerPick,
  rulerAnchorId,
  rulerOutlineEntries,
  type RulerKeyBlock,
  type RulerTickHangFilter,
} from '@shared/ruler';
import { outlineNumbers } from '@shared/outlineNumbers';
import { filterRulerKeysBySelection, expandOutlineKeySelection } from '@shared/outlineKeys';
import type { BookToc, LensSelection, PageLayer, TocChapter } from '@shared/types';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';

const props = defineProps<{
  bookId: string;
  toc: BookToc;
  chapterId: string;
  prevChapter: TocChapter | null;
  nextChapter: TocChapter | null;
  lensSelection?: LensSelection | null;
  /** Selected ruler-key section ids; omit = show all keys. */
  outlineKeyIds?: string[];
}>();

const emit = defineEmits<{
  outline: [rows: DigestOutlineRow[]];
}>();

const router = useRouter();

interface SectionHit {
  chapter: TocChapter;
  section: RenderedSection;
}

interface KeyView {
  key: RulerKeyBlock;
  body: SectionHit | null;
  groups: {
    leaf: PageLayer | null;
    leafTitle: string;
    blocks: SectionHit[];
  }[];
}

interface BucketView {
  leaf: PageLayer | null;
  leafTitle: string;
  keys: KeyView[];
}

const preamble = ref<SectionHit[]>([]);
const buckets = ref<BucketView[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
const diagramHtml = ref('');
let unbindMermaid: (() => void) | null = null;
let unbindFigma: (() => void) | null = null;
let loadGen = 0;

const readerShowLevel = computed(() => getBookShowLevel(props.bookId));
const rulerPick = computed(() =>
  normalizeRulerPick(props.toc, getBookRulerPick(props.bookId)),
);
const focusIndexId = computed(() => {
  return findRulerModuleIndexId(props.toc, props.chapterId) ?? props.chapterId;
});
const leafModule = computed(() => findLeafModule(props.toc, props.chapterId));
/** Leaf-directory title (e.g. 工艺定义), falling back to index chapter title. */
const pageTitle = computed(() => {
  if (leafModule.value?.title) return leafModule.value.title;
  const ch = props.toc.chapters.find((c) => c.id === focusIndexId.value);
  return ch?.title ?? '';
});
const hangFilter = computed(
  (): RulerTickHangFilter => ui.lensContentFilter as RulerTickHangFilter,
);
const assemble = computed(() => {
  const raw = assembleModuleView(
    props.toc,
    props.lensSelection ?? null,
    readerShowLevel.value,
    focusIndexId.value,
    rulerPick.value,
  );
  if (!raw) return null;
  const filtered = filterRulerAssembleView(
    props.toc,
    props.lensSelection ?? null,
    readerShowLevel.value,
    raw,
    hangFilter.value,
  );
  if (props.outlineKeyIds == null) return filtered;
  return {
    ...filtered,
    buckets: filtered.buckets.map((b) => ({
      ...b,
      keys: filterRulerKeysBySelection(b.keys, props.outlineKeyIds),
    })),
  };
});

/** Outline numbers from assembled module structure (keys + titled hang-offs + axis buckets). */
const outlineNumMap = computed(() => {
  const entries = filterRulerOutlineEntries(
    props.toc,
    props.lensSelection ?? null,
    readerShowLevel.value,
    rulerOutlineEntries(
      props.toc,
      props.lensSelection ?? null,
      readerShowLevel.value,
      focusIndexId.value,
      rulerPick.value,
    ),
    hangFilter.value,
  );
  const items = entries
    .filter((e) => e.title)
    .map((e) => ({
      id: e.anchorId ?? e.sectionId,
      level: e.level,
    }));
  // First occurrence wins when the same id appears twice.
  return outlineNumbers(items);
});

function outlineNum(id: string): string {
  return outlineNumMap.value.get(id) ?? '';
}

function outlineNumStyle(num: string): Record<string, string> | undefined {
  if (!num) return undefined;
  return { '--outline-num': `"${num}"` };
}

/** Under an axis ruler, demote section headings one level beneath the leaf (Px…) title. */
function demoteForAxis(section: RenderedSection, axisActive: boolean): RenderedSection {
  if (!axisActive) return section;
  return {
    ...section,
    level: Math.min(section.level + 1, 6),
    html: shiftHeadingLevels(section.html, 1),
  };
}

function emitSyncedOutline(): void {
  const entries = filterRulerOutlineEntries(
    props.toc,
    props.lensSelection ?? null,
    readerShowLevel.value,
    rulerOutlineEntries(
      props.toc,
      props.lensSelection ?? null,
      readerShowLevel.value,
      focusIndexId.value,
      rulerPick.value,
    ),
    hangFilter.value,
  );
  const keyItems = entries
    .filter((e) => e.isKey && e.title && !e.anchorId?.startsWith('ruler-bucket-'))
    .map((e) => ({ id: e.sectionId, level: e.level }));
  const visible =
    props.outlineKeyIds == null
      ? null
      : new Set(expandOutlineKeySelection(keyItems, props.outlineKeyIds));

  const list: typeof entries = [];
  let keyVisible = true;
  for (const e of entries) {
    if (!e.title) continue;
    if (e.isKey) {
      keyVisible = visible == null || visible.has(e.sectionId);
      if (visible == null || e.anchorId?.startsWith('ruler-bucket-') || visible.has(e.sectionId)) {
        list.push(e);
      }
      continue;
    }
    if (keyVisible) list.push(e);
  }

  const nums = outlineNumbers(
    list.map((e) => ({
      id: e.anchorId ?? e.sectionId,
      level: e.level,
    })),
  );
  emit(
    'outline',
    list.map((e) => {
      const id = e.anchorId ?? rulerAnchorId(e.chapterId, e.sectionId);
      const numKey = e.anchorId ?? e.sectionId;
      return {
        id,
        title: e.title,
        level: e.level,
        number: nums.get(numKey) ?? '',
        chapterId: e.chapterId,
        sectionId: e.sectionId,
        isKey: e.isKey,
        leafTitle: e.leafTitle,
      };
    }),
  );
}

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

function clusterFor(_chapter: TocChapter, section: RenderedSection, index: number) {
  if (!lensChrome.value) return null;
  return sectionClusterRole(section, index);
}

async function load(): Promise<void> {
  const gen = ++loadGen;
  loading.value = true;
  error.value = '';
  buckets.value = [];
  preamble.value = [];
  emit('outline', []);
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  try {
    const view = assemble.value;
    if (!view || (view.buckets.every((b) => b.keys.length === 0) && view.preamble.length === 0)) {
      if (gen !== loadGen) return;
      buckets.value = [];
      preamble.value = [];
      emit('outline', []);
      return;
    }

    const chapterIds = new Set<string>();
    for (const p of view.preamble) chapterIds.add(p.chapterId);
    for (const bucket of view.buckets) {
      for (const k of bucket.keys) {
        chapterIds.add(k.chapterId);
        for (const g of k.groups) {
          for (const b of g.blocks) chapterIds.add(b.chapterId);
        }
      }
    }

    const fileToChapter: Record<string, string> = {};
    for (const c of props.toc.chapters) {
      fileToChapter[c.file] = c.id;
      const base = c.file.split('/').pop();
      if (base) fileToChapter[base] = c.id;
    }

    const chapterHtml = new Map<string, string>();
    const chapterById = new Map(props.toc.chapters.map((c) => [c.id, c]));

    await Promise.all(
      [...chapterIds].map(async (id) => {
        const content = await api.chapter(props.bookId, id);
        const html = renderChapter(content.markdown, {
          bookId: props.bookId,
          fileToChapter,
        });
        chapterHtml.set(id, html);
      }),
    );
    if (gen !== loadGen) return;

    function fragments(chapterId: string, sectionIds: string[]): RenderedSection[] {
      const html = chapterHtml.get(chapterId);
      if (!html) return [];
      return sectionIds
        .map((id) => extractSectionFragment(html, id))
        .filter((s): s is RenderedSection => !!s);
    }

    function hitJoined(
      chapterId: string,
      sectionIds: string[],
      id: string,
      title: string,
      level: number,
    ): SectionHit | null {
      const ch = chapterById.get(chapterId);
      if (!ch) return null;
      const parts = fragments(chapterId, sectionIds);
      const section = joinSectionFragments(parts, id, title, level);
      if (!section) return null;
      return { chapter: ch, section };
    }

    preamble.value = view.preamble.flatMap((p) => {
      const ch = chapterById.get(p.chapterId);
      if (!ch) return [];
      return fragments(p.chapterId, p.sectionIds).map((section) => ({ chapter: ch, section }));
    });

    const axisActive = rulerPick.value !== 'index';

    buckets.value = view.buckets.map((bucket) => ({
      leaf: bucket.leaf,
      leafTitle: bucket.leafTitle,
      keys: bucket.keys.map((key) => {
        const bodyIds = key.bodySectionIds.length ? key.bodySectionIds : [key.sectionId];
        const bodyHit = hitJoined(key.chapterId, bodyIds, key.sectionId, key.title, key.level);
        const body = bodyHit
          ? {
              chapter: bodyHit.chapter,
              section: demoteForAxis(bodyHit.section, axisActive),
            }
          : null;

        const groups = key.groups.map((g) => {
          const raw = g.blocks
            .map((b) => {
              const ch = chapterById.get(b.chapterId);
              const html = chapterHtml.get(b.chapterId);
              if (!ch || !html) return null;
              const section = extractSectionFragment(html, b.sectionId);
              if (!section) return null;
              return { chapter: ch, section, chapterId: b.chapterId } as const;
            })
            .filter((h): h is NonNullable<typeof h> => !!h);

          const blocks: SectionHit[] = [];
          let i = 0;
          while (i < raw.length) {
            const start = raw[i]!;
            const isTable = /^\s*<table[\s>]/i.test(start.section.html);
            if (!isTable) {
              blocks.push({
                chapter: start.chapter,
                section: demoteForAxis(start.section, axisActive),
              });
              i += 1;
              continue;
            }
            const run = [start];
            let j = i + 1;
            while (j < raw.length && /^\s*<table[\s>]/i.test(raw[j]!.section.html)) {
              run.push(raw[j]!);
              j += 1;
            }
            const joined = joinSectionFragments(
              run.map((r) => r.section),
              start.section.id,
              start.section.title,
              start.section.level,
            );
            if (joined) {
              blocks.push({
                chapter: start.chapter,
                section: demoteForAxis(joined, axisActive),
              });
            }
            i = j;
          }

          return {
            leaf: g.leaf,
            leafTitle: g.leafTitle,
            blocks,
          };
        });

        return { key, body, groups };
      }),
    }));

    emitSyncedOutline();
    await nextTick();
    if (gen !== loadGen) return;
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    unbindFigma = bindFigmaEmbedDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    if (gen !== loadGen) return;
    activateFigmaEmbedsIn(contentEl.value);
    enhanceTableRulerColIn(contentEl.value, props.toc);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  } catch (e) {
    if (gen !== loadGen) return;
    error.value = e instanceof Error ? e.message : String(e);
    buckets.value = [];
    preamble.value = [];
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
      props.chapterId,
      rulerPick.value,
      JSON.stringify(props.lensSelection ?? null),
      readerShowLevel.value,
      JSON.stringify(
        assemble.value?.buckets.map((b) => [
          b.leaf,
          b.keys.map((k) => [
            k.sectionId,
            k.bodySectionIds,
            k.groups.map((g) => g.blocks.map((x) => x.sectionId)),
          ]),
        ]) ?? null,
      ),
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
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  diagramHtml.value = '';
});

function onContentClick(e: MouseEvent): void {
  const diagram = diagramZoomTarget(e.target);
  if (!diagram) return;
  e.preventDefault();
  diagramHtml.value = cloneDiagramHtml(diagram);
}

const empty = computed(
  () =>
    !loading.value &&
    buckets.value.every((b) => b.keys.length === 0) &&
    preamble.value.length === 0,
);

function go(ch: TocChapter | null): void {
  if (!ch) return;
  const query = lensQueryFromSelection(props.lensSelection ?? null, props.toc);
  router.push({ path: `/books/${props.bookId}/${ch.id}`, query });
}
</script>

<template>
  <div class="chapter-wrap digest-wrap ruler-wrap">
    <article ref="contentEl" class="page-card digest-card ruler-card" @click="onContentClick">
      <div v-if="error" class="error-box">
        加载失败：{{ error }}
        <button class="btn" @click="load()">重试</button>
      </div>
      <template v-else>
        <div v-if="loading && empty" class="muted">加载模块…</div>
        <div v-else-if="empty" class="muted">当前透镜下没有可见内容。</div>
        <template v-else>
          <h1 v-if="pageTitle" class="chapter-title">{{ pageTitle }}</h1>
          <SectionBlock
            v-for="hit in preamble"
            :id="rulerAnchorId(hit.chapter.id, hit.section.id)"
            :key="'pre-' + hit.chapter.id + '#' + hit.section.id"
            :book-id="bookId"
            :chapter-id="hit.chapter.id"
            :section="hit.section"
            :lens-leaves="leavesFor(hit.chapter, hit.section.id)"
            :lens-titles="titlesFor(hit.chapter)"
            :lens-colors="lensColors"
            :lens-chrome="false"
            :cluster="null"
            :outline-number="outlineNum(hit.section.id)"
          />
          <div
            v-for="bucket in buckets"
            :id="bucket.leaf ? axisBucketAnchorId(bucket.leaf) : undefined"
            :key="bucket.leaf ?? 'index'"
            class="ruler-bucket"
          >
            <h2
              v-if="bucket.leafTitle && bucket.leaf"
              class="ruler-bucket-title digest-heading"
              :class="{
                'outline-numbered': !!outlineNum(axisBucketAnchorId(bucket.leaf)),
              }"
              :data-outline-num="outlineNum(axisBucketAnchorId(bucket.leaf)) || undefined"
              :style="outlineNumStyle(outlineNum(axisBucketAnchorId(bucket.leaf)))"
            >
              {{ bucket.leafTitle }}
            </h2>
            <div
              v-for="v in bucket.keys"
              :key="v.key.sectionId"
              class="ruler-key"
              :data-ruler-key-id="v.key.sectionId"
            >
              <SectionBlock
                v-if="v.body"
                :id="rulerAnchorId(v.body.chapter.id, v.body.section.id)"
                :book-id="bookId"
                :chapter-id="v.body.chapter.id"
                :section="v.body.section"
                :lens-leaves="leavesFor(v.body.chapter, v.body.section.id)"
                :lens-titles="titlesFor(v.body.chapter)"
                :lens-colors="lensColors"
                :lens-chrome="lensChrome"
                :cluster="clusterFor(v.body.chapter, v.body.section, 0)"
                :outline-number="outlineNum(v.body.section.id)"
              />
              <div
                v-else
                :id="rulerAnchorId(v.key.chapterId, v.key.sectionId)"
                class="ruler-key-title outline-numbered"
                :data-outline-num="outlineNum(v.key.sectionId) || undefined"
                :style="outlineNumStyle(outlineNum(v.key.sectionId))"
              >
                {{ v.key.title }}
              </div>
              <div
                v-for="(g, gi) in v.groups"
                :key="`${v.key.sectionId}-${g.leaf ?? 'x'}-${gi}`"
                class="ruler-dim-group"
              >
                <SectionBlock
                  v-for="(hit, i) in g.blocks"
                  :id="rulerAnchorId(hit.chapter.id, hit.section.id)"
                  :key="hit.chapter.id + '#' + hit.section.id + '-' + i"
                  :book-id="bookId"
                  :chapter-id="hit.chapter.id"
                  :section="hit.section"
                  :lens-leaves="leavesFor(hit.chapter, hit.section.id)"
                  :lens-titles="titlesFor(hit.chapter)"
                  :lens-colors="lensColors"
                  :lens-chrome="false"
                  :cluster="null"
                  :outline-number="outlineNum(hit.section.id)"
                />
              </div>
            </div>
          </div>
        </template>
      </template>
    </article>

    <nav class="pager">
      <button class="pager-btn" :disabled="!prevChapter" @click="go(prevChapter)">
        <span class="pager-dir">‹ 上一模块</span>
        <span class="pager-title">{{ prevChapter?.title ?? '—' }}</span>
      </button>
      <button class="pager-btn next" :disabled="!nextChapter" @click="go(nextChapter)">
        <span class="pager-dir">下一模块 ›</span>
        <span class="pager-title">{{ nextChapter?.title ?? '—' }}</span>
      </button>
    </nav>

    <DiagramLightbox v-if="diagramHtml" :html="diagramHtml" @close="diagramHtml = ''" />
  </div>
</template>
