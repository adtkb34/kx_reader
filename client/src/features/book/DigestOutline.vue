<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensAxisId, LensSelection, PageLayer, RulerPick } from '@shared/types';
import {
  digestAnchorId,
  digestPageDisplayLevel,
  digestPathAnchorId,
  digestSectionDisplayLevel,
  filterChapters,
  filterChaptersWithContent,
  filterChaptersWithoutContent,
  groupChaptersForDigest,
  lensNodeTitle,
  selectionToFlatIds,
  visibleTocSections,
} from '@shared/lenses';
import { outlineNumbers } from '@shared/outlineNumbers';
import {
  axisBucketAnchorId,
  filterRulerModuleIndexIds,
  filterRulerOutlineEntries,
  listLeafModules,
  moduleMatchesRulerLeaf,
  normalizeRulerPick,
  rulerOutlineEntries,
  rulerAxisLeaves,
  rulerSidebarKeepIds,
  type RulerTickHangFilter,
} from '@shared/ruler';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { getBookShowLevel, setOutlinePickMode, ui, type OutlinePickMode } from '@/stores/ui';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';

export type { DigestOutlineRow };

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
  rulerPick?: RulerPick;
  /**
   * When provided, render these rows (kept in lockstep with body).
   * Omit to compute locally (fallback). Ignored when outline pick UI is on.
   */
  syncRows?: DigestOutlineRow[];
  /** moduleIndexId → selected outline key ids (ruler digest pick). */
  outlineSelectedByModule?: Record<string, string[]>;
  /** moduleIndexId → visible key ids (selected ∪ ancestors ∪ descendants). */
  outlineVisibleByModule?: Record<string, string[]>;
  /** When set, only list these leaf modules / chapters. */
  focusModuleIds?: string[] | null;
}>();

const emit = defineEmits<{
  toggleKey: [moduleIndexId: string, sectionId: string, checked: boolean];
  selectTopLevel: [];
}>();

const anns = computed(() => annotationsFor(props.bookId));
const pick = computed(() => normalizeRulerPick(props.toc, props.rulerPick ?? 'index'));
const hangFilter = computed(
  (): RulerTickHangFilter => ui.lensContentFilter as RulerTickHangFilter,
);

const pickEnabled = computed(
  () =>
    !!props.toc.ruler &&
    (props.outlineSelectedByModule !== undefined ||
      props.outlineVisibleByModule !== undefined),
);

type OutlineItem = {
  id: string;
  title: string;
  level: number;
  chapterId?: string;
  sectionId?: string;
  isKey?: boolean;
  leafTitle?: string;
  moduleIndexId?: string;
};

