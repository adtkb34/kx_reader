<script setup lang="ts">
import {
  getBookShowLevel,
  getBookRulerPick,
  getStoredLensSelection,
  setBookLensSelection,
  setBookRulerPick,
  setBookShowLevel,
  setLensContentFilter,
  setLensPickMode,
  setLensReadMode,
  toggleDetailsOpen,
  toggleTocOpen,
  ui,
  type LensAxisPickMode,
  type LensReadMode,
} from '@/stores/ui';
import { useOrphans } from '@/composables/orphans';
import { useRulerOutlineKeySelection } from '@/composables/outlineKeys';
import {
  allowedAxisSelectionIds,
  bookContentRanks,
  buildLensSelectTree,
  collapseEachAxisToSingle,
  defaultSelection,
  filterChapters,
  filterChaptersWithContent,
  filterChaptersWithoutContent,
  chapterHasVisibleLensSections,
  collapseSingletonGroups,
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
} from '@shared/lenses';
import {
  bookRulerPicks,
  filterRulerModuleIndexIds,
  findLeafModule,
  findRulerModuleIndexId,
  findRulerSkeletonChapter,
  moduleHasEmptyTicks,
  moduleHasHungTicks,
  normalizeRulerPick,
  resolveRulerLensSwitchChapter,
  rulerSidebarKeepIds,
} from '@shared/ruler';
import type { BookToc, LensSelection, PageLayer, RulerPick, TocChapter } from '@shared/types';
import LensDigestView from '@/features/book/LensDigestView.vue';
import DigestOutline from '@/features/book/DigestOutline.vue';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';
import TocSidebar from '@/features/book/TocSidebar.vue';
import ChapterPage from '@/features/book/ChapterPage.vue';
import ChapterOutline from '@/features/book/ChapterOutline.vue';
import ModulePage from '@/features/book/ModulePage.vue';
import ModuleOutline from '@/features/book/ModuleOutline.vue';
import LensTreeSelect from '@/features/book/LensTreeSelect.vue';
import NotesPanel from '@/features/notes/NotesPanel.vue';
import OrphanPanel from '@/features/orphans/OrphanPanel.vue';
import ComparePanel from '@/features/compare/ComparePanel.vue';
import AgentPanel from '@/features/agent/AgentPanel.vue';
import { loadToc, tocOf } from '@/stores/books';
import { loadAnnotations } from '@/stores/annotations';
import { Expand } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { LocationQueryValue, RouteLocationRaw } from 'vue-router';

const route = useRoute();
const router = useRouter();

const bookId = computed(() => String(route.params.bookId));
const chapterId = computed(() => (route.params.chapterId ? String(route.params.chapterId) : ''));
const toc = computed(() => tocOf(bookId.value));
const orphans = useOrphans(bookId);
const loadError = ref('');
/** Outline rows emitted by body views so right rail stays in lockstep. */
const digestOutlineSync = ref<DigestOutlineRow[]>([]);
const moduleOutlineSync = ref<DigestOutlineRow[]>([]);

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
    const hasKey = Object.prototype.hasOwnProperty.call(base, axis);
    const pick = normalizeAxisSelection(base[axis]).filter((id) => allowed.has(id));
    if (pick.length > 0) out[axis] = pick;
    else if (hasKey) out[axis] = [];
    else if (fallback?.[axis]?.length) out[axis] = [...fallback[axis]];
  }
  const flat = selectionToFlatIds(t, out);
  const normalized = flatIdsToSelection(t, flat, flat, { allowEmpty: true });
  if (!normalized) return null;
  if (ui.lensPickMode === 'single') {
    return collapseEachAxisToSingle(t, normalized);
  }
  return normalized;
}

const activeSelection = computed<LensSelection | null>(() => {
  const t = toc.value;
  if (!t || !hasLenses(t)) return null;
  const candidate = ui.lensByBook[bookId.value] ?? getStoredLensSelection(bookId.value);
  return sanitizeSelection(candidate, t);
});

const {
  selectedIds: outlineKeyIds,
  visibleKeyIds: outlineVisibleIds,
  onToggleKey: onOutlineKeyToggle,
  selectTopLevelKeys: onOutlineSelectTopLevel,
} = useRulerOutlineKeySelection(
  () => bookId.value,
  () => toc.value,
  () => activeSelection.value,
  () => chapterId.value || null,
);

const isModuleBook = computed(() => !!toc.value?.ruler);

const activeRulerPick = computed<RulerPick>(() => {
  const t = toc.value;
  if (!t?.ruler) return 'index';
  return normalizeRulerPick(t, getBookRulerPick(bookId.value));
});

