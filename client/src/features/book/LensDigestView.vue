<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import { renderChapter, splitSections, type RenderedSection } from '@/markdown';
import { bindMermaidDetails, renderMermaidIn } from '@/mermaid';
import SectionBlock from '@/features/book/SectionBlock.vue';
import { ui } from '@/stores/ui';
import {
  digestAnchorId,
  filterChapters,
  filterSectionsByAllowlist,
  groupChaptersForDigest,
  sectionAllowlistFor,
} from '@shared/lenses';
import type { BookToc, LensSelection, TocChapter } from '@shared/types';

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
let unbindMermaid: (() => void) | null = null;

const visibleChapters = computed(() =>
  filterChapters(props.toc.chapters, props.lensSelection ?? null, props.toc),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  unbindMermaid?.();
  unbindMermaid = null;
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
        const sections = filterSectionsByAllowlist(splitSections(html), allow);
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
    await renderMermaidIn(contentEl.value);
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
  },
);

onBeforeUnmount(() => {
  unbindMermaid?.();
  unbindMermaid = null;
});
</script>

<template>
  <div class="chapter-wrap digest-wrap">
    <article ref="contentEl" class="page-card digest-card">
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
          <div v-if="g.groupTitle" class="digest-group-title">{{ g.groupTitle }}</div>
          <div v-for="page in g.pages" :key="page.chapter.id" class="digest-page">
            <div :class="g.groupTitle ? 'digest-page-title' : 'digest-group-title'">
              {{ page.title }}
            </div>
            <SectionBlock
              v-for="s in page.sections"
              :id="digestAnchorId(page.chapter.id, s.id)"
              :key="page.chapter.id + '#' + s.id"
              :book-id="bookId"
              :chapter-id="page.chapter.id"
              :section="s"
            />
          </div>
        </div>
      </template>
    </article>
  </div>
</template>
