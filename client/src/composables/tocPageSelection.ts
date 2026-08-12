import { computed, watch } from 'vue';
import type { BookToc, TocTreeNode } from '@shared/types';
import { findRulerModuleIndexId } from '@shared/ruler';
import {
  expandOutlineKeySelection,
  applyOutlineKeyPick,
} from '@shared/outlineKeys';
import {
  expandTocSelectionToPages,
  flattenTocPickItems,
  toggleTocPickId,
  topLevelTocPickIds,
} from '@shared/tocPagePick';
import {
  getTocPageSelection,
  setTocPagePickMode,
  setTocPageSelection,
  ui,
} from '@/stores/ui';

/** Left-TOC group/page selection driving single- vs multi-page reading. */
export function useTocPageSelection(
  bookId: () => string,
  toc: () => BookToc | null | undefined,
  filteredTree: () => TocTreeNode[],
  routeChapterId: () => string,
) {
  const pickItems = computed(() => flattenTocPickItems(filteredTree()));
  const availableIds = computed(() => pickItems.value.map((i) => i.id));
  const topLevelIds = computed(() => topLevelTocPickIds(pickItems.value));

  function resolvePageId(raw: string): string {
    const t = toc();
    if (!t || !raw) return raw;
    if (t.ruler) return findRulerModuleIndexId(t, raw) ?? raw;
    return raw;
  }

  const selectedIds = computed(() => {
    const bid = bookId();
    if (!bid) return [] as string[];
    void ui.tocPagesByBook;
    const fromUi = ui.tocPagesByBook[bid];
    if (fromUi?.length) return fromUi;
    return getTocPageSelection(bid) ?? [];
  });

  /** Checkbox selection ∪ ancestors ∪ descendants (for dimming). */
  const visibleIds = computed(() =>
    expandOutlineKeySelection(pickItems.value, selectedIds.value),
  );

  /** Leaf pages covered by the current pick (group ⇒ descendants). */
  const orderedSelectedIds = computed(() =>
    expandTocSelectionToPages(pickItems.value, selectedIds.value),
  );

  function reconcile(): void {
    const bid = bookId();
    const items = pickItems.value;
    const avail = availableIds.value;
    if (!bid || avail.length === 0) return;
    const availSet = new Set(avail);
    const tops = topLevelIds.value;
    const prev = selectedIds.value.filter((id) => availSet.has(id));
    let next = prev;

    if (ui.tocPagePickMode === 'single') {
      const routeId = resolvePageId(routeChapterId());
      const prefer =
        (routeId && availSet.has(routeId) ? routeId : null) ??
        prev[0] ??
        tops[0] ??
        avail[0]!;
      next = prefer ? [prefer] : [];
    } else if (next.length === 0) {
      const routeId = resolvePageId(routeChapterId());
      if (routeId && availSet.has(routeId)) next = [routeId];
      else next = tops.length ? [...tops] : avail.slice(0, 1);
    }

    const same =
      next.length === selectedIds.value.length &&
      next.every((id, i) => id === selectedIds.value[i]);
    if (!same) setTocPageSelection(bid, next);
    else if (!(bid in ui.tocPagesByBook)) setTocPageSelection(bid, next);
  }

  watch(
    [availableIds, () => ui.tocPagePickMode, bookId, routeChapterId],
    () => {
      reconcile();
    },
    { immediate: true },
  );

  function onTogglePage(nodeId: string, checked: boolean): void {
    const bid = bookId();
    const items = pickItems.value;
    const avail = availableIds.value;
    if (!bid || !avail.includes(nodeId)) return;
    const prev = selectedIds.value;
    const tops = topLevelIds.value;

    if (ui.tocPagePickMode === 'single') {
      // Single mode must keep exactly one pick — ignore uncheck.
      if (!checked) return;
      setTocPageSelection(
        bid,
        applyOutlineKeyPick(avail, [nodeId], 'single', tops, nodeId),
      );
      return;
    }

    const toggled = toggleTocPickId(items, prev, nodeId, checked);
    if (!checked && toggled.length === 0) return;
    const added = toggled.filter((x) => !prev.includes(x));
    const prefer = added[added.length - 1];
    const next = applyOutlineKeyPick(avail, toggled, 'multi', tops, prefer);
    setTocPageSelection(bid, next);
  }

  function selectAllPages(): void {
    const bid = bookId();
    const tops = topLevelIds.value;
    const avail = availableIds.value;
    if (!bid || tops.length === 0) return;
    if (ui.tocPagePickMode === 'single') setTocPagePickMode('multi');
    setTocPageSelection(bid, [...tops]);
  }

  function setMode(mode: 'single' | 'multi'): void {
    setTocPagePickMode(mode);
  }

  /**
   * Digest-style body when the pick covers more than one leaf page.
   * A single checked group that expands to many pages counts as multi-page,
   * regardless of 单选/多选 toolbar mode.
   */
  const isMultiPageView = computed(() => orderedSelectedIds.value.length > 1);

  return {
    availableIds,
    selectedIds,
    visibleIds,
    orderedSelectedIds,
    isMultiPageView,
    onTogglePage,
    selectAllPages,
    setMode,
  };
}
