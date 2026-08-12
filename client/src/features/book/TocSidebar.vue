<script setup lang="ts">
import { computed, ref } from 'vue';
import { Fold, ZoomIn } from '@element-plus/icons-vue';
import type { BookToc, LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import { tocSidebarOutlineNumbers } from '@shared/lenses';
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
  pageSelectedIds?: string[];
  pageVisibleIds?: string[];
  pagePickEnabled?: boolean;
}>();

const emit = defineEmits<{
  togglePage: [pageId: string, checked: boolean];
  selectAllPages: [];
  setPagePickMode: [mode: 'single' | 'multi'];
}>();

const lightboxOpen = ref(false);

const pageById = computed(() => {
  const map: Record<string, TocChapter> = {};
  for (const ch of props.toc.chapters) map[ch.id] = ch;
  return map;
});

/** Stable numbers: full tree, or ruler module-index shape (not lens-filtered). */
const outlineNums = computed(() => tocSidebarOutlineNumbers(props.toc));

const tocNumWidthCh = computed(() => {
  let max = 0;
  for (const n of outlineNums.value.values()) {
    if (n.length > max) max = n.length;
  }
  return Math.max(max, 1);
});

const tocTreeStyle = computed(() => ({
  '--toc-num-width': `${tocNumWidthCh.value}ch`,
}));

function onTogglePage(pageId: string, checked: boolean): void {
  emit('togglePage', pageId, checked);
}
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
    <div v-if="pagePickEnabled" class="toc-page-pick-toolbar outline-toolbar">
      <div class="outline-pick-mode" role="group" aria-label="目录页选择方式">
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.tocPagePickMode === 'single' }"
          :aria-pressed="ui.tocPagePickMode === 'single'"
          @click="emit('setPagePickMode', 'single')"
        >
          单选
        </button>
        <button
          type="button"
          class="outline-pick-mode-btn"
          :class="{ active: ui.tocPagePickMode === 'multi' }"
          :aria-pressed="ui.tocPagePickMode === 'multi'"
          @click="emit('setPagePickMode', 'multi')"
        >
          多选
        </button>
      </div>
      <button
        type="button"
        class="outline-pick-mode-btn outline-select-tops"
        title="勾选当前可见的全部页"
        @click="emit('selectAllPages')"
      >
        全选
      </button>
    </div>
    <nav class="toc-tree" :style="tocTreeStyle">
      <TocTreeNodes
        :nodes="tree"
        :book-id="bookId"
        :current-chapter-id="currentChapterId"
        :page-by-id="pageById"
        :lens-selection="lensSelection"
        :sibling-expand="ui.tocSiblingExpand"
        :outline-nums="outlineNums"
        :page-selected-ids="pageSelectedIds ?? null"
        :page-visible-ids="pageVisibleIds ?? null"
        :page-pick-enabled="pagePickEnabled"
        @toggle-page="onTogglePage"
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
      :toc-num-width-ch="tocNumWidthCh"
      :page-selected-ids="pageSelectedIds ?? null"
      :page-visible-ids="pageVisibleIds ?? null"
      :page-pick-enabled="pagePickEnabled"
      @close="lightboxOpen = false"
      @toggle-page="onTogglePage"
    />
  </aside>
</template>
