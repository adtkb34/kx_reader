<script setup lang="ts">
import { setTocSiblingExpand, ui, type TocSiblingExpand } from '@/stores/ui';

defineProps<{
  /** Compact sizing for the narrow sidebar header. */
  compact?: boolean;
}>();

function setMode(mode: TocSiblingExpand): void {
  setTocSiblingExpand(mode);
}
</script>

<template>
  <div
    class="toc-expand-mode"
    :class="{ 'toc-expand-mode--compact': compact }"
    role="group"
    aria-label="同级展开方式"
  >
    <button
      type="button"
      class="toc-expand-mode-btn"
      :class="{ active: ui.tocSiblingExpand === 'single' }"
      title="同级只展开一个"
      :aria-pressed="ui.tocSiblingExpand === 'single'"
      @click="setMode('single')"
    >
      单开
    </button>
    <button
      type="button"
      class="toc-expand-mode-btn"
      :class="{ active: ui.tocSiblingExpand === 'multi' }"
      title="同级可同时展开多个"
      :aria-pressed="ui.tocSiblingExpand === 'multi'"
      @click="setMode('multi')"
    >
      多开
    </button>
  </div>
</template>