const rulerPickOptions = computed(() => {
  const t = toc.value;
  if (!t?.ruler) return [] as { value: RulerPick; label: string }[];
  return bookRulerPicks(t).map((p) => ({
    value: p,
    label: p === 'index' ? '按 index' : (t.lensAxisTitles?.[p] ?? p),
  }));
});

/** `null` = 全部; track ui.showLevelByBook for the select label. */
const readerShowLevel = computed(() => getBookShowLevel(bookId.value));

/** Content/empty filters only apply when a lens leaf is actually selected. */
const lensContentFilterActive = computed(() => {
  const t = toc.value;
  const sel = activeSelection.value;
  if (ui.lensContentFilter === 'all' || !t || !sel) return false;
  return selectionToFlatIds(t, sel).length > 0;
});

function chaptersForContentFilter(
  chapters: TocChapter[],
  sel: LensSelection | null,
  t: BookToc,
): TocChapter[] {
  if (!lensContentFilterActive.value) return filterChapters(chapters, sel, t);
  if (t.ruler) {
    const base = filterChapters(chapters, sel, t);
    const mode = ui.lensContentFilter === 'empty' ? 'empty' : 'content';
    const keepIds = filterRulerModuleIndexIds(t, sel, readerShowLevel.value, mode);
    return base.filter((c) => {
      const mod = findLeafModule(t, c.id);
      const indexId = mod?.indexChapterId ?? c.id;
      return keepIds.has(indexId);
    });
  }
  if (ui.lensContentFilter === 'empty') {
    return filterChaptersWithoutContent(chapters, sel, t, readerShowLevel.value);
  }
  return filterChaptersWithContent(chapters, sel, t, readerShowLevel.value);
}

/** Current route chapter is hidden by「仅有内容」/「仅无内容」— drop from TOC, show empty state. */
const currentChapterHiddenByContentFilter = computed(() => {
  const t = toc.value;
  const sel = activeSelection.value;
  const id = chapterId.value;
  if (!lensContentFilterActive.value || !t || !sel || !id) return false;
  const ch = t.chapters.find((c) => c.id === id);
  if (!ch) return false;
  if (t.ruler) {
    const indexId = findRulerModuleIndexId(t, id) ?? id;
    const hung = moduleHasHungTicks(t, sel, readerShowLevel.value, indexId);
    const empty = moduleHasEmptyTicks(t, sel, readerShowLevel.value, indexId);
    return ui.lensContentFilter === 'content' ? !hung : !empty;
  }
  const has = chapterHasVisibleLensSections(ch, sel, t, readerShowLevel.value);
  return ui.lensContentFilter === 'content' ? !has : has;
});

const filteredChapters = computed(() => {
  const t = toc.value;
  if (!t) return [];
  const sel = activeSelection.value;
  let visible = chaptersForContentFilter(t.chapters, sel, t);
  // Keep the chapter being read if it fell out of a normal lens filter (e.g. uncheck).
  // Content/empty filters do not force-keep — empty state is shown instead.
  const current = t.chapters.find((c) => c.id === chapterId.value);
  if (
    current &&
    !visible.some((c) => c.id === current.id) &&
    !currentChapterHiddenByContentFilter.value
  ) {
    visible = [...visible, current];
  }
  if (!t.ruler) return visible;
  const keep = rulerSidebarKeepIds(t, sel);
  const kept = visible.filter(
    (c) =>
      keep.has(c.id) || (c.id === chapterId.value && !currentChapterHiddenByContentFilter.value),
  );
  return kept.length ? kept : visible;
});

const lensSelectTree = computed(() => (toc.value ? buildLensSelectTree(toc.value) : []));

const flatLensIds = computed(() =>
  toc.value ? selectionToFlatIds(toc.value, activeSelection.value) : [],
);

const contentRanks = computed(() => (toc.value ? bookContentRanks(toc.value) : []));

