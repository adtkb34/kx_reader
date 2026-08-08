<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import {
  renderChapter,
  extractSectionFragment,
  joinSectionFragments,
  type RenderedSection,
} from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel } from '@/stores/ui';
import {
  lensColorMap,
  lensNodeTitle,
  sectionClusterRole,
  sectionLensLeaves,
  selectionLegendLeaves,
} from '@shared/lenses';
import {
  buildRulerPreamble,
  buildRulerTree,
  findRulerModuleIndexId,
  rulerAnchorId,
  type RulerKeyBlock,
} from '@shared/ruler';
import { filterRulerKeysBySelection } from '@shared/outlineKeys';
import { outlineNumbers } from '@shared/outlineNumbers';
import type { BookToc, LensSelection, PageLayer, TocChapter } from '@shared/types';

const props = defineProps<{
  bookId: string;
  toc: BookToc;
  lensSelection?: LensSelection | null;
  /** Current route chapter — scopes keys to that module's ruler index. */
  focusChapterId?: string | null;
  /** Selected ruler-key section ids; omit / empty = show all keys. */
  outlineKeyIds?: string[];
}>();

interface SectionHit {
  chapter: TocChapter;
  section: RenderedSection;
}

interface RulerKeyView {
  key: RulerKeyBlock;
  body: SectionHit | null;
  groups: {
    leaf: PageLayer | null;
    leafTitle: string;
    blocks: SectionHit[];
  }[];
}

const preamble = ref<SectionHit[]>([]);
const views = ref<RulerKeyView[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
const diagramHtml = ref('');
let unbindMermaid: (() => void) | null = null;

const readerShowLevel = computed(() => getBookShowLevel(props.bookId));
const focusIndexId = computed(() => {
  if (!props.focusChapterId) return null;
  return findRulerModuleIndexId(props.toc, props.focusChapterId) ?? props.focusChapterId;
});

const moduleTitle = computed(() => {
  const id = focusIndexId.value;
  if (!id) return '';
  return props.toc.chapters.find((c) => c.id === id)?.title ?? '';
});
const tree = computed(() => {
  const full =
    buildRulerTree(
      props.toc,
      props.lensSelection ?? null,
      readerShowLevel.value,
      focusIndexId.value,
    ) ?? [];
  return filterRulerKeysBySelection(full, props.outlineKeyIds ?? []);
});
const preambleSpec = computed(() =>
  buildRulerPreamble(
    props.toc,
    props.lensSelection ?? null,
    readerShowLevel.value,
    focusIndexId.value,
  ),
);

const activeLeaves = computed(
  () => new Set(selectionLegendLeaves(props.toc, props.lensSelection ?? null).map((i) => i.id)),
);

const lensChrome = computed(() => activeLeaves.value.size > 1);
const lensColors = computed(() => lensColorMap(props.toc));

/** Composite key so the same section id across chapters stays unique. */
function outlineKey(chapterId: string, sectionId: string): string {
  return `${chapterId}#${sectionId}`;
}

/**
 * Stable numbers from the module index.md section order (not the filtered
 * visible set — unchecking a sibling must not renumber the rest).
 */
const outlineNumMap = computed(() => {
  const id = focusIndexId.value;
  if (!id) return new Map<string, string>();
  const ch = props.toc.chapters.find((c) => c.id === id);
  if (!ch) return new Map<string, string>();
  const items = ch.sections
    .filter((s) => s.title)
    .map((s) => ({ id: outlineKey(ch.id, s.id), level: s.level }));
  return outlineNumbers(items);
});

function outlineNum(chapterId: string, sectionId: string): string {
  return outlineNumMap.value.get(outlineKey(chapterId, sectionId)) ?? '';
}

function outlineStyle(chapterId: string, sectionId: string): Record<string, string> | undefined {
  const n = outlineNum(chapterId, sectionId);
  if (!n) return undefined;
  return { '--outline-num': `"${n}"` };
}

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
  loading.value = true;
  error.value = '';
  unbindMermaid?.();
  unbindMermaid = null;
  try {
    const keys = tree.value;
    const pre = preambleSpec.value;
    if (keys.length === 0 && pre.length === 0) {
      views.value = [];
      preamble.value = [];
      return;
    }

    const chapterIds = new Set<string>();
    for (const p of pre) chapterIds.add(p.chapterId);
    for (const k of keys) {
      chapterIds.add(k.chapterId);
      for (const g of k.groups) {
        for (const b of g.blocks) chapterIds.add(b.chapterId);
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

    preamble.value = pre.flatMap((p) => {
      const ch = chapterById.get(p.chapterId);
      if (!ch) return [];
      return fragments(p.chapterId, p.sectionIds).map((section) => ({ chapter: ch, section }));
    });

    views.value = keys.map((key) => {
      const bodyIds = key.bodySectionIds.length ? key.bodySectionIds : [key.sectionId];
      const body = hitJoined(key.chapterId, bodyIds, key.sectionId, key.title, key.level);

      const groups = key.groups.map((g) => {
        // Merge consecutive table-row fragments (header + field rows) into one table.
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
            blocks.push({ chapter: start.chapter, section: start.section });
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
          if (joined) blocks.push({ chapter: start.chapter, section: joined });
          i = j;
        }

        return {
          leaf: g.leaf,
          leafTitle: g.leafTitle,
          blocks,
        };
      });

      return { key, body, groups };
    });

    await nextTick();
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    views.value = [];
    preamble.value = [];
  } finally {
    loading.value = false;
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
      JSON.stringify(
        tree.value.map((k) => [
          k.sectionId,
          k.bodySectionIds,
          k.groups.map((g) => g.blocks.map((b) => b.sectionId)),
        ]),
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
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
  diagramHtml.value = '';
});

function onContentClick(e: MouseEvent): void {
  const diagram = diagramZoomTarget(e.target);
  if (!diagram) return;
  e.preventDefault();
  diagramHtml.value = cloneDiagramHtml(diagram);
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
        <h1 v-if="moduleTitle" class="chapter-title">{{ moduleTitle }}</h1>
        <div v-if="loading && views.length === 0 && preamble.length === 0" class="muted">
          加载尺子…
        </div>
        <div v-else-if="!loading && views.length === 0 && preamble.length === 0" class="muted">
          当前透镜下没有可见的尺子键。请勾选尺子维度（如流程）及要挂靠的内容维度。
        </div>
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
          :outline-number="outlineNum(hit.chapter.id, hit.section.id)"
        />
        <div v-for="v in views" :key="v.key.sectionId" class="ruler-key">
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
            :outline-number="outlineNum(v.body.chapter.id, v.body.section.id)"
          />
          <div
            v-else
            :id="rulerAnchorId(v.key.chapterId, v.key.sectionId)"
            class="ruler-key-title"
            :class="{ 'outline-numbered': !!outlineNum(v.key.chapterId, v.key.sectionId) }"
            :style="outlineStyle(v.key.chapterId, v.key.sectionId)"
          >
            {{ v.key.title }}
          </div>
          <div
            v-for="(g, gi) in v.groups"
            :key="`${v.key.sectionId}-${g.leaf ?? 'x'}-${gi}`"
            class="ruler-dim-group"
          >
            <div v-if="g.leafTitle && g.blocks.length" class="ruler-dim-title">{{ g.leafTitle }}</div>
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
              :outline-number="outlineNum(hit.chapter.id, hit.section.id)"
            />
          </div>
        </div>
      </template>
    </article>

    <DiagramLightbox v-if="diagramHtml" :html="diagramHtml" @close="diagramHtml = ''" />
  </div>
</template>
