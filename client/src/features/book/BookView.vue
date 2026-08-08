<script setup lang="ts">
import {
  getBookShowLevel,
  getStoredLensSelection,
  setBookLensSelection,
  setBookShowLevel,
  setLensPickMode,
  setLensReadMode,
  toggleDetailsOpen,
  toggleTocOpen,
  ui,
  type LensAxisPickMode,
  type LensReadMode,
} from '@/stores/ui';
import { useOrphans } from '@/composables/orphans';
import {
  allowedAxisSelectionIds,
  bookContentRanks,
  buildLensSelectTree,
  collapseEachAxisToSingle,
  collapseEachAxisToSingleLeaf,
  defaultSelection,
  filterChapters,
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
  visibleIdSet,
} from '@shared/lenses';
import {
  findRulerSkeletonChapter,
  findRulerModuleIndexId,
  resolveRulerLensSwitchChapter,
  rulerSidebarKeepIds,
  selectionUsesRulerHang,
} from '@shared/ruler';
import type { BookToc, LensSelection, PageLayer, TocChapter } from '@shared/types';
import LensDigestView from '@/features/book/LensDigestView.vue';
import DigestOutline from '@/features/book/DigestOutline.vue';
import RulerView from '@/features/book/RulerView.vue';
import RulerOutline from '@/features/book/RulerOutline.vue';
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
import { useRulerOutlineKeySelection } from '@/composables/outlineKeys';
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

function sanitizeSelection(
  sel: LensSelection | null,
  t: BookToc | null | undefined = toc.value,
): LensSelection | null {
  if (!t?.lenses) return null;
  const allowEmpty = !!t.ruler && ui.lensReadMode === 'ruler';
  const base = sel ?? (allowEmpty ? emptyLensSelection(t) : defaultSelection(t));
  if (!base) return null;
  const fallback = defaultSelection(t);
  const out: LensSelection = {};
  for (const axis of lensAxisIds(t)) {
    const allowed = allowedAxisSelectionIds(t, axis);
    const pick = normalizeAxisSelection(base[axis]).filter((id) => allowed.has(id));
    if (pick.length > 0) out[axis] = pick;
    else if (allowEmpty) out[axis] = [];
    else if (fallback?.[axis]?.length) out[axis] = [...fallback[axis]];
  }
  const flat = selectionToFlatIds(t, out);
  const normalized = flatIdsToSelection(t, flat, flat, { allowEmpty });
  if (!normalized) return null;
  if (ui.lensPickMode === 'single' && !allowEmpty) {
    return collapseEachAxisToSingle(t, normalized);
  }
  if (ui.lensPickMode === 'single' && allowEmpty) {
    // Single-pick still collapses when something is chosen; empty stays empty.
    const hasAny = selectionToFlatIds(t, normalized).length > 0;
    if (!hasAny) return normalized;
    return collapseEachAxisToSingle(t, normalized);
  }
  return normalized;
}