function onShowLevel(raw: string | number | null): void {
  if (raw === 'all' || raw == null || raw === '') {
    setBookShowLevel(bookId.value, null);
    return;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  setBookShowLevel(bookId.value, Number.isFinite(n) ? n : null);
}

function onLensContentFilter(raw: string): void {
  if (raw === 'content' || raw === 'empty' || raw === 'all') {
    setLensContentFilter(raw);
  }
}

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
    const last = localStorage.getItem(`reader.last.${bookId.value}`);
    const seed =
      last && t.chapters.some((c) => c.id === last) ? last : t.chapters[0].id;
    router.replace(bookLocation(seed, { selection: sel, t }));
    return;
  }

  const current = t.chapters.find((c) => c.id === chapterId.value);
  let sel = activeSelection.value;
  if (!current) {
    // Unknown id in the URL — fall back to last-read or first chapter.
    const last = localStorage.getItem(`reader.last.${bookId.value}`);
    const seed =
      last && t.chapters.some((c) => c.id === last) ? last : t.chapters[0].id;
    router.replace(bookLocation(seed, { selection: sel, t }));
    return;
  }
  // Module books: always land on the leaf-directory index chapter.
  if (t.ruler) {
    const indexId = findRulerModuleIndexId(t, current.id);
    if (indexId && indexId !== current.id) {
      router.replace(bookLocation(indexId, { selection: sel, t }));
      return;
    }
  }
  if (hasLenses(t) && sel && !pageVisibleInSelection(current, sel, t)) {
    const adopted = selectionFromPageLayers(t, current, sel);
    setBookLensSelection(bookId.value, adopted);
    sel = adopted;
  }

  // Keep the URL chapter on refresh / book load — do not auto-jump via ruler
  // preference (that snapped the sidebar back to the first module).
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
  allowEmpty = false,
): LensSelection {
  if (ui.lensPickMode !== 'single') return nextSel;
  if (allowEmpty && selectionToFlatIds(t, nextSel).length === 0) return nextSel;
  // One node per axis — any depth (parent or leaf), not forced to a leaf.
  return collapseEachAxisToSingle(t, nextSel, preferIds);
}

function resolveSwitchChapter(
  t: BookToc,
  currentId: string,
  nextSel: LensSelection,
  prevSel?: LensSelection | null,
): string {
  if (t.ruler) {
    return resolveRulerLensSwitchChapter(t, currentId, nextSel);
  }
  return resolveLensSwitchChapter(t, currentId, nextSel, prevSel);
}

function onLensSelect(options: PageLayer[]): void {
  const t = toc.value;
  const sel = activeSelection.value;
  if (!t || !sel) return;
  const prevFlat = selectionToFlatIds(t, sel);
  const added = options.filter((id) => !prevFlat.includes(id));
  let nextSel = flatIdsToSelection(t, options, prevFlat, { allowEmpty: true });
  if (!nextSel) return;
  nextSel = finalizeSelection(t, nextSel, added, true);
  setBookLensSelection(bookId.value, nextSel);
  syncLensQueryToRoute(nextSel, t, 'replace', chapterId.value);
}

function onLensPickMode(mode: LensAxisPickMode): void {
  const t = toc.value;
  const raw =
    (t && (ui.lensByBook[bookId.value] ?? getStoredLensSelection(bookId.value))) ||
    activeSelection.value;
  setLensPickMode(mode);
  if (!t || !raw || !chapterId.value || mode !== 'single') return;
  const nextSel = collapseEachAxisToSingle(t, raw);
  setBookLensSelection(bookId.value, nextSel);
  const target = resolveSwitchChapter(t, chapterId.value, nextSel, raw);
  syncLensQueryToRoute(nextSel, t, target !== chapterId.value ? 'push' : 'replace', target);
}

function onLensReadMode(mode: LensReadMode): void {
  setLensReadMode(mode === 'digest' ? 'digest' : 'page');
  const t = toc.value;
  if (!t?.ruler || !chapterId.value) return;
  // Ensure route points at module index when reading a ruler book.
  const indexId =
    findRulerModuleIndexId(t, chapterId.value) ?? findRulerSkeletonChapter(t)?.id;
  if (indexId && indexId !== chapterId.value && mode === 'page') {
    const sel = activeSelection.value;
    if (sel) syncLensQueryToRoute(sel, t, 'replace', indexId);
  }
}

function onRulerPick(raw: string): void {
  const t = toc.value;
  if (!t?.ruler) return;
  const pick = normalizeRulerPick(t, raw);
  setBookRulerPick(bookId.value, pick);
  // Clear immediately so outline doesn't show the previous ruler while body reloads.
  digestOutlineSync.value = [];
  moduleOutlineSync.value = [];
}

const isDigestMode = computed(
  () =>
    !!toc.value &&
    hasLenses(toc.value) &&
    ui.lensReadMode === 'digest' &&
    !!activeSelection.value,
);

const filteredTree = computed(() => {
  const t = toc.value;
  if (!t) return [];
  const sel = activeSelection.value;
  let ids = new Set(chaptersForContentFilter(t.chapters, sel, t).map((c) => c.id));
  if (chapterId.value && !currentChapterHiddenByContentFilter.value) ids.add(chapterId.value);
  if (t.ruler) {
    const keep = rulerSidebarKeepIds(t, sel);
    ids = new Set(
      [...ids].filter(
        (id) =>
          keep.has(id) || (id === chapterId.value && !currentChapterHiddenByContentFilter.value),
      ),
    );
  }
  const base = t.tree?.length
    ? t.tree
    : t.chapters.map((c) => ({
        type: 'page' as const,
        id: c.id,
        title: c.title,
        file: c.file,
      }));
  return collapseSingletonGroups(filterTree(base, ids));
});

