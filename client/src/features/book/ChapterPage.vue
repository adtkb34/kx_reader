<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElImageViewer } from 'element-plus';
import { api } from '@/api/client';
import { tocOf } from '@/stores/books';
import { renderChapter, splitSections, type RenderedSection } from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import { enhanceTableFiltersIn } from '@/tableFilters';
import { enhanceTableRulerColIn } from '@/tableRulerCol';
import { enhanceTableCellMergeIn } from '@/tableCellMerge';
import { cloneDiagramHtml, diagramZoomTarget } from '@/diagramZoom';
import SectionBlock from '@/features/book/SectionBlock.vue';
import DiagramLightbox from '@/features/book/DiagramLightbox.vue';
import { ui, getBookShowLevel } from '@/stores/ui';
import {
  filterSectionsByAllowlist,
  filterSectionsByShowLevel,
  lensColorMap,
  lensNodeTitle,
  sectionAllowlistFor,
  sectionLensLeaves,
  selectionLegendLeaves,
} from '@shared/lenses';
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
/** Ignore stale async load results when chapter/lens changes mid-flight. */
let loadSeq = 0;
/** Chapter id whose `title` / `sections` currently match the DOM. */
const loadedChapterId = ref('');

const tocChapter = computed(() =>
  tocOf(props.bookId)?.chapters.find((c) => c.id === props.chapterId),
);

/** Title follows loaded content — never show a new TOC name over old body. */
const pageTitle = computed(() => {
  if (loadedChapterId.value === props.chapterId && title.value) return title.value;
  return title.value || tocChapter.value?.title || '';
});

const activeLeaves = computed(() => {
  const toc = tocOf(props.bookId);
  if (!toc) return new Set<PageLayer>();
  return new Set(selectionLegendLeaves(toc, props.lensSelection ?? null).map((i) => i.id));
});

const lensChrome = computed(() => activeLeaves.value.size > 1);

const lensTitleMap = computed(() => {
  const toc = tocOf(props.bookId);
  const ch = tocChapter.value;
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

function leavesFor(sectionId: string): PageLayer[] {
  const toc = tocOf(props.bookId);
  const ch = tocChapter.value;
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
  previewVisible.value = false;
  diagramHtml.value = '';
  // Chapter switch: drop stale body immediately so title/content cannot diverge.
  if (loadedChapterId.value && loadedChapterId.value !== reqChapterId) {
    sections.value = [];
  }
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
    const allow = chapterMeta ? sectionAllowlistFor(chapterMeta, reqLens, toc) : null;
    const nextSections = filterSectionsByShowLevel(
      filterSectionsByAllowlist(splitSections(html), allow),
      chapterMeta,
      reqShowLevel,
    );
    if (seq !== loadSeq) return;
    sections.value = nextSections;
    loadedChapterId.value = reqChapterId;
    await nextTick();
    if (seq !== loadSeq) return;
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    if (seq !== loadSeq) return;
    enhanceTableRulerColIn(contentEl.value, tocOf(reqBookId));
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
    if (route.hash) scrollToHash(route.hash);
    else window.scrollTo({ top: 0 });
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = e instanceof Error ? e.message : String(e);
    sections.value = [];
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
    enhanceTableRulerColIn(contentEl.value, tocOf(props.bookId));
    enhanceTableCellMergeIn(contentEl.value);
    enhanceTableFiltersIn(contentEl.value);
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
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
    <article ref="contentEl" class="page-card" @click="onContentClick">
      <div v-if="error" class="error-box">
        加载失败：{{ error }}
        <button class="btn" @click="load()">重试</button>
      </div>
      <template v-else>
        <h1 v-if="pageTitle" class="chapter-title">{{ pageTitle }}</h1>
        <SectionBlock
          v-for="(s, i) in sections"
          :key="chapterId + '#' + s.id"
          :book-id="bookId"
          :chapter-id="chapterId"
          :section="s"
          :lens-leaves="leavesFor(s.id)"
          :lens-titles="lensTitleMap"
          :lens-colors="lensColors"
          :lens-chrome="lensChrome"
          :cluster="null"
        />
        <div v-if="!loading && sections.length === 0" class="muted">（本章暂无内容）</div>
      </template>
    </article>

    <nav class="pager">
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
