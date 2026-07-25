<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TocSidebar from '@/components/TocSidebar.vue';
import ChapterPage from '@/components/ChapterPage.vue';
import NotesPanel from '@/components/NotesPanel.vue';
import OrphanPanel from '@/components/OrphanPanel.vue';
import ComparePanel from '@/components/ComparePanel.vue';
import AgentPanel from '@/components/AgentPanel.vue';
import { loadToc, tocOf } from '@/stores/books';
import { loadAnnotations } from '@/stores/annotations';
import {
  getStoredLensSelection,
  setBookAxisLens,
  setBookLensSelection,
  toggleDetailsOpen,
  ui,
} from '@/stores/ui';
import { useOrphans } from '@/composables/orphans';
import {
  axisLabel,
  defaultSelection,
  filterChapters,
  filterTree,
  hasLenses,
  lensAxisIds,
  pageVisibleInSelection,
  resolveAxisSwitchTarget,
  selectionFromPageLayers,
  visibleIdSet,
} from '@shared/lenses';
import type { LensAxisId, LensSelection, PageLayer, TocChapter } from '@shared/types';

const route = useRoute();
const router = useRouter();

const bookId = computed(() => String(route.params.bookId));
const chapterId = computed(() => (route.params.chapterId ? String(route.params.chapterId) : ''));
const toc = computed(() => tocOf(bookId.value));
const orphans = useOrphans(bookId);
const loadError = ref('');

