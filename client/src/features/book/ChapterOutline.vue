<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
import type { BookToc, LensSelection, TocChapter } from '@shared/types';
import { lensQueryFromSelection, visibleTocSections } from '@shared/lenses';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { getBookShowLevel } from '@/stores/ui';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  chapter: TocChapter;
  lensSelection?: LensSelection | null;
}>();

const route = useRoute();
const router = useRouter();
const anns = computed(() => annotationsFor(props.bookId));

const sections = computed(() =>
  visibleTocSections(
    props.chapter,
    props.lensSelection ?? null,
    props.toc,
    getBookShowLevel(props.bookId),
  ),
);

function noteCount(sectionId: string): number {
  return anns.value[sectionKey(props.chapter.id, sectionId)]?.notes.length ?? 0;
}

function sectionLocation(sectionId: string): RouteLocationRaw {
  return {
    path: `/books/${props.bookId}/${props.chapter.id}`,
    query: lensQueryFromSelection(props.lensSelection ?? null, props.toc),
    hash: `#${sectionId}`,
  };
}

function goSection(sectionId: string): void {
  router.push(sectionLocation(sectionId));
}

function isActive(sectionId: string): boolean {
  return route.hash === `#${sectionId}`;
}
</script>

<template>
  <aside v-if="sections.length" class="chapter-outline">
    <nav class="chapter-outline-nav">
      <ul class="toc-sections">
        <li
          v-for="s in sections"
          :key="s.id"
          :class="[`lvl-${s.level}`, { active: isActive(s.id) }]"
        >
          <a href="#" @click.prevent="goSection(s.id)">
            <span class="toc-sec-title">{{ s.title }}</span>
            <span v-if="noteCount(s.id)" class="note-count">{{ noteCount(s.id) }}</span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
</template>
