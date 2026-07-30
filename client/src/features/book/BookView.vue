<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { LocationQueryValue, RouteLocationRaw } from 'vue-router';
import { Expand } from '@element-plus/icons-vue';
import TocSidebar from '@/features/book/TocSidebar.vue';
import ChapterPage from '@/features/book/ChapterPage.vue';
import ChapterOutline from '@/features/book/ChapterOutline.vue';
import LensTreeSelect from '@/features/book/LensTreeSelect.vue';
import NotesPanel from '@/features/notes/NotesPanel.vue';
import OrphanPanel from '@/features/orphans/OrphanPanel.vue';
import ComparePanel from '@/features/compare/ComparePanel.vue';
import AgentPanel from '@/features/agent/AgentPanel.vue';
import { loadToc, tocOf } from '@/stores/books';
import { loadAnnotations } from '@/stores/annotations';
import {
  getStoredLensSelection,
  setBookLensSelection,
  setLensPickMode,
  toggleDetailsOpen,
  toggleTocOpen,
  ui,
  type LensAxisPickMode,
} from '@/stores/ui';
import { useOrphans } from '@/composables/orphans';
import {
  allowedAxisSelectionIds,
  buildLensSelectTree,
  collapseEachAxisToSingle,
  defaultSelection,
  filterChapters,
  filterTree,
  flatIdsToSelection,
  hasLenses,
  lensAxisIds,
  lensQueryFromSelection,
  lensSelectionFromQuery,
  normalizeAxisSelection,
  pageVisibleInSelection,
  resolveLensSwitchChapter,
  sameLensSelection,
  selectionFromPageLayers,
  selectionToFlatIds,
  visibleIdSet,
} from '@shared/lenses';
import type { BookToc, LensSelection, PageLayer, TocChapter } from '@shared/types';

const route = useRoute();
const router = useRouter();

const bookId = computed(() => String(route.params.bookId));
const chapterId = computed(() => (route.params.chapterId ? String(route.params.chapterId) : ''));
const toc = computed(() => tocOf(bookId.value));
const orphans = useOrphans(bookId);
const loadError = ref('');

function sanitizeSelection(
  sel: LensSelection | null,
  t: BookToc | null | undefined = toc.value,
): LensSelection | null {
  if (!t?.lenses) return null;
  const base = sel ?? defaultSelection(t);
  if (!base) return null;
  const fallback = defaultSelection(t);
  const out: LensSelection = {};
  for (const axis of lensAxisIds(t)) {
    const allowed = allowedAxisSelectionIds(t, axis);
    const pick = normalizeAxisSelection(base[axis]).filter((id) => allowed.has(id));
    if (pick.length > 0) out[axis] = pick;
    else if (fallback?.[axis]?.length) out[axis] = [...fallback[axis]];
  }
  const flat = selectionToFlatIds(t, out);
  const normalized = flatIdsToSelection(t, flat, flat);
  if (!normalized) return null;
  if (ui.lensPickMode === 'single') return collapseEachAxisToSingle(t, normalized);
  return normalized;
}

const activeSelection = computed<LensSelection | null>(() => {
  const t = toc.value;
  if (!t || !hasLenses(t)) return null;
  const candidate = ui.lensByBook[bookId.value] ?? getStoredLensSelection(bookId.value);
  return sanitizeSelection(candidate, t);
});

const filteredChapters = computed(() =>
  toc.value ? filterChapters(toc.value.chapters, activeSelection.value, toc.value) : [],
);

