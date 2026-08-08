/** Ruler-key row used to build the outline picker tree. */
export type OutlineKeyItem = {
  id: string;
  title: string;
  level: number;
};

export type OutlineKeyNode = OutlineKeyItem & {
  children?: OutlineKeyNode[];
};

/** Ids at the shallowest heading level (document order preserved). */
export function topLevelOutlineKeyIds(items: { id: string; level: number }[]): string[] {
  if (items.length === 0) return [];
  const min = Math.min(...items.map((i) => i.level));
  return items.filter((i) => i.level === min).map((i) => i.id);
}

/** Nest keys by markdown heading level (document order). */
export function buildOutlineKeyTree(items: OutlineKeyItem[]): OutlineKeyNode[] {
  const roots: OutlineKeyNode[] = [];
  const stack: OutlineKeyNode[] = [];

  for (const item of items) {
    const node: OutlineKeyNode = { id: item.id, title: item.title, level: item.level };
    while (stack.length && stack[stack.length - 1]!.level >= item.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function fallbackSelection(
  availableIds: string[],
  topLevelIds: string[],
  mode: 'single' | 'multi',
): string[] {
  const avail = new Set(availableIds);
  const tops = topLevelIds.filter((id) => avail.has(id));
  if (mode === 'single') {
    const id = tops[0] ?? availableIds[0];
    return id ? [id] : [];
  }
  if (tops.length) return tops;
  return availableIds.slice(0, 1);
}

/**
 * Reconcile stored picks when the visible key set changes.
 * Keeps still-valid ids; auto-adds newly appeared top-level keys (multi only).
 */
export function reconcileOutlineKeySelection(
  availableIds: string[],
  topLevelIds: string[],
  prevSelected: string[] | null,
  prevAvailable: string[] | null,
  mode: 'single' | 'multi',
): string[] {
  if (availableIds.length === 0) return [];
  const avail = new Set(availableIds);

  if (!prevSelected?.length) {
    return fallbackSelection(availableIds, topLevelIds, mode);
  }

  const kept = prevSelected.filter((id) => avail.has(id));
  const prevAvail = new Set(prevAvailable ?? []);
  const newTops = topLevelIds.filter((id) => avail.has(id) && !prevAvail.has(id));

  let next =
    mode === 'multi' ? unique([...kept, ...newTops]) : kept.length ? [kept[0]!] : [];

  if (next.length === 0) {
    next = fallbackSelection(availableIds, topLevelIds, mode);
  } else if (mode === 'single' && next.length > 1) {
    next = [next[0]!];
  }

  return next;
}

/**
 * Apply a user pick. Never returns empty when keys exist — falls back to `fallbackIds`
 * (typically current top-level / previous selection).
 */
export function applyOutlineKeyPick(
  availableIds: string[],
  requested: string[],
  mode: 'single' | 'multi',
  fallbackIds: string[],
  preferId?: string,
): string[] {
  if (availableIds.length === 0) return [];
  const avail = new Set(availableIds);
  let next = requested.filter((id) => avail.has(id));

  if (mode === 'single') {
    if (preferId && avail.has(preferId)) next = [preferId];
    else if (next.length) next = [next[next.length - 1]!];
  }

  if (next.length === 0) {
    const fb = fallbackIds.filter((id) => avail.has(id));
    if (fb.length) next = mode === 'single' ? [fb[0]!] : fb;
    else next = [availableIds[0]!];
  }

  return unique(next);
}

/**
 * Visible key ids for body/outline (checkboxes stay on `selectedIds` only):
 * - parent selected → self + all descendants
 * - child selected → self + all ancestors (siblings stay hidden)
 */
export function expandOutlineKeySelection(
  items: { id: string; level: number }[],
  selectedIds: string[],
): string[] {
  if (items.length === 0 || selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const want = new Set<string>();
  const stack: { id: string; level: number }[] = [];
  const ancestors = new Map<string, string[]>();

  for (const item of items) {
    while (stack.length && stack[stack.length - 1]!.level >= item.level) {
      stack.pop();
    }
    const chain = stack.map((s) => s.id);
    ancestors.set(item.id, chain);

    const underSelectedParent = chain.some((id) => selected.has(id));
    if (selected.has(item.id) || underSelectedParent) {
      want.add(item.id);
    }
    stack.push({ id: item.id, level: item.level });
  }

  for (const id of selectedIds) {
    if (!ancestors.has(id)) continue;
    want.add(id);
    for (const a of ancestors.get(id)!) want.add(a);
  }

  return items.filter((i) => want.has(i.id)).map((i) => i.id);
}

/** Add/remove one id without cascading to parents or children. */
export function toggleOutlineKeyId(
  selectedIds: string[],
  id: string,
  checked: boolean,
): string[] {
  if (checked) {
    return selectedIds.includes(id) ? [...selectedIds] : [...selectedIds, id];
  }
  return selectedIds.filter((x) => x !== id);
}

/**
 * Filter ruler key blocks by selection.
 * Parent selected ⇒ descendants included; nullish selection ⇒ no filter.
 */
export function filterRulerKeysBySelection<T extends { sectionId: string; level: number }>(
  keys: T[],
  selectedIds: string[] | null | undefined,
): T[] {
  if (selectedIds == null) return keys;
  const items = keys.map((k) => ({ id: k.sectionId, level: k.level }));
  const want = new Set(expandOutlineKeySelection(items, selectedIds));
  return keys.filter((k) => want.has(k.sectionId));
}
