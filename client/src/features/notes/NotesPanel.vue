<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Note } from '@shared/types';
import { addNote, deleteNote, notesOf, updateNote } from '@/stores/annotations';
import { closeNotes, ui } from '@/stores/ui';

const target = computed(() => ui.notesTarget);
const notes = computed(() =>
  target.value ? notesOf(target.value.bookId, target.value.key) : [],
);

const draft = ref('');
const busy = ref(false);
const editingId = ref<string | null>(null);
const editText = ref('');

async function submit(): Promise<void> {
  if (!target.value) return;
  const text = draft.value.trim();
  if (!text) return;
  busy.value = true;
  try {
    await addNote(target.value.bookId, target.value.key, text);
    draft.value = '';
  } finally {
    busy.value = false;
  }
}

function startEdit(note: Note): void {
  editingId.value = note.id;
  editText.value = note.text;
}

async function saveEdit(note: Note): Promise<void> {
  if (!target.value) return;
  const text = editText.value.trim();
  if (!text) return;
  busy.value = true;
  try {
    await updateNote(target.value.bookId, target.value.key, note.id, text);
    editingId.value = null;
  } finally {
    busy.value = false;
  }
}

async function remove(note: Note): Promise<void> {
  if (!target.value) return;
  if (!confirm('删除这条备注？')) return;
  await deleteNote(target.value.bookId, target.value.key, note.id);
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <aside v-if="target" class="notes-panel">
    <header class="notes-header">
      <div class="notes-header-text">
        <div class="panel-label">备注 · <code>{{ target.key }}</code></div>
        <div class="panel-title">{{ target.title }}</div>
      </div>
      <button class="btn ghost" @click="closeNotes()">关闭</button>
    </header>

    <div class="notes-list">
      <p v-if="notes.length === 0" class="muted">还没有备注。</p>
      <div v-for="note in notes" :key="note.id" class="note-item">
        <template v-if="editingId === note.id">
          <textarea v-model="editText" rows="3" class="note-input" />
          <div class="note-actions">
            <button class="btn small primary" :disabled="busy || !editText.trim()" @click="saveEdit(note)">
              保存
            </button>
            <button class="btn small ghost" @click="editingId = null">取消</button>
          </div>
        </template>
        <template v-else>
          <div class="note-text">{{ note.text }}</div>
          <div class="note-meta">
            <span>{{ fmt(note.updatedAt) }}</span>
            <span class="spacer" />
            <button class="link-btn" @click="startEdit(note)">编辑</button>
            <button class="link-btn danger" @click="remove(note)">删除</button>
          </div>
        </template>
      </div>
    </div>

    <footer class="notes-footer">
      <textarea
        v-model="draft"
        rows="3"
        class="note-input"
        placeholder="给这一小节添加备注…（⌘+Enter 提交）"
        @keydown.meta.enter="submit()"
      />
      <button class="btn primary" :disabled="busy || !draft.trim()" @click="submit()">
        添加备注
      </button>
    </footer>
  </aside>
</template>