const filteredTree = computed(() => {
  const t = toc.value;
  if (!t) return [];
  const ids = visibleIdSet(t.chapters, activeSelection.value, t);
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

const lensSelectTree = computed(() => (toc.value ? buildLensSelectTree(toc.value) : []));

const flatLensIds = computed(() =>
  toc.value ? selectionToFlatIds(toc.value, activeSelection.value) : [],
);

function queryEqual(
  a: Record<string, string | string[]>,
  b: Record<string, LocationQueryValue | LocationQueryValue[] | undefined>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const aa = normalizeAxisSelection(a[k]).slice().sort();
    const bb = normalizeAxisSelection(b[k] as string | string[] | null | undefined)
      .slice()
      .sort();
    if (aa.length !== bb.length || aa.some((id, i) => id !== bb[i])) return false;
  }
  return true;
}

/** Path + lens query + optional hash for in-book navigation. */
function bookLocation(
  nextChapterId: string,
  opts?: { selection?: LensSelection | null; hash?: string; t?: BookToc | null },
): RouteLocationRaw {
  const t = opts?.t ?? toc.value;
  const sel = opts?.selection !== undefined ? opts.selection : activeSelection.value;
  const query = t ? lensQueryFromSelection(sel, t) : {};
  return {
    path: `/books/${bookId.value}/${nextChapterId}`,
    query,
    ...(opts?.hash ? { hash: opts.hash } : {}),
  };
}

function syncLensQueryToRoute(
  sel: LensSelection | null,
  t: BookToc,
  mode: 'replace' | 'push' = 'replace',
  nextChapterId?: string,
): void {
  const chapter = nextChapterId ?? chapterId.value;
  if (!chapter) return;
  const nextQuery = lensQueryFromSelection(sel, t);
  const currentFromRoute = lensSelectionFromQuery(route.query, t);
  const sameQuery = sameLensSelection(
    currentFromRoute ? sanitizeSelection(currentFromRoute, t) : null,
    sel,
  );
  const sameChapter = chapter === chapterId.value;
  if (sameQuery && sameChapter && queryEqual(nextQuery, route.query)) return;
  const loc = bookLocation(chapter, { selection: sel, t, hash: route.hash || undefined });
  if (mode === 'push') router.push(loc);
  else router.replace(loc);
}

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
    const fromQuery = lensSelectionFromQuery(route.query, t);
    const stored = getStoredLensSelection(bookId.value);
    const pick = sanitizeSelection(
      fromQuery ?? stored ?? ui.lensByBook[bookId.value] ?? defaultSelection(t),
      t,
    );
    if (pick) setBookLensSelection(bookId.value, pick);
  }

  if (!chapterId.value) {
    const sel = activeSelection.value;
    const visible = filterChapters(t.chapters, sel, t);
    const last = localStorage.getItem(`reader.last.${bookId.value}`);
    const target =
      visible.find((c) => c.id === last)?.id ?? visible[0]?.id ?? t.chapters[0].id;
    router.replace(bookLocation(target, { selection: sel, t }));
    return;
  }

  const current = t.chapters.find((c) => c.id === chapterId.value);
  let sel = activeSelection.value;
  if (current && hasLenses(t) && sel && !pageVisibleInSelection(current, sel, t)) {
    const adopted = selectionFromPageLayers(t, current, sel);
    setBookLensSelection(bookId.value, adopted);
    sel = adopted;
  }

  if (hasLenses(t) && sel) {
    syncLensQueryToRoute(sel, t, 'replace');
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

watch(
  () => route.query,
  () => {
    const t = toc.value;
    if (!t || !hasLenses(t)) return;
    const fromQuery = lensSelectionFromQuery(route.query, t);
    if (!fromQuery) return;
    const pick = sanitizeSelection(fromQuery, t);
    if (pick && !sameLensSelection(pick, activeSelection.value)) {
      setBookLensSelection(bookId.value, pick);
    }
  },
);

const chapterIndex = computed(
  () => filteredChapters.value.findIndex((c) => c.id === chapterId.value) ?? -1,
);
const currentChapter = computed<TocChapter | null>(
  () => toc.value?.chapters.find((c) => c.id === chapterId.value) ?? null,
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
  if (ch) router.push(bookLocation(ch.id));
}

function finalizeSelection(
  t: BookToc,
  nextSel: LensSelection,
  preferIds: PageLayer[] = [],
): LensSelection {
  if (ui.lensPickMode !== 'single') return nextSel;
  return collapseEachAxisToSingle(t, nextSel, preferIds);
}

function onLensSelect(options: PageLayer[]): void {
  const t = toc.value;
  const sel = activeSelection.value;
  if (!t || !sel) return;
  const prevFlat = selectionToFlatIds(t, sel);
  const added = options.filter((id) => !prevFlat.includes(id));
  let nextSel = flatIdsToSelection(t, options, prevFlat);
  if (!nextSel) return;
  nextSel = finalizeSelection(t, nextSel, added);
  const target = resolveLensSwitchChapter(t, chapterId.value, nextSel);
  setBookLensSelection(bookId.value, nextSel);
  const mode = target !== chapterId.value ? 'push' : 'replace';
  syncLensQueryToRoute(nextSel, t, mode, target);
}

function onLensPickMode(mode: LensAxisPickMode): void {
  setLensPickMode(mode);
  const t = toc.value;
  const sel = activeSelection.value;
  if (!t || !sel || mode !== 'single') return;
  const nextSel = collapseEachAxisToSingle(t, sel);
  if (sameLensSelection(nextSel, sel)) return;
  const target = resolveLensSwitchChapter(t, chapterId.value, nextSel);
  setBookLensSelection(bookId.value, nextSel);
  syncLensQueryToRoute(nextSel, t, target !== chapterId.value ? 'push' : 'replace', target);
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
      v-if="ui.tocOpen"
      :toc="toc"
      :tree="filteredTree"
      :book-id="bookId"
      :current-chapter-id="chapterId"
      :lens-selection="activeSelection"
    />
    <div class="book-main">
      <div class="topbar">
        <router-link to="/" class="btn ghost">‹ 书架</router-link>
        <button
          v-if="!ui.tocOpen"
          class="btn ghost toc-toggle"
          type="button"
          title="展开目录"
          aria-label="展开目录"
          @click="toggleTocOpen()"
        >
          <el-icon :size="16"><Expand /></el-icon>
        </button>
        <span class="spacer" />
        <div v-if="lensSelectTree.length && activeSelection" class="lens-controls">
          <span class="visually-hidden">透镜选择模式</span>
          <el-select
            class="lens-mode-select"
            :model-value="ui.lensPickMode"
            @update:model-value="onLensPickMode($event as LensAxisPickMode)"
          >
            <el-option label="多选" value="multi" />
            <el-option label="单选" value="single" />
          </el-select>
          <div class="lens-select-wrap">
            <span class="visually-hidden">透镜</span>
            <LensTreeSelect
              :nodes="lensSelectTree"
              :model-value="flatLensIds"
              placeholder="透镜"
              @update:model-value="onLensSelect"
            />
          </div>
        </div>
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
      <div class="book-body">
        <div class="book-reading">
          <div class="book-content">
            <ChapterPage
              v-if="chapterId"
              :book-id="bookId"
              :chapter-id="chapterId"
              :prev-chapter="prevChapter"
              :next-chapter="nextChapter"
              :lens-selection="activeSelection"
            />
          </div>
          <ChapterOutline
            v-if="currentChapter"
            :toc="toc"
            :book-id="bookId"
            :chapter="currentChapter"
            :lens-selection="activeSelection"
          />
        </div>
      </div>
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
