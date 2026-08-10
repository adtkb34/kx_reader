<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import { visibleTocSections } from '@shared/lenses';
import { tocOutlineKey } from '@shared/outlineNumbers';
import { annotationsFor, sectionKey } from '@/stores/annotations';
import { DEFAULT_STATUS } from '@shared/annotations';
import TocTreeNodes from '@/features/book/TocTreeNodes.vue';
import { tocOf } from '@/stores/books';
import { getBookShowLevel, ui, type TocSiblingExpand } from '@/stores/ui';

const props = withDefaults(
  defineProps<{
    nodes: TocTreeNode[];
    bookId: string;
    currentChapterId: string;
    pageById: Record<string, TocChapter>;
    lensSelection?: LensSelection | null;
    /** Nesting depth in the TOC tree (0 = top-level siblings). */
    depth?: number;
    /**
     * When set, group open state is controlled:
     * - single: only one sibling group open at this level
     * - multi: siblings may stay open together
     * When null, open follows the active chapter trail (sidebar default).
     */
    siblingExpand?: TocSiblingExpand | null;
    /** Outline labels from the full filtered tree (`group:id` / `page:id` → `1.2`). */
    outlineNums?: ReadonlyMap<string, string> | null;
  }>(),
  { depth: 0, lensSelection: null, siblingExpand: null, outlineNums: null },
);

const anns = computed(() => annotationsFor(props.bookId));
const bookToc = computed(() => tocOf(props.bookId));

/** Controlled open group ids at this sibling level (lightbox modes). */
const openIds = ref<Set<string>>(new Set());

function leafIdsUnder(node: TocTreeNode): string[] {
  if (node.type === 'page') return [node.id];
  return node.children.flatMap(leafIdsUnder);
}

function isActiveTrail(node: TocTreeNode): boolean {
  return leafIdsUnder(node).includes(props.currentChapterId);
}

function trailOpenIds(): Set<string> {
  const open = new Set<string>();
  for (const node of props.nodes) {
    if (node.type === 'group' && isActiveTrail(node)) open.add(node.id);
  }
  return open;
}

function pruneOpenIds(ids: Set<string>): Set<string> {
  const valid = new Set(
    props.nodes.filter((n): n is Extract<TocTreeNode, { type: 'group' }> => n.type === 'group').map((n) => n.id),
  );
  return new Set([...ids].filter((id) => valid.has(id)));
}

/** Keep one open group when entering single mode — prefer trail if already open. */
function collapseToOne(ids: Set<string>): Set<string> {
  if (ids.size <= 1) return ids;
  const trail = trailOpenIds();
  const prefer = [...ids].find((id) => trail.has(id));
  return new Set([prefer ?? [...ids][0]!]);
}

watch(
  () => props.siblingExpand,
  (mode, prev) => {
    if (mode == null) return;
    // First enter controlled mode (or remount): seed from trail only if empty.
    if (prev == null || (prev !== mode && openIds.value.size === 0)) {
      if (openIds.value.size === 0) openIds.value = trailOpenIds();
      else if (mode === 'single') openIds.value = collapseToOne(pruneOpenIds(openIds.value));
      return;
    }
    // multi → single: keep one of what user already opened; do not wipe.
    if (mode === 'single') {
      openIds.value = collapseToOne(pruneOpenIds(openIds.value));
    }
    // single → multi: keep current open set as-is.
  },
  { immediate: true },
);

watch(
  () => props.currentChapterId,
  () => {
    if (props.siblingExpand == null) return;
    const trail = trailOpenIds();
    if (props.siblingExpand === 'single') {
      const only = [...trail][0];
      if (only) openIds.value = new Set([only]);
      return;
    }
    const next = pruneOpenIds(openIds.value);
    for (const id of trail) next.add(id);
    openIds.value = next;
  },
);

watch(
  () => props.nodes,
  () => {
    if (props.siblingExpand == null) return;
    // Re-attach the active chapter trail after lens filtering rebuilds the tree,
    // so the sidebar does not look like it snapped to the first group.
    const trail = trailOpenIds();
    if (props.siblingExpand === 'single') {
      const only = [...trail][0];
      openIds.value = only ? new Set([only]) : pruneOpenIds(openIds.value);
      return;
    }
    const next = pruneOpenIds(openIds.value);
    for (const id of trail) next.add(id);
    openIds.value = next;
  },
);

function isOpen(node: TocTreeNode): boolean {
  if (props.siblingExpand == null) return isActiveTrail(node);
  return openIds.value.has(node.id);
}

function toggleGroup(node: TocTreeNode): void {
  if (props.siblingExpand == null) return;
  const next = new Set(openIds.value);
  if (next.has(node.id)) {
    next.delete(node.id);
  } else if (props.siblingExpand === 'single') {
    openIds.value = new Set([node.id]);
    return;
  } else {
    next.add(node.id);
  }
  openIds.value = next;
}

function chapterStats(pageId: string): { unread: number; question: number } {
  const ch = props.pageById[pageId];
  if (!ch) return { unread: 0, question: 0 };
  let unread = 0;
  let question = 0;
  for (const s of visibleTocSections(
    ch,
    props.lensSelection ?? null,
    bookToc.value,
    getBookShowLevel(props.bookId),
    ui.lensContentFilter === 'content',
  )) {
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

function outlineNum(type: 'group' | 'page', id: string): string {
  return props.outlineNums?.get(tocOutlineKey(type, id)) ?? '';
}
</script>

<template>
  <template v-for="node in nodes" :key="node.type + ':' + node.id">
    <details
      v-if="node.type === 'group'"
      class="toc-group toc-row"
      :class="`toc-row--depth-${depth}`"
      :key="siblingExpand != null ? 'g-' + node.id : 'g-' + node.id + '-' + currentChapterId"
      :open="isOpen(node)"
    >
      <summary
        class="toc-row-label toc-group-summary"
        @click="siblingExpand ? ($event.preventDefault(), toggleGroup(node)) : undefined"
      >
        <span class="toc-row-title">
          <span v-if="outlineNum('group', node.id)" class="toc-outline-num">{{
            outlineNum('group', node.id)
          }}</span>
          {{ node.title }}
        </span>
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
          :sibling-expand="siblingExpand"
          :outline-nums="outlineNums"
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
      <router-link
        :to="chapterLocation(node.id)"
        class="toc-row-label toc-chapter-link"
      >
        <span class="toc-row-title">
          <span v-if="outlineNum('page', node.id)" class="toc-outline-num">{{
            outlineNum('page', node.id)
          }}</span>
          {{ node.title }}
        </span>
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
