<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import { renderChapter, splitSections, type RenderedSection } from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { activateFigmaEmbedsIn, bindFigmaEmbedDetails } from '@/figmaEmbed';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableRulerColIn } from '@/tableRulerCol';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel } from '@/stores/ui';
import {
  digestAnchorId,
  filterChapters,
  filterSectionsByAllowlist,
  filterSectionsByShowLevel,
  groupChaptersForDigest,
  lensColorMap,
  lensNodeTitle,
  sectionAllowlistFor,
  sectionLensLeaves,
  selectionLegendLeaves,
} from '@shared/lenses';
import type { BookToc, LensSelection, PageLayer, TocChapter } from '@shared/types';

const props = defineProps<{
  bookId: string;
  toc: BookToc;
  lensSelection?: LensSelection | null;
}>();

interface DigestPage {
  chapter: TocChapter;
  title: string;
  sections: RenderedSection[];
}

interface DigestGroupView {
  groupTitle: string | null;
  pages: DigestPage[];
}

const groups = ref<DigestGroupView[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
const diagramHtml = ref('');
let unbindMermaid: (() => void) | null = null;
let unbindFigma: (() => void) | null = null;

const visibleChapters = computed(() =>
  filterChapters(props.toc.chapters, props.lensSelection ?? null, props.toc),
);

const activeLeaves = computed(
  () => new Set(selectionLegendLeaves(props.toc, props.lensSelection ?? null).map((i) => i.id)),
);

const lensChrome = computed(() => activeLeaves.value.size > 1);

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

const lensColors = computed(() => lensColorMap(props.toc));

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  try {
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
        const sections = filterSectionsByShowLevel(
          filterSectionsByAllowlist(splitSections(html), allow),
          ch,
          getBookShowLevel(props.bookId),
        );
        return {
          chapter: ch,
          title: content.title || ch.title,
          sections,
        } satisfies DigestPage;
      }),
    );

    const byId = new Map(loaded.map((p) => [p.chapter.id, p]));
    const structure = groupChaptersForDigest(props.toc, chapters);
    groups.value = structure
      .map((g) => ({
        groupTitle: g.groupTitle,
        pages: g.pages
          .map((ch) => byId.get(ch.id))
          .filter((p): p is DigestPage => !!p && p.sections.length > 0),
      }))
      .filter((g) => g.pages.length > 0);

    await nextTick();
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    unbindFigma = bindFigmaEmbedDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    activateFigmaEmbedsIn(contentEl.value);
    enhanceTableRulerColIn(contentEl.value, props.toc);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    groups.value = [];
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
      visibleChapters.value.map((c) => c.id).join(','),
      getBookShowLevel(props.bookId),
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
  <div class="chapter-wrap digest-wrap">
    <article ref="contentEl" class="page-card digest-card" @click="onContentClick">
      <div v-if="error" class="error-box">
        加载失败：{{ error }}
        <button class="btn" @click="load()">重试</button>
      </div>
      <template v-else>
        <div v-if="loading && groups.length === 0" class="muted">加载汇总…</div>
        <div v-else-if="!loading && groups.length === 0" class="muted">
          当前透镜下没有可见小节。
        </div>
        <div v-for="(g, gi) in groups" :key="g.groupTitle ?? `ungrouped-${gi}`" class="digest-group">
          <h1 v-if="g.groupTitle" class="digest-group-title">{{ g.groupTitle }}</h1>
          <div v-for="page in g.pages" :key="page.chapter.id" class="digest-page">
            <h1 v-if="!g.groupTitle" class="digest-group-title">{{ page.title }}</h1>
            <h2 v-else class="digest-page-title">{{ page.title }}</h2>
            <SectionBlock
              v-for="(s, i) in page.sections"
              :id="digestAnchorId(page.chapter.id, s.id)"
              :key="page.chapter.id + '#' + s.id"
              :book-id="bookId"
              :chapter-id="page.chapter.id"
              :section="s"
              :lens-leaves="leavesFor(page.chapter, s.id)"
              :lens-titles="titlesFor(page.chapter)"
              :lens-colors="lensColors"
              :lens-chrome="lensChrome"
              :cluster="null"
            />
          </div>
        </div>
      </template>
    </article>

    <DiagramLightbox v-if="diagramHtml" :html="diagramHtml" @close="diagramHtml = ''" />
  </div>
</template>
