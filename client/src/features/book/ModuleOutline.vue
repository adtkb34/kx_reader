<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensSelection } from '@shared/types';
import {
  findRulerModuleIndexId,
  filterRulerOutlineEntries,
  normalizeRulerPick,
  rulerAnchorId,
  rulerOutlineEntries,
  type RulerTickHangFilter,
} from '@shared/ruler';
import { outlineNumbers } from '@shared/outlineNumbers';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import {
  getBookShowLevel,
  getBookRulerPick,
  setOutlinePickMode,
  ui,
  type OutlinePickMode,
} from '@/stores/ui';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
  focusChapterId?: string | null;
  /** When provided, lockstep with ModulePage body (no key pick UI). */
  syncRows?: DigestOutlineRow[];
  outlineSelectedIds?: string[];
  /** Key ids visible in body: selected ∪ ancestors ∪ descendants. */
  outlineVisibleIds?: string[];
}>();

const emit = defineEmits<{
  toggleKey: [id: string, checked: boolean];
  selectTopLevel: [];
}>();

const anns = computed(() => annotationsFor(props.bookId));
const focusIndexId = computed(() => {
  if (!props.focusChapterId) return null;
  return findRulerModuleIndexId(props.toc, props.focusChapterId) ?? props.focusChapterId;
});
const rulerPick = computed(() =>
  normalizeRulerPick(props.toc, getBookRulerPick(props.bookId)),
);
const hangFilter = computed(
  (): RulerTickHangFilter => ui.lensContentFilter as RulerTickHangFilter,
);

const pickEnabled = computed(
  () => props.outlineSelectedIds !== undefined || props.outlineVisibleIds !== undefined,
);
const selectedSet = computed(() => new Set(props.outlineSelectedIds ?? []));
const visibleSet = computed(
  () => new Set(props.outlineVisibleIds ?? props.outlineSelectedIds ?? []),
);

const localEntries = computed(() =>
  filterRulerOutlineEntries(
    props.toc,
    props.lensSelection ?? null,
    getBookShowLevel(props.bookId),
    rulerOutlineEntries(
      props.toc,
      props.lensSelection ?? null,
      getBookShowLevel(props.bookId),
      focusIndexId.value,
      rulerPick.value,
    ),
    hangFilter.value,
  ),
);

/** Full hang set for stable numbers (ignore 仅有/仅无内容). */
const stableNumMap = computed(() => {
  const entries = filterRulerOutlineEntries(
    props.toc,
    props.lensSelection ?? null,
    getBookShowLevel(props.bookId),
    rulerOutlineEntries(
      props.toc,
      props.lensSelection ?? null,
      getBookShowLevel(props.bookId),
      focusIndexId.value,
      rulerPick.value,
    ),
    'all',
  );
  return outlineNumbers(
    entries
      .filter((e) => e.title)
      .map((e) => ({
        id: e.anchorId ?? e.sectionId,
        level: e.level,
      })),
  );
});

/** Keys always listed; hang-offs only under visible keys when pick UI is on. */
const displayEntries = computed(() => {
  const all = localEntries.value;
  if (!pickEnabled.value) {
    return all.filter((e) => e.title);
  }
  const out: typeof all = [];
  let keyVisible = false;
  for (const e of all) {
    if (e.isKey) {
      keyVisible = visibleSet.value.has(e.sectionId);
      if (e.title) out.push(e);
      continue;
    }
    if (keyVisible && e.title) out.push(e);
  }
  return out;
});

const localNumbered = computed((): DigestOutlineRow[] => {
  const list = displayEntries.value;
  const nums = stableNumMap.value;
  return list.map((e) => ({
    id: e.anchorId ?? rulerAnchorId(e.chapterId, e.sectionId),
    title: e.title,
    level: e.level,
    number: nums.get(e.anchorId ?? e.sectionId) ?? '',
    chapterId: e.chapterId,
    sectionId: e.sectionId,
    isKey: e.isKey,
    leafTitle: e.leafTitle,
  }));
});

const numbered = computed(() => {
  if (pickEnabled.value) return localNumbered.value;
  return props.syncRows !== undefined ? props.syncRows : localNumbered.value;
});

function noteCount(chapterId: string, sectionId: string): number {
  return anns.value[sectionKey(chapterId, sectionId)]?.notes.length ?? 0;
}

function goSection(e: DigestOutlineRow): void {
  const el = document.getElementById(e.id);
  if (!el) return;
  const topbarOffset = 64;
  const y = el.getBoundingClientRect().top + window.scrollY - topbarOffset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function onCheckClick(sectionId: string): void {
  const currently = selectedSet.value.has(sectionId);
  if (ui.outlinePickMode === 'single') {
    if (currently) return;
    emit('toggleKey', sectionId, true);
    return;
  }
  emit('toggleKey', sectionId, !currently);
}

function setMode(mode: OutlinePickMode): void {
  setOutlinePickMode(mode);
}

function isCheckableKey(e: DigestOutlineRow): boolean {
  return !!e.isKey && !!e.sectionId && !e.id.startsWith('ruler-bucket-');
}
</script>

<template>
  <aside v-if="numbered.length || pickEnabled" class="chapter-outline">
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
    <nav v-if="numbered.length" class="chapter-outline-nav">
      <ul class="toc-sections digest-outline">
        <li
          v-for="e in numbered"
          :key="e.id"
          :class="[
            `lvl-${e.level}`,
            e.isKey ? 'ruler-outline-key' : 'ruler-outline-link',
            pickEnabled && isCheckableKey(e) && !visibleSet.has(e.sectionId!)
              ? 'outline-key-dim'
              : '',
          ]"
        >
          <div v-if="pickEnabled && isCheckableKey(e)" class="outline-key-row">
            <button
              type="button"
              class="toc-page-check-wrap"
              role="radio"
              :aria-checked="selectedSet.has(e.sectionId!)"
              :aria-label="`选择 ${e.title}`"
              @click.prevent.stop="onCheckClick(e.sectionId!)"
            >
              <span
                class="outline-key-check"
                :class="{ 'is-on': selectedSet.has(e.sectionId!) }"
              />
            </button>
            <a href="#" @click.prevent="goSection(e)">
              <span v-if="e.number" class="digest-outline-num">{{ e.number }}</span>
              <span class="toc-sec-title">{{ e.title }}</span>
              <span
                v-if="e.chapterId && e.sectionId && noteCount(e.chapterId, e.sectionId)"
                class="note-count"
              >
                {{ noteCount(e.chapterId, e.sectionId) }}
              </span>
            </a>
          </div>
          <a v-else href="#" @click.prevent="goSection(e)">
            <span v-if="e.number" class="digest-outline-num">{{ e.number }}</span>
            <span class="toc-sec-title">
              <template v-if="!e.isKey && e.leafTitle && e.title !== e.leafTitle">
                {{ e.leafTitle }} ·
              </template>
              {{ e.title }}
            </span>
            <span
              v-if="e.chapterId && e.sectionId && noteCount(e.chapterId, e.sectionId)"
              class="note-count"
            >
              {{ noteCount(e.chapterId, e.sectionId) }}
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
</template>