function emptyLensSelection(t: BookToc): LensSelection {
  const out: LensSelection = {};
  for (const axis of lensAxisIds(t)) out[axis] = [];
  return out;
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

const hangUnderRuler = computed(
  () => !!toc.value && selectionUsesRulerHang(toc.value, activeSelection.value),
);

const isRulerMode = computed(
  () =>
    !!toc.value &&
    !!toc.value.ruler &&
    hasLenses(toc.value) &&
    !!activeSelection.value &&
    (ui.lensReadMode === 'ruler' || hangUnderRuler.value),
);

const filteredChapters = computed(() => {
  const t = toc.value;
  if (!t) return [];
  let visible = filterChapters(t.chapters, activeSelection.value, t);
  const current = t.chapters.find((c) => c.id === chapterId.value);
  if (current && !visible.some((c) => c.id === current.id)) {
    visible = [...visible, current];
  }
  if (!t.ruler) return visible;
  const keep = rulerSidebarKeepIds(t, activeSelection.value, isRulerMode.value);
  const kept = visible.filter((c) => keep.has(c.id) || c.id === chapterId.value);
  return kept.length ? kept : visible;
});

const lensSelectTree = computed(() => (toc.value ? buildLensSelectTree(toc.value) : []));

const flatLensIds = computed(() =>
  toc.value ? selectionToFlatIds(toc.value, activeSelection.value) : [],
);

const contentRanks = computed(() => (toc.value ? bookContentRanks(toc.value) : []));

/** `null` = 全部; track ui.showLevelByBook for the select label. */
const readerShowLevel = computed(() => getBookShowLevel(bookId.value));

function onShowLevel(raw: string | number | null): void {
  if (raw === 'all' || raw == null || raw === '') {
    setBookShowLevel(bookId.value, null);
    return;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  setBookShowLevel(bookId.value, Number.isFinite(n) ? n : null);
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
  if (t.ruler) return resolveRulerLensSwitchChapter(t, currentId, nextSel);
  return resolveLensSwitchChapter(t, currentId, nextSel, prevSel);
}

function onLensSelect(options: PageLayer[]): void {
  const t = toc.value;
  const sel = activeSelection.value;
  if (!t || !sel) return;
  const allowEmpty = !!t.ruler && ui.lensReadMode === 'ruler';
  const prevFlat = selectionToFlatIds(t, sel);
  const added = options.filter((id) => !prevFlat.includes(id));
  let nextSel = flatIdsToSelection(t, options, prevFlat, { allowEmpty });
  if (!nextSel) return;
  nextSel = finalizeSelection(t, nextSel, added, allowEmpty);
  // Never change chapter when toggling lenses — only update the selection query.
  setBookLensSelection(bookId.value, nextSel);
  syncLensQueryToRoute(nextSel, t, 'replace', chapterId.value);
}

function onLensPickMode(mode: LensAxisPickMode): void {
  const t = toc.value;
  // Read storage before flipping pick mode — sanitize would collapse activeSelection
  // and sameLensSelection would early-return without leaving the index page.
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
  if (mode === 'ruler' && !toc.value?.ruler) {
    setLensReadMode('page');
    return;
  }
  const t = toc.value;
  const rawSel =
    (t && (ui.lensByBook[bookId.value] ?? getStoredLensSelection(bookId.value))) ||
    activeSelection.value;
  setLensReadMode(mode);
  if (!t?.ruler || !chapterId.value) return;

  // Explicit 单页 while multi-hanging: collapse to one leaf and open that page.
  if (mode === 'page') {
    let sel = rawSel ? sanitizeSelection(rawSel, t) : null;
    if (sel && selectionUsesRulerHang(t, sel)) {
      setLensPickMode('single');
      sel = collapseEachAxisToSingleLeaf(t, sel);
      setBookLensSelection(bookId.value, sel);
    } else if (sel) {
      setBookLensSelection(bookId.value, sel);
    }
    if (sel) {
      const target = resolveRulerLensSwitchChapter(t, chapterId.value, sel);
      if (target !== chapterId.value) {
        syncLensQueryToRoute(sel, t, 'replace', target);
      }
    }
    return;
  }

  if (mode === 'digest') {
    if (rawSel) {
      const sel = sanitizeSelection(rawSel, t);
      if (sel) setBookLensSelection(bookId.value, sel);
    }
    return;
  }

  // Manual 尺子: go to this module's index skeleton (not always the first in the book).
  const sel = activeSelection.value;
  if (!sel) return;
  const indexId =
    findRulerModuleIndexId(t, chapterId.value) ?? findRulerSkeletonChapter(t)?.id;
  const dest = indexId ?? resolveRulerLensSwitchChapter(t, chapterId.value, sel);
  if (dest !== chapterId.value) syncLensQueryToRoute(sel, t, 'replace', dest);
}

const isDigestMode = computed(
  () =>
    !!toc.value &&
    hasLenses(toc.value) &&
    ui.lensReadMode === 'digest' &&
    !!activeSelection.value &&
    !isRulerMode.value,
);

/** Digest hides the book TOC; ruler keeps it (keys page stays navigable). */
const hideBookToc = computed(() => isDigestMode.value);

const filteredTree = computed(() => {
  const t = toc.value;
  if (!t) return [];
  let ids = visibleIdSet(t.chapters, activeSelection.value, t);
  // Keep the chapter being read even if it fell out of the lens filter (e.g. uncheck).
  if (chapterId.value) ids.add(chapterId.value);
  if (t.ruler) {
    const keep = rulerSidebarKeepIds(t, activeSelection.value, isRulerMode.value);
    ids = new Set([...ids].filter((id) => keep.has(id) || id === chapterId.value));
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
  () => [toc.value?.ruler, ui.lensReadMode] as const,
  ([ruler, mode]) => {
    if (mode === 'ruler' && !ruler) setLensReadMode('page');
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
      v-if="ui.tocOpen && !hideBookToc"
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
          v-if="!ui.tocOpen && !hideBookToc"
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
          v-if="(lensSelectTree.length && activeSelection) || contentRanks.length"
          class="lens-controls"
        >
          <template v-if="lensSelectTree.length && activeSelection">
            <span class="visually-hidden">阅读模式</span>
            <el-select
              class="lens-mode-select"
              :model-value="isRulerMode ? 'ruler' : ui.lensReadMode"
              @update:model-value="onLensReadMode($event as LensReadMode)"
            >
              <el-option label="单页" value="page" />
              <el-option label="汇总" value="digest" />
              <el-option v-if="toc.ruler" label="尺子" value="ruler" />
            </el-select>
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
                :clearable="!!toc.ruler && ui.lensReadMode === 'ruler'"
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
            <RulerView
              v-if="isRulerMode && toc"
              :book-id="bookId"
              :toc="toc"
              :lens-selection="activeSelection"
              :focus-chapter-id="chapterId"
              :outline-key-ids="outlineKeyIds"
            />
            <LensDigestView
              v-else-if="isDigestMode && toc"
              :book-id="bookId"
              :toc="toc"
              :lens-selection="activeSelection"
            />
            <ChapterPage
              v-else-if="chapterId"
              :key="chapterId"
              :book-id="bookId"
              :chapter-id="chapterId"
              :prev-chapter="prevChapter"
              :next-chapter="nextChapter"
              :lens-selection="activeSelection"
            />
          </div>
          <RulerOutline
            v-if="isRulerMode && toc"
            :toc="toc"
            :book-id="bookId"
            :lens-selection="activeSelection"
            :focus-chapter-id="chapterId"
            :outline-selected-ids="outlineKeyIds"
            :outline-visible-ids="outlineVisibleIds"
            @toggle-key="onOutlineKeyToggle"
            @select-top-level="onOutlineSelectTopLevel"
          />
          <DigestOutline
            v-else-if="isDigestMode && toc"
            :toc="toc"
            :book-id="bookId"
            :lens-selection="activeSelection"
          />
          <ChapterOutline
            v-else-if="currentChapter"
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