watch(
  () => [toc.value?.ruler, getBookRulerPick(bookId.value)] as const,
  () => {
    const t = toc.value;
    if (!t?.ruler) return;
    const pick = normalizeRulerPick(t, getBookRulerPick(bookId.value));
    if (pick !== getBookRulerPick(bookId.value)) setBookRulerPick(bookId.value, pick);
  },
);

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
        <div
          v-if="(lensSelectTree.length && activeSelection) || contentRanks.length || isModuleBook"
          class="lens-controls"
        >
          <template v-if="lensSelectTree.length && activeSelection">
            <span class="visually-hidden">阅读模式</span>
            <el-select
              class="lens-mode-select"
              :model-value="ui.lensReadMode"
              @update:model-value="onLensReadMode($event as LensReadMode)"
            >
              <el-option label="单页" value="page" />
              <el-option label="汇总" value="digest" />
            </el-select>
          </template>
          <template v-if="rulerPickOptions.length">
            <span class="visually-hidden">尺子</span>
            <el-select
              class="lens-mode-select"
              :model-value="activeRulerPick"
              @update:model-value="onRulerPick(String($event))"
            >
              <el-option
                v-for="opt in rulerPickOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </template>
          <template v-if="lensSelectTree.length && activeSelection">
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
                :clearable="false"
                placeholder="透镜"
                @update:model-value="onLensSelect"
              />
            </div>
          </template>
          <template v-if="contentRanks.length">
            <span class="visually-hidden">内容等级</span>
            <el-select
              class="lens-mode-select show-level-select"
              :model-value="readerShowLevel == null ? 'all' : String(readerShowLevel)"
              @update:model-value="onShowLevel"
            >
              <el-option label="全部等级" value="all" />
              <el-option
                v-for="r in contentRanks"
                :key="r"
                :label="`等级 ${r}`"
                :value="String(r)"
              />
            </el-select>
          </template>
          <template v-if="lensSelectTree.length && activeSelection">
            <span class="visually-hidden">内容过滤</span>
            <el-select
              class="lens-mode-select lens-content-filter-select"
              :model-value="ui.lensContentFilter"
              @update:model-value="onLensContentFilter($event as string)"
            >
              <el-option label="不隐藏" value="all" />
              <el-option label="仅有内容" value="content" />
              <el-option label="仅无内容" value="empty" />
            </el-select>
          </template>
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
        <button class="btn ghost" @click="toggleDetailsOpen()">
          {{ ui.detailsOpen ? '收起细节' : '展开细节' }}
        </button>
      </div>
      <div class="book-body">
        <div class="book-reading">
          <div class="book-content">
            <LensDigestView
              v-if="isDigestMode && toc"
              :book-id="bookId"
              :toc="toc"
              :lens-selection="activeSelection"
              :ruler-pick="activeRulerPick"
              @outline="digestOutlineSync = $event"
            />
            <ModulePage
              v-else-if="isModuleBook && chapterId && toc"
              :book-id="bookId"
              :toc="toc"
              :chapter-id="chapterId"
              :prev-chapter="prevChapter"
              :next-chapter="nextChapter"
              :lens-selection="activeSelection"
              :outline-key-ids="outlineKeyIds"
              @outline="moduleOutlineSync = $event"
            />
            <ChapterPage
              v-else-if="chapterId"
              :book-id="bookId"
              :chapter-id="chapterId"
              :prev-chapter="prevChapter"
              :next-chapter="nextChapter"
              :lens-selection="activeSelection"
            />
          </div>
          <DigestOutline
            v-if="isDigestMode && toc"
            :toc="toc"
            :book-id="bookId"
            :lens-selection="activeSelection"
            :ruler-pick="activeRulerPick"
            :sync-rows="digestOutlineSync"
          />
          <ModuleOutline
            v-else-if="isModuleBook && toc && chapterId"
            :toc="toc"
            :book-id="bookId"
            :lens-selection="activeSelection"
            :focus-chapter-id="chapterId"
            :sync-rows="moduleOutlineSync"
            :outline-selected-ids="outlineKeyIds"
            :outline-visible-ids="outlineVisibleIds"
            @toggle-key="onOutlineKeyToggle"
            @select-top-level="onOutlineSelectTopLevel"
          />
          <ChapterOutline
            v-else-if="currentChapter && !currentChapterHiddenByContentFilter"
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
