<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import TocTreeNodes from '@/components/TocTreeNodes.vue';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  currentChapterId: string;
  /** Pre-filtered tree (by reading lens). */
  tree: TocTreeNode[];
  lensSelection?: LensSelection | null;
}>();

const pageById = computed(() => {
  const map: Record<string, TocChapter> = {};
  for (const ch of props.toc.chapters) map[ch.id] = ch;
  return map;
});
</script>

<template>
  <aside class="toc">
    <div class="toc-book-title">{{ toc.title }}</div>
    <nav class="toc-tree">
      <TocTreeNodes
        :nodes="tree"
        :book-id="bookId"
        :current-chapter-id="currentChapterId"
        :page-by-id="pageById"
        :lens-selection="lensSelection"
      />
    </nav>
  </aside>
</template>
