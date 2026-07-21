<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { tocOf } from '@/stores/books';
import { renderChapter, splitSections, type RenderedSection } from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import SectionBlock from '@/components/SectionBlock.vue';
import { ui } from '@/stores/ui';
import type { TocChapter } from '@shared/types';

const props = defineProps<{
  bookId: string;
  chapterId: string;
  prevChapter: TocChapter | null;
  nextChapter: TocChapter | null;
}>();

const route = useRoute();
const router = useRouter();

const title = ref('');
const sections = ref<RenderedSection[]>([]);
const error = ref('');
const loading = ref(false);
const contentEl = ref<HTMLElement | null>(null);
let unbindMermaid: (() => void) | null = null;

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  unbindMermaid?.();
  unbindMermaid = null;
  try {
    const chapter = await api.chapter(props.bookId, props.chapterId);
    title.value = chapter.title;
    const toc = tocOf(props.bookId);
    const fileToChapter: Record<string, string> = {};
    for (const c of toc?.chapters ?? []) {
      fileToChapter[c.file] = c.id;
      const base = c.file.split('/').pop();
      if (base) fileToChapter[base] = c.id;
    }
    const html = renderChapter(chapter.markdown, { bookId: props.bookId, fileToChapter });
    sections.value = splitSections(html);
    await nextTick();
    applyDetailsPref();
    unbindMermaid = bindMermaidDetails(contentEl.value);
    await renderMermaidIn(contentEl.value);
    if (route.hash) scrollToHash(route.hash);
    else window.scrollTo({ top: 0 });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    sections.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => [props.bookId, props.chapterId], load, { immediate: true });
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
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const section = el.closest('.doc-section');
    if (section) {
      section.classList.remove('flash');
      void (section as HTMLElement).offsetWidth;
      section.classList.add('flash');
      setTimeout(() => section.classList.remove('flash'), 1800);
    }
  });
}

function onContentClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest?.('a');
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
  const current = route.path + route.hash;
  if (href === current) {
    const i = href.indexOf('#');
    if (i >= 0) scrollToHash(href.slice(i));
  } else {
    router.push(href);
  }
}

function goPrev(): void {
  if (props.prevChapter) router.push(`/books/${props.bookId}/${props.prevChapter.id}`);
}
function goNext(): void {
  if (props.nextChapter) router.push(`/books/${props.bookId}/${props.nextChapter.id}`);
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
        <h1 class="chapter-title">{{ title }}</h1>
        <SectionBlock
          v-for="s in sections"
          :key="chapterId + '#' + s.id"
          :book-id="bookId"
          :chapter-id="chapterId"
          :section="s"
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
  </div>
</template>
