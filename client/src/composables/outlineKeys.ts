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
  listLeafModules,
  normalizeRulerPick,
  rulerSidebarKeepIds,
  type RulerKeyBlock,
} from '@shared/ruler';
import {
  getBookRulerPick,
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

function keyItemsForModule(
  toc: BookToc,
  bookId: string,
  moduleId: string,
  lensSelection: LensSelection | null | undefined,
): OutlineKeyItem[] {
  const keys =
    buildRulerTree(
      toc,
      lensSelection ?? null,
      getBookShowLevel(bookId),
      moduleId,
      normalizeRulerPick(toc, getBookRulerPick(bookId)),
    ) ?? [];
  return keys
    .filter((k) => k.title)
    .map((k) => ({ id: k.sectionId, title: k.title, level: k.level }));
}

function selectedIdsForModule(bookId: string, moduleId: string): string[] {
  const scope = scopeKey(bookId, moduleId);
  const fromUi = ui.outlineKeysByScope[scope];
  if (fromUi?.length) return fromUi;
  return getOutlineKeySelection(bookId, moduleId) ?? [];
}

function reconcileModule(
  bookId: string,
  moduleId: string,
  items: OutlineKeyItem[],
): void {
  const avail = items.map((k) => k.id);
  if (!bookId || !moduleId || avail.length === 0) return;
  const tops = topLevelOutlineKeyIds(items);
  const scope = scopeKey(bookId, moduleId);
  const prevSelected =
    (scope in ui.outlineKeysByScope
      ? ui.outlineKeysByScope[scope]
      : getOutlineKeySelection(bookId, moduleId)) ?? null;
  const prevAvailable = outlineAvailableByScope[scope] ?? null;
  const next = reconcileOutlineKeySelection(
    avail,
    tops,
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
  setOutlineKeySelection(bookId, moduleId, next, avail);
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
        normalizeRulerPick(t, getBookRulerPick(bookId())),
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
    return selectedIdsForModule(bid, mid);
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
    if (!bid || !mid) return;
    reconcileModule(bid, mid, keyItems.value);
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
      // Single mode must keep exactly one pick — ignore uncheck.
      if (!checked) return;
      onPick([id]);
      return;
    }

    const next = toggleOutlineKeyId(keyItems.value, selectedIds.value, id, checked);
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

/** Digest mode: reconcile / toggle outline keys across all visible ruler modules. */
export function useDigestOutlineKeySelection(
  bookId: () => string,
  toc: () => BookToc | null | undefined,
  lensSelection: () => LensSelection | null | undefined,
) {
  const moduleIds = computed(() => {
    const t = toc();
    if (!t?.ruler) return [] as string[];
    const keep = rulerSidebarKeepIds(t, lensSelection() ?? null);
    return listLeafModules(t)
      .filter((m) => keep.has(m.indexChapterId))
      .map((m) => m.indexChapterId);
  });

  function itemsFor(mid: string): OutlineKeyItem[] {
    const t = toc();
    const bid = bookId();
    if (!t?.ruler || !bid || !mid) return [];
    return keyItemsForModule(t, bid, mid, lensSelection());
  }

  function reconcileAll(): void {
    const bid = bookId();
    if (!bid) return;
    for (const mid of moduleIds.value) {
      reconcileModule(bid, mid, itemsFor(mid));
    }
  }

  watch(
    [moduleIds, () => ui.outlinePickMode, bookId, () => getBookRulerPick(bookId()), lensSelection],
    () => {
      reconcileAll();
    },
    { immediate: true },
  );

  /** moduleIndexId → selected key ids (reactive via ui.outlineKeysByScope). */
  const selectedByModule = computed(() => {
    const bid = bookId();
    const out: Record<string, string[]> = {};
    if (!bid) return out;
    // Depend on reactive map
    void ui.outlineKeysByScope;
    for (const mid of moduleIds.value) {
      out[mid] = selectedIdsForModule(bid, mid);
    }
    return out;
  });

  const visibleByModule = computed(() => {
    const out: Record<string, string[]> = {};
    for (const mid of moduleIds.value) {
      out[mid] = expandOutlineKeySelection(itemsFor(mid), selectedByModule.value[mid] ?? []);
    }
    return out;
  });

  function onToggleKey(moduleId: string, id: string, checked: boolean): void {
    const bid = bookId();
    const items = itemsFor(moduleId);
    const avail = items.map((k) => k.id);
    if (!bid || !moduleId || !avail.includes(id)) return;
    const prev = selectedIdsForModule(bid, moduleId);
    const tops = topLevelOutlineKeyIds(items);

    if (ui.outlinePickMode === 'single') {
      // Single mode must keep exactly one pick — ignore uncheck.
      if (!checked) return;
      setOutlineKeySelection(
        bid,
        moduleId,
        applyOutlineKeyPick(avail, [id], 'single', tops, id),
        avail,
      );
      return;
    }

    const toggled = toggleOutlineKeyId(items, prev, id, checked);
    const added = toggled.filter((x) => !prev.includes(x));
    const prefer = added[added.length - 1];
    const next = applyOutlineKeyPick(avail, toggled, 'multi', tops, prefer);
    setOutlineKeySelection(bid, moduleId, next, avail);
  }

  function selectTopLevelKeys(): void {
    const bid = bookId();
    if (!bid) return;
    if (ui.outlinePickMode === 'single') {
      setOutlinePickMode('multi');
    }
    for (const mid of moduleIds.value) {
      const items = itemsFor(mid);
      const tops = topLevelOutlineKeyIds(items);
      const avail = items.map((k) => k.id);
      if (tops.length === 0) continue;
      setOutlineKeySelection(bid, mid, [...tops], avail);
    }
  }

  return {
    moduleIds,
    selectedByModule,
    visibleByModule,
    onToggleKey,
    selectTopLevelKeys,
  };
}
