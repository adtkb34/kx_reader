<script setup lang="ts">
import { computed } from 'vue';
import type { BookLens, PageLayer } from '@shared/types';

const props = defineProps<{
  nodes: BookLens[];
  modelValue: PageLayer[];
  placeholder?: string;
  clearable?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [PageLayer[]];
}>();

interface TreeOption {
  value: string;
  label: string;
  children?: TreeOption[];
}

function toTree(nodes: BookLens[]): TreeOption[] {
  return nodes.map((n) => ({
    value: n.id,
    label: n.title,
    children: n.children?.length ? toTree(n.children) : undefined,
  }));
}

const data = computed(() => toTree(props.nodes));

const selected = computed({
  get: () => props.modelValue,
  set: (v: PageLayer[]) => {
    const next = Array.isArray(v) ? v.filter(Boolean) : [];
    emit('update:modelValue', next);
  },
});
</script>

<template>
  <el-tree-select
    v-model="selected"
    class="lens-tree-select"
    :data="data"
    multiple
    filterable
    collapse-tags
    collapse-tags-tooltip
    check-strictly
    :clearable="clearable"
    :render-after-expand="false"
    show-checkbox
    default-expand-all
    :placeholder="placeholder ?? '透镜'"
  />
</template>
