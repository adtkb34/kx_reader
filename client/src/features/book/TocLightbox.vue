<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { LensSelection, TocChapter, TocTreeNode } from '@shared/types';
import TocTreeNodes from '@/features/book/TocTreeNodes.vue';
import TocExpandModeSwitch from '@/features/book/TocExpandModeSwitch.vue';
import { ui } from '@/stores/ui';

defineProps<{
  bookTitle: string;
  nodes: TocTreeNode[];
  bookId: string;
  currentChapterId: string;
  pageById: Record<string, TocChapter>;
  lensSelection?: LensSelection | null;
  outlineNums?: ReadonlyMap<string, string> | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

let prevOverflow = '';
let prevPaddingRight = '';

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

function scrollbarWidth(): number {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

function onNavClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (t?.closest('a.toc-chapter-link')) emit('close');
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
  prevOverflow = document.body.style.overflow;
  prevPaddingRight = document.body.style.paddingRight;
  const gap = scrollbarWidth();
  document.body.style.overflow = 'hidden';
  if (gap > 0) {
    document.body.style.paddingRight = `${gap + (parseFloat(prevPaddingRight) || 0)}px`;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = prevOverflow;
  document.body.style.paddingRight = prevPaddingRight;
});
</script>

<template>
  <Teleport to="body">
    <div
      class="toc-lightbox-mask"
      role="dialog"
      aria-modal="true"
      aria-label="目录放大"
      @click.self="emit('close')"
    >
      <button
        type="button"
        class="toc-lightbox-close"
        aria-label="关闭"
        @click="emit('close')"
      >
        ×
      </button>
      <div class="toc-lightbox-panel" @click.stop>
        <div class="toc-lightbox-header">
          <div class="toc-lightbox-title">{{ bookTitle }}</div>
        </div>
        <nav class="toc-lightbox-tree" @click.capture="onNavClick">
          <TocTreeNodes
            :nodes="nodes"
            :book-id="bookId"
            :current-chapter-id="currentChapterId"
            :page-by-id="pageById"
            :lens-selection="lensSelection"
            :sibling-expand="ui.tocSiblingExpand"
            :outline-nums="outlineNums"
          />
        </nav>
        <div class="toc-lightbox-footer">
          <TocExpandModeSwitch />
        </div>
      </div>
    </div>
  </Teleport>
</template>