function sanitizeSelection(sel: LensSelection | null): LensSelection | null {
  const t = toc.value;
  if (!t?.lenses) return null;
  const base = sel ?? defaultSelection(t);
  if (!base) return null;
  const out: LensSelection = {};
  for (const axis of lensAxisIds(t)) {
    const allowed = new Set((t.lenses[axis] ?? []).map((l) => l.id));
    const pick = base[axis];
    const fallback = t.lenses[axis]?.[0]?.id;
    if (pick && allowed.has(pick)) out[axis] = pick;
    else if (fallback) out[axis] = fallback;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const activeSelection = computed<LensSelection | null>(() => {
  const t = toc.value;
  if (!t || !hasLenses(t)) return null;
  const candidate = ui.lensByBook[bookId.value] ?? getStoredLensSelection(bookId.value);
  return sanitizeSelection(candidate);
});

const filteredChapters = computed(() =>
  toc.value ? filterChapters(toc.value.chapters, activeSelection.value) : [],
);

const filteredTree = computed(() => {
  const t = toc.value;
  if (!t) return [];
  const ids = visibleIdSet(t.chapters, activeSelection.value);
  const base = t.tree?.length
    ? t.tree
    : t.chapters.map((c) => ({
        type: 'page' as const,
        id: c.id,
        title: c.title,
        file: c.file,
      }));
  return filterTree(base, ids);
});

const axisIds = computed(() => (toc.value ? lensAxisIds(toc.value) : []));

async function ensureLoaded(): Promise<void> {
  loadError.value = '';
  try {
    await Promise.all([loadToc(bookId.value, true), loadAnnotations(bookId.value)]);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    return;
  }
  const t = tocOf(bookId.value);
  if (!t || t.chapters.length === 0) return;

  if (hasLenses(t)) {
    const stored = getStoredLensSelection(bookId.value);
    const pick = sanitizeSelection(stored ?? ui.lensByBook[bookId.value] ?? defaultSelection(t));
    if (pick) setBookLensSelection(bookId.value, pick);
  }

  if (!chapterId.value) {
    const sel = activeSelection.value;
    const visible = filterChapters(t.chapters, sel);
    const last = localStorage.getItem(`reader.last.${bookId.value}`);
    const target =
      visible.find((c) => c.id === last)?.id ?? visible[0]?.id ?? t.chapters[0].id;
    router.replace(`/books/${bookId.value}/${target}`);
    return;
  }

  // Deep link to a page hidden by current selection → adopt that page's layers.
  const current = t.chapters.find((c) => c.id === chapterId.value);
  const sel = activeSelection.value;
  if (current && hasLenses(t) && sel && !pageVisibleInSelection(current, sel)) {
    const adopted = selectionFromPageLayers(t, current, sel);
    setBookLensSelection(bookId.value, adopted);
  }
}

watch(bookId, ensureLoaded, { immediate: true });
watch(
  chapterId,
  (id) => {
    if (id) localStorage.setItem(`reader.last.${bookId.value}`, id);
  },
  { immediate: true },
);

const chapterIndex = computed(
  () => filteredChapters.value.findIndex((c) => c.id === chapterId.value) ?? -1,
);
const prevChapter = computed<TocChapter | null>(() =>
  chapterIndex.value > 0 ? filteredChapters.value[chapterIndex.value - 1] : null,
);
const nextChapter = computed<TocChapter | null>(() =>
  chapterIndex.value >= 0 && chapterIndex.value < filteredChapters.value.length - 1
    ? filteredChapters.value[chapterIndex.value + 1]
    : null,
);

function go(ch: TocChapter | null): void {
  if (ch) router.push(`/books/${bookId.value}/${ch.id}`);
}

function onAxisLens(axis: LensAxisId, option: PageLayer): void {
  const t = toc.value;
  const sel = activeSelection.value;
  if (!t || !sel) return;
  const target = resolveAxisSwitchTarget(t, chapterId.value, axis, option, sel);
  setBookAxisLens(bookId.value, axis, option, sel);
  if (target && target !== chapterId.value) {
    router.push(`/books/${bookId.value}/${target}`);
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  ) {
    return;
  }
  if (e.key === 'ArrowLeft') go(prevChapter.value);
  else if (e.key === 'ArrowRight') go(nextChapter.value);
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="toc" class="book-layout">
    <TocSidebar
      :toc="toc"
      :tree="filteredTree"
      :book-id="bookId"
      :current-chapter-id="chapterId"
    />
    <div class="book-main">
      <div class="topbar">
        <router-link to="/" class="btn ghost">‹ 书架</router-link>
        <span class="topbar-title">{{ toc.title }}</span>
        <span class="spacer" />
        <template v-if="axisIds.length && activeSelection">
          <label
            v-for="axis in axisIds"
            :key="axis"
            class="lens-select-wrap"
          >
            <span class="visually-hidden">{{ axisLabel(axis) }}</span>
            <select
              class="lens-select"
              :value="activeSelection[axis] ?? ''"
              @change="
                onAxisLens(axis, ($event.target as HTMLSelectElement).value)
              "
            >
              <option
                v-for="lens in toc.lenses![axis]"
                :key="lens.id"
                :value="lens.id"
              >
                {{ lens.title }}
              </option>
            </select>
          </label>
        </template>
        <button v-if="orphans.length" class="btn ghost warn" @click="ui.orphanOpen = true">
          孤立标注 {{ orphans.length }}
        </button>
        <button
          v-if="chapterId"
          class="btn ghost"
          type="button"
          @click="ui.compareOpen = true"
        >
          对比变更
        </button>
        <button class="btn ghost" type="button" @click="ui.agentOpen = true">AI</button>
        <button class="btn ghost" @click="toggleDetailsOpen()">
          {{ ui.detailsOpen ? '收起全部细节' : '展开全部细节' }}
        </button>
      </div>
      <ChapterPage
        v-if="chapterId"
        :book-id="bookId"
        :chapter-id="chapterId"
        :prev-chapter="prevChapter"
        :next-chapter="nextChapter"
      />
    </div>
    <NotesPanel v-if="ui.notesTarget" />
    <OrphanPanel v-if="ui.orphanOpen" :book-id="bookId" />
    <ComparePanel
      v-if="ui.compareOpen && chapterId"
      :book-id="bookId"
      :chapter-id="chapterId"
    />
    <AgentPanel
      v-if="ui.agentOpen"
      :book-id="bookId"
      :chapter-id="chapterId"
    />
  </div>
  <div v-else-if="loadError" class="loading-screen">
    <div class="error-box">
      加载失败：{{ loadError }}
      <button class="btn" @click="ensureLoaded()">重试</button>
    </div>
  </div>
  <div v-else class="loading-screen muted">加载中…</div>
</template>
