<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import { visibleTocSections } from '@shared/lenses';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { DEFAULT_STATUS } from '@shared/annotations';
import TocTreeNodes from '@/features/book/TocTreeNodes.vue';
import { tocOf } from '@/stores/books';

const props = withDefaults(
  defineProps<{
    nodes: TocTreeNode[];
    bookId: string;
    currentChapterId: string;
    pageById: Record<string, TocChapter>;
    lensSelection?: LensSelection | null;
    /** Nesting depth in the TOC tree (0 = top-level siblings). */
    depth?: number;
  }>(),
  { depth: 0, lensSelection: null },
);

const anns = computed(() => annotationsFor(props.bookId));
const bookToc = computed(() => tocOf(props.bookId));

function leafIdsUnder(node: TocTreeNode): string[] {
  if (node.type === 'page') return [node.id];
  return node.children.flatMap(leafIdsUnder);
}

function isActiveTrail(node: TocTreeNode): boolean {
  return leafIdsUnder(node).includes(props.currentChapterId);
}

function chapterStats(pageId: string): { unread: number; question: number } {
  const ch = props.pageById[pageId];
  if (!ch) return { unread: 0, question: 0 };
  let unread = 0;
  let question = 0;
  for (const s of visibleTocSections(ch, props.lensSelection ?? null, bookToc.value)) {
    const st = anns.value[sectionKey(ch.id, s.id)]?.status ?? DEFAULT_STATUS;
    if (st === 'unread') unread++;
    if (st === 'question') question++;
  }
  return { unread, question };
}

function groupStats(node: TocTreeNode): { unread: number; question: number } {
  let unread = 0;
  let question = 0;
  for (const id of leafIdsUnder(node)) {
    const st = chapterStats(id);
    unread += st.unread;
    question += st.question;
  }
  return { unread, question };
}

function chapterLocation(chapterId: string): RouteLocationRaw {
  const query = props.lensSelection ? { ...props.lensSelection } : {};
  return {
    path: `/books/${props.bookId}/${chapterId}`,
    query,
  };
}
</script>

<template>
  <template v-for="node in nodes" :key="node.type + ':' + node.id">
    <details
      v-if="node.type === 'group'"
      class="toc-group toc-row"
      :class="`toc-row--depth-${depth}`"
      :key="'g-' + node.id + '-' + currentChapterId"
      :open="isActiveTrail(node)"
    >
      <summary class="toc-row-label toc-group-summary">
        <span class="toc-row-title">{{ node.title }}</span>
        <span class="toc-badges">
          <span
            v-if="groupStats(node).question"
            class="badge q"
            title="疑问"
          >{{ groupStats(node).question }}</span>
          <span
            v-if="groupStats(node).unread"
            class="badge u"
            title="未读"
          >{{ groupStats(node).unread }}</span>
        </span>
      </summary>
      <div class="toc-group-body">
        <TocTreeNodes
          :nodes="node.children"
          :book-id="bookId"
          :current-chapter-id="currentChapterId"
          :page-by-id="pageById"
          :lens-selection="lensSelection"
          :depth="depth + 1"
        />
      </div>
    </details>

    <div
      v-else
      class="toc-chapter toc-row"
      :class="[
        `toc-row--depth-${depth}`,
        { active: node.id === currentChapterId },
      ]"
    >
      <router-link :to="chapterLocation(node.id)" class="toc-row-label toc-chapter-link">
        <span class="toc-row-title">{{ node.title }}</span>
        <span class="toc-badges">
          <span
            v-if="chapterStats(node.id).question"
            class="badge q"
            title="疑问"
          >{{ chapterStats(node.id).question }}</span>
          <span
            v-if="chapterStats(node.id).unread"
            class="badge u"
            title="未读"
          >{{ chapterStats(node.id).unread }}</span>
        </span>
      </router-link>
    </div>
  </template>
</template>
