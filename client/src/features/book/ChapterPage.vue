<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElImageViewer } from 'element-plus';
import { api } from '@/api/client';
import { tocOf } from '@/stores/books';
import { renderChapter, splitSections, type RenderedSection } from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { activateFigmaEmbedsIn, bindFigmaEmbedDetails } from '@/figmaEmbed';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel, setLensContentFilter } from '@/stores/ui';
import {
  chapterHasVisibleLensSections,
  filterSectionsByAllowlist,
  filterSectionsByShowLevel,
  lensColorMap,
  lensNodeTitle,
  pageVisibleInSelection,
  sectionAllowlistFor,
  sectionLensLeaves,
  selectionLegendLeaves,
  selectionToFlatIds,
} from '@shared/lenses';
import { outlineNumbers } from '@shared/outlineNumbers';
import type { LensSelection, PageLayer, TocChapter } from '@shared/types';

const props = defineProps<{
  bookId: string;
  chapterId: string;
  prevChapter: TocChapter | null;
  nextChapter: TocChapter | null;
  lensSelection?: LensSelection | null;
}>();

const route = useRoute();
const router = useRouter();

const title = ref('');
const sections = ref<RenderedSection[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
const previewVisible = ref(false);
const previewUrlList = ref<string[]>([]);
const previewIndex = ref(0);
const diagramHtml = ref('');
let unbindMermaid: (() => void) | null = null;
let unbindFigma: (() => void) | null = null;
/** Ignore stale async load results when chapter/lens changes mid-flight. */
let loadSeq = 0;
/** Chapter id whose `title` / `sections` currently match the DOM. */
const loadedChapterId = ref('');

const tocChapter = computed(() =>
  tocOf(props.bookId)?.chapters.find((c) => c.id === props.chapterId),
);

/** Chapter metadata for the body currently on screen (may lag the route while loading). */
const displayChapter = computed(() => {
  const toc = tocOf(props.bookId);
  const id = loadedChapterId.value || props.chapterId;
  return toc?.chapters.find((c) => c.id === id) ?? null;
});

/** Title follows rendered body — never show a new TOC name over old sections. */
const pageTitle = computed(() => {
  if (loadedChapterId.value && title.value) return title.value;
  return tocChapter.value?.title || '';
});

/** True once load finished with no sections under「仅有内容」. */
const lensEmptyState = computed(
  () =>
    !loading.value &&
    !error.value &&
    sections.value.length === 0 &&
    !!loadedChapterId.value &&
    loadedChapterId.value === props.chapterId &&
    ui.lensContentFilter === 'content',
);

/** Current page has content but「仅无内容」hides it. */
const lensHasContentHiddenState = computed(() => {
  if (loading.value || error.value || ui.lensContentFilter !== 'empty') return false;
  if (!loadedChapterId.value || loadedChapterId.value !== props.chapterId) return false;
  const toc = tocOf(props.bookId);
  const ch = tocChapter.value;
  const sel = props.lensSelection ?? null;
  if (!toc || !ch || !sel || selectionToFlatIds(toc, sel).length === 0) return false;
  return chapterHasVisibleLensSections(ch, sel, toc, getBookShowLevel(props.bookId));
});

const contentFilterBlocked = computed(
  () => lensEmptyState.value || lensHasContentHiddenState.value,
);

const activeLeaves = computed(() => {
  const toc = tocOf(props.bookId);
  if (!toc) return new Set<PageLayer>();
  return new Set(selectionLegendLeaves(toc, props.lensSelection ?? null).map((i) => i.id));
});

const lensChrome = computed(() => activeLeaves.value.size > 1);

const lensTitleMap = computed(() => {
  const toc = tocOf(props.bookId);
  const ch = displayChapter.value;
  if (!toc || !ch?.sectionAllowlists) return {} as Record<string, string>;
  const map: Record<string, string> = {};
  for (const byLeaf of Object.values(ch.sectionAllowlists)) {
    for (const leaf of Object.keys(byLeaf ?? {})) {
      map[leaf] = lensNodeTitle(toc, leaf);
    }
  }
  return map;
});

const lensColors = computed(() => {
  const toc = tocOf(props.bookId);
  return toc ? lensColorMap(toc) : {};
});

/**
 * Stable numbers from chapter TOC section order (not the filtered visible set —
 * hiding a sibling must not renumber the rest).
 */
const outlineNumMap = computed(() => {
  const ch = displayChapter.value;
  if (!ch) return new Map<string, string>();
  const items = ch.sections
    .filter((s) => s.title)
    .map((s) => ({ id: s.id, level: s.level }));
  return outlineNumbers(items);
});

function outlineNum(sectionId: string): string {
  return outlineNumMap.value.get(sectionId) ?? '';
}

function leavesFor(sectionId: string): PageLayer[] {
  const toc = tocOf(props.bookId);
  const ch = displayChapter.value;
  if (!toc || !ch) return [];
  return sectionLensLeaves(ch, sectionId, toc);
}

async function load(): Promise<void> {
  const seq = ++loadSeq;
  const reqBookId = props.bookId;
  const reqChapterId = props.chapterId;
  const reqLens = props.lensSelection ?? null;
  const reqShowLevel = getBookShowLevel(reqBookId);

  loading.value = true;
  error.value = '';
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  previewVisible.value = false;
  diagramHtml.value = '';
  // Keep the previous body visible until the next chapter is ready (avoids blank flash).
  try {
    const chapter = await api.chapter(reqBookId, reqChapterId);
    if (seq !== loadSeq) return;
    title.value = chapter.title;
    const toc = tocOf(reqBookId);
    const fileToChapter: Record<string, string> = {};
    for (const c of toc?.chapters ?? []) {
      fileToChapter[c.file] = c.id;
      const base = c.file.split('/').pop();
      if (base) fileToChapter[base] = c.id;
    }
    const html = renderChapter(chapter.markdown, { bookId: reqBookId, fileToChapter });
    const chapterMeta = toc?.chapters.find((c) => c.id === reqChapterId);
    const contentOnly =
      ui.lensContentFilter === 'content' &&
      !!toc &&
      selectionToFlatIds(toc, reqLens).length > 0;
    const emptyOnly =
      ui.lensContentFilter === 'empty' &&
      !!toc &&
      selectionToFlatIds(toc, reqLens).length > 0;
    let nextSections: RenderedSection[];
    if (
      contentOnly &&
      chapterMeta &&
      (!chapterMeta.layers || !pageVisibleInSelection(chapterMeta, reqLens, toc))
    ) {
      nextSections = [];
    } else if (emptyOnly && chapterMeta) {
      // 「仅无内容」: hide pages that already have lens content; otherwise show raw body.
      if (chapterHasVisibleLensSections(chapterMeta, reqLens, toc, reqShowLevel)) {
        nextSections = [];
      } else {
        nextSections = filterSectionsByShowLevel(
          splitSections(html),
          chapterMeta,
          reqShowLevel,
        );
      }
    } else {
      const allow = chapterMeta ? sectionAllowlistFor(chapterMeta, reqLens, toc) : null;
      nextSections = filterSectionsByShowLevel(
        filterSectionsByAllowlist(splitSections(html), allow),
        chapterMeta,
        reqShowLevel,
      );
    }
    if (seq !== loadSeq) return;
    // Swap title + body together once the new chapter is ready.
    sections.value = nextSections;
    loadedChapterId.value = reqChapterId;
    await nextTick();
    if (seq !== loadSeq) return;
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    unbindFigma = bindFigmaEmbedDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    activateFigmaEmbedsIn(contentEl.value);
    if (seq !== loadSeq) return;
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
    if (route.hash) scrollToHash(route.hash);
    else window.scrollTo({ top: 0 });
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = e instanceof Error ? e.message : String(e);
    sections.value = [];
    loadedChapterId.value = reqChapterId;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(
  () =>
    [
      props.bookId,
      props.chapterId,
      JSON.stringify(props.lensSelection ?? null),
      getBookShowLevel(props.bookId),
      ui.lensContentFilter,
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
  () => route.hash,
  (h) => {
    if (h) scrollToHash(h);
  },
);
watch(
  () => ui.detailsOpen,
  async () => {
    applyDetailsPref();
    await nextTick();
    await renderMermaidIn(contentEl.value);
    activateFigmaEmbedsIn(contentEl.value);
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
  unbindFigma?.();
  unbindFigma = null;
  previewVisible.value = false;
  diagramHtml.value = '';
});

function applyDetailsPref(): void {
  const root = contentEl.value;
  if (!root) return;
  root.querySelectorAll<HTMLDetailsElement>('details.md-details').forEach((d) => {
    d.open = ui.detailsOpen;
  });
}

function scrollToHash(hash: string): void {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return;
  void nextTick(() => {
    const root = contentEl.value;
    if (!root) return;
    const el =
      document.getElementById(id) ??
      root.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
    if (!el || !root.contains(el)) return;
    // 目标若在折叠块里，先展开再滚动
    let parent = el.parentElement;
    while (parent && parent !== root) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    // Leave room under sticky topbar; plain scrollIntoView(block:start) overshoots.
    const topbarOffset = 64;
    const y = el.getBoundingClientRect().top + window.scrollY - topbarOffset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    const section = el.closest('.doc-section');
    if (section) {
      section.classList.remove('flash');
      void (section as HTMLElement).offsetWidth;
      section.classList.add('flash');
      setTimeout(() => section.classList.remove('flash'), 1800);
    }
  });
}

function openImagePreview(img: HTMLImageElement): void {
  const root = contentEl.value;
  if (!root) return;
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('.md-figure img'));
  const urls = imgs.map((el) => el.currentSrc || el.src).filter(Boolean);
  if (urls.length === 0) return;
  const clicked = img.currentSrc || img.src;
  const index = Math.max(0, urls.indexOf(clicked));
  previewUrlList.value = urls;
  previewIndex.value = index;
  previewVisible.value = true;
}

function openDiagramPreview(source: HTMLElement): void {
  diagramHtml.value = cloneDiagramHtml(source);
}

function onContentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const img = target.closest?.('img');
  if (img && img.closest('.md-figure')) {
    e.preventDefault();
    openImagePreview(img as HTMLImageElement);
    return;
  }

  const diagram = diagramZoomTarget(target);
  if (diagram) {
    e.preventDefault();
    openDiagramPreview(diagram);
    return;
  }

  const a = target.closest?.('a');
  if (!a) return;
  const kind = a.getAttribute('data-internal');
  if (!kind) return;
  e.preventDefault();
  const href = a.getAttribute('href') ?? '';
  if (kind === 'hash') {
    if (route.hash === href) scrollToHash(href);
    else router.push({ hash: href });
    return;
  }
  const url = new URL(href, window.location.origin);
  const lensQuery = props.lensSelection ? { ...props.lensSelection } : {};
  const nextPath = url.pathname;
  const nextHash = url.hash || '';
  if (nextPath === route.path && nextHash === (route.hash || '')) {
    if (nextHash) scrollToHash(nextHash);
    return;
  }
  router.push({
    path: nextPath,
    query: lensQuery,
    hash: nextHash || undefined,
  });
}

function chapterLocation(chapterId: string): {
  path: string;
  query: Record<string, string | string[]>;
} {
  return {
    path: `/books/${props.bookId}/${chapterId}`,
    query: props.lensSelection ? { ...props.lensSelection } : {},
  };
}

function goPrev(): void {
  if (props.prevChapter) router.push(chapterLocation(props.prevChapter.id));
}
function goNext(): void {
  if (props.nextChapter) router.push(chapterLocation(props.nextChapter.id));
}
</script>

<template>
  <div class="chapter-wrap">
    <article
      ref="contentEl"
      class="page-card"
      :class="{ 'chapter-empty': contentFilterBlocked }"
      @click="onContentClick"
    >
      <div v-if="error" class="error-box">
        加载失败：{{ error }}
        <button class="btn" @click="load()">重试</button>
      </div>
      <template v-else-if="lensEmptyState">
        <p class="chapter-empty-code">无内容</p>
        <h1 class="chapter-empty-title">当前维度下没有可显示的内容</h1>
        <p class="chapter-empty-desc muted">
          此页未挂载所选透镜，或相关小节已被过滤。可切换为「不隐藏」，或换一个维度。
        </p>
        <button class="btn" type="button" @click="setLensContentFilter('all')">
          不隐藏
        </button>
      </template>
      <template v-else-if="lensHasContentHiddenState">
        <p class="chapter-empty-code">有内容</p>
        <h1 class="chapter-empty-title">当前页在「仅无内容」下不可见</h1>
        <p class="chapter-empty-desc muted">
          此页在所选维度下已有内容。可切换为「不隐藏」或「仅有内容」查看。
        </p>
        <button class="btn" type="button" @click="setLensContentFilter('all')">
          不隐藏
        </button>
      </template>
      <template v-else>
        <h1 v-if="pageTitle" class="chapter-title">{{ pageTitle }}</h1>
        <SectionBlock
          v-for="s in sections"
          :key="(loadedChapterId || chapterId) + '#' + s.id"
          :book-id="bookId"
          :chapter-id="loadedChapterId || chapterId"
          :section="s"
          :lens-leaves="leavesFor(s.id)"
          :lens-titles="lensTitleMap"
          :lens-colors="lensColors"
          :lens-chrome="lensChrome"
          :outline-number="outlineNum(s.id)"
          :cluster="null"
        />
        <div v-if="!loading && sections.length === 0" class="muted">（本章暂无内容）</div>
      </template>
    </article>

    <nav v-if="!contentFilterBlocked" class="pager">
      <button class="pager-btn" :disabled="!prevChapter" @click="goPrev()">
        <span class="pager-dir">‹ 上一章</span>
        <span class="pager-title">{{ prevChapter?.title ?? '—' }}</span>
      </button>
      <button class="pager-btn next" :disabled="!nextChapter" @click="goNext()">
        <span class="pager-dir">下一章 ›</span>
        <span class="pager-title">{{ nextChapter?.title ?? '—' }}</span>
      </button>
    </nav>

    <ElImageViewer
      v-if="previewVisible"
      :url-list="previewUrlList"
      :initial-index="previewIndex"
      teleported
      @close="previewVisible = false"
    />

    <DiagramLightbox v-if="diagramHtml" :html="diagramHtml" @close="diagramHtml = ''" />
  </div>
</template>
