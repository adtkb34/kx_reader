<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{
  html: string;
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

onMounted(() => {
  document.addEventListener('keydown', onKey);
  prevOverflow = document.body.style.overflow;
  prevPaddingRight = document.body.style.paddingRight;
  const gap = scrollbarWidth();
  document.body.style.overflow = 'hidden';
  // 锁滚动会去掉竖条，补等宽 padding，避免整页左右抖一下
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
      class="diagram-lightbox-mask"
      role="dialog"
      aria-modal="true"
      aria-label="图表放大"
      @click.self="emit('close')"
    >
      <button type="button" class="diagram-lightbox-close" aria-label="关闭" @click="emit('close')">
        ×
      </button>
      <div class="diagram-lightbox-stage" @click.stop>
        <!-- 内容来自本页已渲染的 mermaid / wireframe，与 Mermaid 相同：原样放大展示 -->
        <div class="diagram-lightbox-body" v-html="html" />
      </div>
    </div>
  </Teleport>
</template>
