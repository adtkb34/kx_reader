import { computed, watch } from 'vue';
import type { BookToc, LensSelection } from '@shared/types';
import {
  applyOutlineKeyPick,
  expandOutlineKeySelection,
  filterRulerKeysBySelection,
  reconcileOutlineKeySelection,
  toggleOutlineKeyId,
  topLevelOutlineKeyIds,
  type OutlineKeyItem,
} from '@shared/outlineKeys';
import {
  buildRulerTree,
  findRulerModuleIndexId,
  type RulerKeyBlock,
} from '@shared/ruler';
import {
  getBookShowLevel,
  getOutlineKeySelection,
  outlineAvailableByScope,
  setOutlineKeySelection,
  setOutlinePickMode,
  ui,
} from '@/stores/ui';

function scopeKey(bookId: string, moduleId: string): string {
  return `${bookId}::${moduleId}`;
}

export function useRulerOutlineKeySelection(
  bookId: () => string,
  toc: () => BookToc | null | undefined,
  lensSelection: () => LensSelection | null | undefined,
  focusChapterId: () => string | null | undefined,
) {
  const moduleId = computed(() => {
    const t = toc();
    const focus = focusChapterId();
    if (!t || !focus) return '';
    return findRulerModuleIndexId(t, focus) ?? focus;
  });

  const allKeys = computed<RulerKeyBlock[]>(() => {
    const t = toc();
    if (!t?.ruler) return [];
    return (
      buildRulerTree(
        t,
        lensSelection() ?? null,
        getBookShowLevel(bookId()),
        moduleId.value || null,
      ) ?? []
    );
  });

  const keyItems = computed<OutlineKeyItem[]>(() =>
    allKeys.value
      .filter((k) => k.title)
      .map((k) => ({ id: k.sectionId, title: k.title, level: k.level })),
  );

  const availableIds = computed(() => keyItems.value.map((k) => k.id));
  const topLevelIds = computed(() => topLevelOutlineKeyIds(keyItems.value));

  const selectedIds = computed(() => {
    const bid = bookId();
    const mid = moduleId.value;
    if (!bid || !mid) return [] as string[];
    const scope = scopeKey(bid, mid);
    const fromUi = ui.outlineKeysByScope[scope];
    if (fromUi?.length) return fromUi;
    return getOutlineKeySelection(bid, mid) ?? [];
  });

  const visibleKeyIds = computed(() =>
    expandOutlineKeySelection(keyItems.value, selectedIds.value),
  );

  const filteredKeys = computed(() =>
    filterRulerKeysBySelection(allKeys.value, selectedIds.value),
  );

  function reconcile(): void {
    const bid = bookId();
    const mid = moduleId.value;
    const avail = availableIds.value;
    if (!bid || !mid || avail.length === 0) return;

    const scope = scopeKey(bid, mid);
    const prevSelected =
      (scope in ui.outlineKeysByScope
        ? ui.outlineKeysByScope[scope]
        : getOutlineKeySelection(bid, mid)) ?? null;
    const prevAvailable = outlineAvailableByScope[scope] ?? null;
    const next = reconcileOutlineKeySelection(
      avail,
      topLevelIds.value,
      prevSelected,
      prevAvailable,
      ui.outlinePickMode,
    );
    const same =
      next.length === (prevSelected?.length ?? 0) && next.every((id, i) => id === prevSelected?.[i]);
    const availSame =
      prevAvailable &&
      prevAvailable.length === avail.length &&
      prevAvailable.every((id, i) => id === avail[i]);
    if (same && availSame) {
      outlineAvailableByScope[scope] = [...avail];
      return;
    }
    setOutlineKeySelection(bid, mid, next, avail);
  }

  watch(
    [availableIds, moduleId, () => ui.outlinePickMode, bookId],
    () => {
      reconcile();
    },
    { immediate: true },
  );

  function onPick(requested: string[]): void {
    const bid = bookId();
    const mid = moduleId.value;
    const avail = availableIds.value;
    if (!bid || !mid || avail.length === 0) return;
    const prev = selectedIds.value;
    const added = requested.filter((id) => !prev.includes(id));
    const prefer = added[added.length - 1];
    const next = applyOutlineKeyPick(
      avail,
      requested,
      ui.outlinePickMode,
      topLevelIds.value.length ? topLevelIds.value : prev,
      prefer,
    );
    setOutlineKeySelection(bid, mid, next, avail);
  }

  function onToggleKey(id: string, checked: boolean): void {
    const bid = bookId();
    const mid = moduleId.value;
    const avail = availableIds.value;
    if (!bid || !mid || !avail.includes(id)) return;

    if (ui.outlinePickMode === 'single') {
      if (!checked) {
        // Keep at least one — ignore uncheck when it would clear all.
        if (selectedIds.value.length <= 1) return;
        onPick(selectedIds.value.filter((x) => x !== id));
        return;
      }
      onPick([id]);
      return;
    }

    const next = toggleOutlineKeyId(selectedIds.value, id, checked);
    onPick(next);
  }

  function selectTopLevelKeys(): void {
    const bid = bookId();
    const mid = moduleId.value;
    const tops = topLevelIds.value;
    const avail = availableIds.value;
    if (!bid || !mid || tops.length === 0) return;
    // Selecting every top-level key requires multi mode.
    if (ui.outlinePickMode === 'single') {
      setOutlinePickMode('multi');
    }
    setOutlineKeySelection(bid, mid, [...tops], avail);
  }

  return {
    moduleId,
    keyItems,
    selectedIds,
    visibleKeyIds,
    filteredKeys,
    allKeys,
    onPick,
    onToggleKey,
    selectTopLevelKeys,
  };
}
