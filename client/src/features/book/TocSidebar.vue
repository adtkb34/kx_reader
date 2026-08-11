<script setup lang="ts">
import { computed, ref } from 'vue';
import { Fold, ZoomIn } from '@element-plus/icons-vue';
import type { BookToc, LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import { collapseSingletonGroups, filterChapters, filterTree } from '@shared/lenses';
import { tocTreeOutlineNumbers } from '@shared/outlineNumbers';
import { rulerSidebarKeepIds } from '@shared/ruler';
import TocTreeNodes from '@/features/book/TocTreeNodes.vue';
import TocLightbox from '@/features/book/TocLightbox.vue';
import TocExpandModeSwitch from '@/features/book/TocExpandModeSwitch.vue';
import { toggleTocOpen, ui } from '@/stores/ui';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  currentChapterId: string;
  /** Pre-filtered tree (by reading lens + content filter). */
  tree: TocTreeNode[];
  lensSelection?: LensSelection | null;
}>();

const lightboxOpen = ref(false);

const pageById = computed(() => {
  const map: Record<string, TocChapter> = {};
  for (const ch of props.toc.chapters) map[ch.id] = ch;
  return map;
});

/** Numbers from lens-only tree (ignore 仅有/仅无内容) so hiding siblings does not renumber. */
const outlineNums = computed(() => {
  const t = props.toc;
  const sel = props.lensSelection ?? null;
  let ids = new Set(filterChapters(t.chapters, sel, t).map((c) => c.id));
  if (t.ruler) {
    const keep = rulerSidebarKeepIds(t, sel);
    ids = new Set([...ids].filter((id) => keep.has(id)));
  }
  const base = t.tree?.length
    ? t.tree
    : t.chapters.map((c) => ({
        type: 'page' as const,
        id: c.id,
        title: c.title,
        file: c.file,
      }));
  return tocTreeOutlineNumbers(collapseSingletonGroups(filterTree(base, ids)));
});
</script>

<template>
  <aside class="toc">
    <div class="toc-header">
      <button
        class="toc-collapse"
        type="button"
        title="收起目录"
        aria-label="收起目录"
        @click="toggleTocOpen()"
      >
        <el-icon :size="16"><Fold /></el-icon>
      </button>
      <div class="toc-book-title">{{ toc.title }}</div>
    </div>
    <nav class="toc-tree">
      <TocTreeNodes
        :nodes="tree"
        :book-id="bookId"
        :current-chapter-id="currentChapterId"
        :page-by-id="pageById"
        :lens-selection="lensSelection"
        :sibling-expand="ui.tocSiblingExpand"
        :outline-nums="outlineNums"
      />
    </nav>
    <div class="toc-footer">
      <TocExpandModeSwitch compact />
      <button
        class="toc-enlarge"
        type="button"
        title="放大目录"
        aria-label="放大目录"
        @click="lightboxOpen = true"
      >
        <el-icon :size="16"><ZoomIn /></el-icon>
      </button>
    </div>
    <TocLightbox
      v-if="lightboxOpen"
      :book-title="toc.title"
      :nodes="tree"
      :book-id="bookId"
      :current-chapter-id="currentChapterId"
      :page-by-id="pageById"
      :lens-selection="lensSelection"
      :outline-nums="outlineNums"
      @close="lightboxOpen = false"
    />
  </aside>
</template>
