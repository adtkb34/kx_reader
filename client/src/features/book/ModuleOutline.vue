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
import { getBookShowLevel, getBookRulerPick, ui } from '@/stores/ui';
import type { DigestOutlineRow } from '@/features/book/outlineTypes';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
  focusChapterId?: string | null;
  /** When provided, lockstep with ModulePage body. */
  syncRows?: DigestOutlineRow[];
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

/** Same numbering as ModulePage body (titled keys / hang-offs). */
const localNumbered = computed((): DigestOutlineRow[] => {
  const list = localEntries.value.filter((e) => e.title);
  const nums = outlineNumbers(
    list.map((e) => ({
      id: e.anchorId ?? e.sectionId,
      level: e.level,
    })),
  );
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

const numbered = computed(() =>
  props.syncRows !== undefined ? props.syncRows : localNumbered.value,
);

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
</script>

<template>
  <aside v-if="numbered.length" class="chapter-outline">
    <nav class="chapter-outline-nav">
      <ul class="toc-sections digest-outline">
        <li
          v-for="e in numbered"
          :key="e.id"
          :class="[`lvl-${e.level}`, e.isKey ? 'ruler-outline-key' : 'ruler-outline-link']"
        >
          <a href="#" @click.prevent="goSection(e)">
            <span v-if="e.number" class="digest-outline-num">{{ e.number }}</span>
            <span class="toc-sec-title">
              <template v-if="!e.isKey && e.leafTitle && e.title !== e.leafTitle">
                {{ e.leafTitle }} ·
              </template>
              {{ e.title }}
            </span>
            <span v-if="e.chapterId && e.sectionId && noteCount(e.chapterId, e.sectionId)" class="note-count">
              {{ noteCount(e.chapterId, e.sectionId) }}
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
</template>
