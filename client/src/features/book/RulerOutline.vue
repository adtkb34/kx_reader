<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensSelection } from '@shared/types';
import {
  rulerAnchorId,
  rulerOutlineEntries,
  findRulerModuleIndexId,
} from '@shared/ruler';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import {
  getBookShowLevel,
  setOutlinePickMode,
  ui,
  type OutlinePickMode,
} from '@/stores/ui';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
  focusChapterId?: string | null;
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

const selectedSet = computed(() => new Set(props.outlineSelectedIds ?? []));
const visibleSet = computed(() => new Set(props.outlineVisibleIds ?? props.outlineSelectedIds ?? []));

const entries = computed(() => {
  const all = rulerOutlineEntries(
    props.toc,
    props.lensSelection ?? null,
    getBookShowLevel(props.bookId),
    focusIndexId.value,
  );
  // Always list keys (for checking). Hang-off links only under visible keys.
  const out: typeof all = [];
  let keyVisible = false;
  for (const e of all) {
    if (e.isKey) {
      keyVisible = visibleSet.value.has(e.sectionId);
      out.push(e);
      continue;
    }
    if (keyVisible) out.push(e);
  }
  return out;
});

function noteCount(chapterId: string, sectionId: string): number {
  return anns.value[sectionKey(chapterId, sectionId)]?.notes.length ?? 0;
}

function goSection(chapterId: string, sectionId: string): void {
  const el = document.getElementById(rulerAnchorId(chapterId, sectionId));
  if (!el) return;
  const topbarOffset = 64;
  const y = el.getBoundingClientRect().top + window.scrollY - topbarOffset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function onCheck(sectionId: string, ev: Event): void {
  const input = ev.target as HTMLInputElement;
  emit('toggleKey', sectionId, input.checked);
}

function setMode(mode: OutlinePickMode): void {
  setOutlinePickMode(mode);
}
</script>

<template>
  <aside v-if="entries.length" class="chapter-outline">
    <div class="outline-toolbar">
      <div class="outline-pick-mode" role="group" aria-label="大纲选择方式">
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.outlinePickMode === 'multi' }"
          :aria-pressed="ui.outlinePickMode === 'multi'"
          @click="setMode('multi')"
        >
          多选
        </button>
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.outlinePickMode === 'single' }"
          :aria-pressed="ui.outlinePickMode === 'single'"
          @click="setMode('single')"
        >
          单选
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
    <nav class="chapter-outline-nav">
      <ul class="toc-sections digest-outline">
        <li
          v-for="e in entries"
          :key="e.chapterId + '#' + e.sectionId"
          :class="[
            `lvl-${e.level}`,
            e.isKey ? 'ruler-outline-key' : 'ruler-outline-link',
            e.isKey && !visibleSet.has(e.sectionId) ? 'outline-key-dim' : '',
          ]"
        >
          <label v-if="e.isKey" class="outline-key-row">
            <input
              type="checkbox"
              class="outline-key-check"
              :checked="selectedSet.has(e.sectionId)"
              @click.stop
              @change="onCheck(e.sectionId, $event)"
            />
            <a href="#" @click.prevent="goSection(e.chapterId, e.sectionId)">
              <span class="toc-sec-title">{{ e.title }}</span>
              <span v-if="noteCount(e.chapterId, e.sectionId)" class="note-count">
                {{ noteCount(e.chapterId, e.sectionId) }}
              </span>
            </a>
          </label>
          <a v-else href="#" @click.prevent="goSection(e.chapterId, e.sectionId)">
            <span class="toc-sec-title">
              <template v-if="e.leafTitle && e.title !== e.leafTitle">
                {{ e.leafTitle }} ·
              </template>
              {{ e.title }}
            </span>
            <span v-if="noteCount(e.chapterId, e.sectionId)" class="note-count">
              {{ noteCount(e.chapterId, e.sectionId) }}
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
</template>
