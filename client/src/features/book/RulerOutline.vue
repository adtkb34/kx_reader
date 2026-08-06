<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensSelection } from '@shared/types';
import { rulerAnchorId, rulerOutlineEntries } from '@shared/ruler';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { getBookShowLevel } from '@/stores/ui';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
}>();

const anns = computed(() => annotationsFor(props.bookId));
const entries = computed(() =>
  rulerOutlineEntries(props.toc, props.lensSelection ?? null, getBookShowLevel(props.bookId)),
);
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
</script>

<template>
  <aside v-if="entries.length" class="chapter-outline">
    <nav class="chapter-outline-nav">
      <ul class="toc-sections digest-outline">
        <li
          v-for="e in entries"
          :key="e.chapterId + '#' + e.sectionId"
          :class="[`lvl-${e.level}`, e.isKey ? 'ruler-outline-key' : 'ruler-outline-link']"
        >
          <a href="#" @click.prevent="goSection(e.chapterId, e.sectionId)">
            <span class="toc-sec-title">
              <template v-if="!e.isKey && e.leafTitle && e.title !== e.leafTitle">
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