function buildDigestOutlineItems(
  hangMode: RulerTickHangFilter,
  applyContentFilter: boolean,
): OutlineItem[] {
  const sel = props.lensSelection ?? null;
  const showLevel = getBookShowLevel(props.bookId);
  const items: OutlineItem[] = [];

  if (props.toc.ruler) {
    const keep = rulerSidebarKeepIds(props.toc, sel);
    let modules = listLeafModules(props.toc).filter((m) => keep.has(m.indexChapterId));
    if (
      applyContentFilter &&
      (hangMode === 'content' || hangMode === 'empty')
    ) {
      const ids = filterRulerModuleIndexIds(props.toc, sel, showLevel, hangMode);
      modules = modules.filter((m) => ids.has(m.indexChapterId));
    }
    if (props.focusModuleIds?.length) {
      const want = new Set(props.focusModuleIds);
      modules = modules.filter((m) => want.has(m.indexChapterId));
    }

    if (pick.value === 'index') {
      const emitted = new Set<string>();
      for (const mod of modules) {
        for (let i = 0; i < mod.groupPath.length; i++) {
          const key = mod.groupPath.slice(0, i + 1).join('/');
          if (emitted.has(key)) continue;
          emitted.add(key);
          items.push({
            id: digestPathAnchorId(key),
            title: mod.groupPath[i]!,
            level: i + 1,
          });
        }
        const pageLevel = digestPageDisplayLevel(mod.groupPath.length);
        items.push({
          id: `page-${mod.indexChapterId}`,
          title: mod.title,
          level: pageLevel,
          chapterId: mod.indexChapterId,
          moduleIndexId: mod.indexChapterId,
        });
        const entries = filterRulerOutlineEntries(
          props.toc,
          sel,
          showLevel,
          rulerOutlineEntries(
            props.toc,
            sel,
            showLevel,
            mod.indexChapterId,
            pick.value,
          ),
          hangMode,
        );
        for (const e of entries) {
          if (!e.title) continue;
          const level = digestSectionDisplayLevel(mod.groupPath.length, e.level);
          items.push({
            id: e.anchorId ?? digestAnchorId(e.chapterId, e.sectionId),
            title: e.title,
            level,
            chapterId: e.chapterId,
            sectionId: e.sectionId,
            isKey: e.isKey,
            leafTitle: e.leafTitle,
            moduleIndexId: mod.indexChapterId,
          });
        }
      }
    } else {
      const axis = pick.value as LensAxisId;
      for (const leaf of rulerAxisLeaves(props.toc, axis)) {
        const leafMods = modules.filter((m) =>
          moduleMatchesRulerLeaf(props.toc, m.indexChapterId, axis, leaf),
        );
        if (leafMods.length === 0) continue;

        const axisId = axisBucketAnchorId(leaf);
        items.push({
          id: axisId,
          title: lensNodeTitle(props.toc, leaf),
          level: 1,
        });

        const emitted = new Set<string>();
        const boost = 1;
        let leafHasRows = false;
        for (const mod of leafMods) {
          const entries = filterRulerOutlineEntries(
            props.toc,
            sel,
            showLevel,
            rulerOutlineEntries(
              props.toc,
              sel,
              showLevel,
              mod.indexChapterId,
              pick.value,
            ),
            hangMode,
          );
          const leafEntries = [];
          let bucketLeaf: PageLayer | null = null;
          for (const e of entries) {
            if (e.anchorId?.startsWith('ruler-bucket-')) {
              bucketLeaf = e.sectionId as PageLayer;
              continue;
            }
            if (bucketLeaf !== leaf) continue;
            if (!e.title) continue;
            leafEntries.push(e);
          }
          if (leafEntries.length === 0 && hangMode !== 'all') continue;

          for (let i = 0; i < mod.groupPath.length; i++) {
            const key = mod.groupPath.slice(0, i + 1).join('/');
            const emitKey = `${leaf}/${key}`;
            if (emitted.has(emitKey)) continue;
            emitted.add(emitKey);
            items.push({
              id: `${axisId}--${digestPathAnchorId(key)}`,
              title: mod.groupPath[i]!,
              level: i + 1 + boost,
            });
          }
          const pageLevel = digestPageDisplayLevel(mod.groupPath.length) + boost;
          items.push({
            id: `page-${leaf}-${mod.indexChapterId}`,
            title: mod.title,
            level: pageLevel,
            chapterId: mod.indexChapterId,
            moduleIndexId: mod.indexChapterId,
          });
          leafHasRows = true;
          for (const e of leafEntries) {
            const level = digestSectionDisplayLevel(mod.groupPath.length, e.level) + boost;
            items.push({
              id: `${axisId}--${digestAnchorId(e.chapterId, e.sectionId)}`,
              title: e.title,
              level,
              chapterId: e.chapterId,
              sectionId: e.sectionId,
              isKey: e.isKey,
              leafTitle: e.leafTitle,
              moduleIndexId: mod.indexChapterId,
            });
          }
        }
        if (!leafHasRows && hangMode !== 'all') {
          items.pop(); // drop empty axis header
        }
      }
    }
  } else {
    const filterOn =
      applyContentFilter &&
      ui.lensContentFilter !== 'all' &&
      selectionToFlatIds(props.toc, sel).length > 0;
    const chapters = !filterOn
      ? filterChapters(props.toc.chapters, sel, props.toc)
      : ui.lensContentFilter === 'empty'
        ? filterChaptersWithoutContent(props.toc.chapters, sel, props.toc, showLevel)
        : filterChaptersWithContent(props.toc.chapters, sel, props.toc, showLevel);
    const explicitOnly = applyContentFilter && ui.lensContentFilter === 'content';
    const emitted = new Set<string>();
    const focus = props.focusModuleIds?.length
      ? new Set(props.focusModuleIds)
      : null;
    for (const g of groupChaptersForDigest(props.toc, chapters)) {
      for (let i = 0; i < g.groupPath.length; i++) {
        const key = g.groupPath.slice(0, i + 1).join('/');
        if (emitted.has(key)) continue;
        emitted.add(key);
        items.push({
          id: digestPathAnchorId(key),
          title: g.groupPath[i]!,
          level: i + 1,
        });
      }
      for (const ch of g.pages) {
        if (focus && !focus.has(ch.id)) continue;
        const sections = visibleTocSections(ch, sel, props.toc, showLevel, explicitOnly);
        if (sections.length === 0 && !(applyContentFilter && ui.lensContentFilter === 'empty')) {
          continue;
        }
        items.push({
          id: `page-${ch.id}`,
          title: ch.title,
          level: digestPageDisplayLevel(g.groupPath.length),
          chapterId: ch.id,
        });
        for (const s of sections) {
          items.push({
            id: digestAnchorId(ch.id, s.id),
            title: s.title,
            level: digestSectionDisplayLevel(g.groupPath.length, s.level),
            chapterId: ch.id,
            sectionId: s.id,
          });
        }
      }
    }
  }

  return items;
}

function filterItemsByOutlinePick(items: OutlineItem[]): OutlineItem[] {
  if (!pickEnabled.value) return items;
  const out: OutlineItem[] = [];
  let keyVisible = true;
  for (const e of items) {
    if (!e.title) continue;
    const mid = e.moduleIndexId;
    if (e.isKey && e.sectionId && mid && !e.id.includes('ruler-bucket-')) {
      const visible = new Set(props.outlineVisibleByModule?.[mid] ?? []);
      keyVisible = visible.has(e.sectionId);
      out.push(e);
      continue;
    }
    if (e.isKey) {
      out.push(e);
      continue;
    }
    // path / page headers (no section body id)
    if (!e.sectionId) {
      out.push(e);
      continue;
    }
    if (keyVisible) out.push(e);
  }
  return out;
}

