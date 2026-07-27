<script setup lang="ts">
import { computed } from 'vue';
import { statusMeta } from '@shared/annotations';
import { useOrphans } from '@/composables/orphans';
import { deleteSection } from '@/stores/annotations';
import { ui } from '@/stores/ui';

const props = defineProps<{ bookId: string }>();
const orphans = useOrphans(computed(() => props.bookId));

async function removeEntry(key: string): Promise<void> {
  if (!confirm(`删除孤立标注 ${key} ？`)) return;
  await deleteSection(props.bookId, key);
}
</script>

<template>
  <div class="modal-mask" @click.self="ui.orphanOpen = false">
    <div class="modal">
      <header class="modal-header">
        <h2>孤立标注</h2>
        <button class="btn ghost" @click="ui.orphanOpen = false">关闭</button>
      </header>
      <p class="muted">
        这些标注对应的小节在当前内容里已经找不到（小节被删除，或标题 id
        被改动）。内容恢复原 id 后它们会自动回到原位；也可以在这里删除。
      </p>
      <p v-if="orphans.length === 0" class="muted">没有孤立标注。</p>
      <div v-for="o in orphans" :key="o.key" class="orphan-item">
        <div class="orphan-head">
          <code>{{ o.key }}</code>
          <span class="status-chip" :style="{ background: statusMeta(o.entry.status).color }">
            {{ statusMeta(o.entry.status).label }}
          </span>
          <span class="spacer" />
          <button class="link-btn danger" @click="removeEntry(o.key)">删除</button>
        </div>
        <ul v-if="o.entry.notes.length" class="orphan-notes">
          <li v-for="n in o.entry.notes" :key="n.id">{{ n.text }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
