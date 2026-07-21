<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { TocChapter, TocTreeNode } from '@shared/types';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { DEFAULT_STATUS, statusMeta } from '@shared/annotations';
import TocTreeNodes from '@/components/TocTreeNodes.vue';

const props = defineProps<{
  nodes: TocTreeNode[];
  bookId: string;
  currentChapterId: string;
  pageById: Record<string, TocChapter>;
}>();

const router = useRouter();
const anns = computed(() => annotationsFor(props.bookId));

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
  for (const s of ch.sections) {
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

function statusColor(chapterId: string, sectionId: string): string {
  const st = anns.value[sectionKey(chapterId, sectionId)]?.status ?? DEFAULT_STATUS;
  return statusMeta(st).color;
}

function noteCount(chapterId: string, sectionId: string): number {
  return anns.value[sectionKey(chapterId, sectionId)]?.notes.length ?? 0;
}

function goSection(ch: TocChapter, sectionId: string): void {
  router.push({ path: `/books/${props.bookId}/${ch.id}`, hash: `#${sectionId}` });
}
</script>

<template>
  <template v-for="node in nodes" :key="node.type + ':' + node.id">
    <details
      v-if="node.type === 'group'"
      class="toc-group"
      :key="'g-' + node.id + '-' + currentChapterId"
      :open="isActiveTrail(node)"
    >
      <summary class="toc-group-summary">
        <span class="toc-group-title">{{ node.title }}</span>
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
        />
      </div>
    </details>

    <div
      v-else
      class="toc-chapter"
      :class="{ active: node.id === currentChapterId }"
    >
      <router-link :to="`/books/${bookId}/${node.id}`" class="toc-chapter-link">
        <span class="toc-chapter-title">{{ node.title }}</span>
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
      <ul
        v-if="node.id === currentChapterId && pageById[node.id]"
        class="toc-sections"
      >
        <li
          v-for="s in pageById[node.id].sections"
          :key="s.id"
          :class="`lvl-${s.level}`"
        >
          <a href="#" @click.prevent="goSection(pageById[node.id], s.id)">
            <span class="dot" :style="{ background: statusColor(node.id, s.id) }" />
            <span class="toc-sec-title">{{ s.title }}</span>
            <span v-if="noteCount(node.id, s.id)" class="note-count">
              {{ noteCount(node.id, s.id) }}
            </span>
          </a>
        </li>
      </ul>
    </div>
  </template>
</template>