const computedRows = computed((): DigestOutlineRow[] => {
  const visible = filterItemsByOutlinePick(buildDigestOutlineItems(hangFilter.value, true));
  const full =
    hangFilter.value === 'all' && ui.lensContentFilter === 'all'
      ? buildDigestOutlineItems('all', false)
      : buildDigestOutlineItems('all', false);
  const nums = outlineNumbers(full.map((i) => ({ id: i.id, level: i.level })));
  return visible.map((i) => ({
    ...i,
    number: nums.get(i.id) ?? '',
  }));
});

const rows = computed((): DigestOutlineRow[] => {
  if (pickEnabled.value) return computedRows.value;
  return props.syncRows !== undefined ? props.syncRows : computedRows.value;
});

function noteCount(chapterId?: string, sectionId?: string): number {
  if (!chapterId || !sectionId) return 0;
  return anns.value[sectionKey(chapterId, sectionId)]?.notes.length ?? 0;
}

function go(row: DigestOutlineRow): void {
  const el = document.getElementById(row.id);
  if (!el) return;
  const topbarOffset = 64;
  const y = el.getBoundingClientRect().top + window.scrollY - topbarOffset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function isCheckableKey(e: DigestOutlineRow): boolean {
  return (
    pickEnabled.value &&
    !!e.isKey &&
    !!e.sectionId &&
    !!e.moduleIndexId &&
    !e.id.includes('ruler-bucket-')
  );
}

function isSelected(e: DigestOutlineRow): boolean {
  if (!e.moduleIndexId || !e.sectionId) return false;
  return (props.outlineSelectedByModule?.[e.moduleIndexId] ?? []).includes(e.sectionId);
}

function isDimmed(e: DigestOutlineRow): boolean {
  if (!isCheckableKey(e) || !e.moduleIndexId || !e.sectionId) return false;
  const visible = props.outlineVisibleByModule?.[e.moduleIndexId] ?? [];
  return !visible.includes(e.sectionId);
}

function onCheckClick(e: DigestOutlineRow): void {
  if (!e.moduleIndexId || !e.sectionId) return;
  const currently = isSelected(e);
  if (ui.outlinePickMode === 'single') {
    if (currently) return;
    emit('toggleKey', e.moduleIndexId, e.sectionId, true);
    return;
  }
  emit('toggleKey', e.moduleIndexId, e.sectionId, !currently);
}

function setMode(mode: OutlinePickMode): void {
  setOutlinePickMode(mode);
}
</script>

<template>
  <aside v-if="rows.length || pickEnabled" class="chapter-outline">
    <div v-if="pickEnabled" class="outline-toolbar">
      <div class="outline-pick-mode" role="group" aria-label="大纲选择方式">
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.outlinePickMode === 'single' }"
          :aria-pressed="ui.outlinePickMode === 'single'"
          @click="setMode('single')"
        >
          单选
        </button>
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.outlinePickMode === 'multi' }"
          :aria-pressed="ui.outlinePickMode === 'multi'"
          @click="setMode('multi')"
        >
          多选
        </button>
      </div>
      <button
        type="button"
        class="outline-pick-mode-btn outline-select-tops"
        title="勾选全部最上层大纲键"
        @click="emit('selectTopLevel')"
      >
        全选
      </button>
    </div>
    <nav v-if="rows.length" class="chapter-outline-nav">
      <ul class="toc-sections digest-outline">
        <li
          v-for="r in rows"
          :key="r.id"
          :class="[
            `lvl-${r.level}`,
            r.isKey ? 'ruler-outline-key' : '',
            isDimmed(r) ? 'outline-key-dim' : '',
          ]"
        >
          <div v-if="isCheckableKey(r)" class="outline-key-row">
            <button
              type="button"
              class="toc-page-check-wrap"
              role="radio"
              :aria-checked="isSelected(r)"
              :aria-label="`选择 ${r.title}`"
              @click.prevent.stop="onCheckClick(r)"
            >
              <span
                class="outline-key-check"
                :class="{ 'is-on': isSelected(r) }"
              />
            </button>
            <a href="#" @click.prevent="go(r)">
              <span v-if="r.number" class="digest-outline-num">{{ r.number }}</span>
              <span class="toc-sec-title">{{ r.title }}</span>
              <span v-if="noteCount(r.chapterId, r.sectionId)" class="note-count">
                {{ noteCount(r.chapterId, r.sectionId) }}
              </span>
            </a>
          </div>
          <a v-else href="#" @click.prevent="go(r)">
            <span v-if="r.number" class="digest-outline-num">{{ r.number }}</span>
            <span class="toc-sec-title">{{ r.title }}</span>
            <span v-if="noteCount(r.chapterId, r.sectionId)" class="note-count">
              {{ noteCount(r.chapterId, r.sectionId) }}
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
</template>
