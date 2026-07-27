<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { RenderedSection } from '@/markdown';
import {
  DEFAULT_STATUS,
  SECTION_STATUSES,
  statusMeta,
  type SectionStatus,
} from '@shared/annotations';
import { notesOf, sectionKey, setStatus, statusOf } from '@/stores/annotations';
import { bumpChapterReload, openNotes } from '@/stores/ui';
import { api } from '@/api/client';

const props = defineProps<{ bookId: string; chapterId: string; section: RenderedSection }>();

const key = computed(() => sectionKey(props.chapterId, props.section.id));
const status = computed(() => statusOf(props.bookId, key.value));
const notes = computed(() => notesOf(props.bookId, key.value));
const meta = computed(() => statusMeta(status.value));
const saving = ref(false);
const menuOpen = ref(false);
/** 正在划选正文时隐藏工具条，避免挡住选区 */
const selecting = ref(false);

const editing = ref(false);
const draft = ref('');
const editBusy = ref(false);
const editError = ref('');
const editorEl = ref<HTMLTextAreaElement | null>(null);

function syncSelecting(): void {
  if (editing.value) {
    selecting.value = false;
    return;
  }
  const sel = window.getSelection();
  selecting.value = !!(sel && !sel.isCollapsed && (sel.toString() ?? '').length > 0);
}

async function choose(target: SectionStatus): Promise<void> {
  const next = target === status.value && target !== DEFAULT_STATUS ? DEFAULT_STATUS : target;
  if (next === status.value) return;
  saving.value = true;
  try {
    await setStatus(props.bookId, key.value, next);
    menuOpen.value = false;
  } finally {
    saving.value = false;
  }
}

function autoSize(): void {
  const el = editorEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
}

async function startEdit(): Promise<void> {
  editError.value = '';
  editBusy.value = true;
  menuOpen.value = false;
  try {
    const sec = await api.getSection(props.bookId, props.chapterId, props.section.id);
    draft.value = sec.markdown;
    editing.value = true;
    await nextTick();
    autoSize();
    editorEl.value?.focus();
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e);
  } finally {
    editBusy.value = false;
  }
}

function openNotesPanel(): void {
  menuOpen.value = false;
  openNotes(props.bookId, key.value, props.section.title);
}

function cancelEdit(): void {
  editing.value = false;
  editError.value = '';
}

async function saveEdit(): Promise<void> {
  editError.value = '';
  editBusy.value = true;
  try {
    await api.putSection(props.bookId, props.chapterId, props.section.id, draft.value);
    editing.value = false;
    bumpChapterReload();
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e);
  } finally {
    editBusy.value = false;
  }
}

watch(draft, () => {
  if (editing.value) void nextTick(autoSize);
});

onMounted(() => {
  document.addEventListener('selectionchange', syncSelecting);
});
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', syncSelecting);
});
</script>

<template>
  <section
    class="doc-section"
    :class="[`status-${status}`, { selecting: selecting, editing: editing }]"
    :data-section-id="section.id"
  >
    <div v-if="!editing" class="section-tools">
      <el-popover
        v-model:visible="menuOpen"
        trigger="hover"
        placement="bottom-end"
        :show-arrow="false"
        :offset="6"
        :show-after="80"
        :hide-after="200"
        :width="112"
        popper-class="section-menu-popper"
      >
        <template #reference>
          <button
            type="button"
            class="tools-handle"
            :class="{ 'has-notes': notes.length > 0, open: menuOpen }"
            :title="meta.label"
            :aria-label="`小节操作（当前：${meta.label}）`"
          >
            …
          </button>
        </template>

        <div class="section-menu" role="menu">
          <div class="section-menu-item has-sub" role="none">
            <button type="button" class="section-menu-btn" role="menuitem">
              标签
              <span class="section-menu-caret">›</span>
            </button>
            <div class="section-submenu" role="menu" aria-label="阅读状态">
              <button
                v-for="st in SECTION_STATUSES"
                :key="st.id"
                type="button"
                class="section-menu-btn status"
                :class="{ active: st.id === status }"
                :disabled="saving"
                role="menuitem"
                @click="choose(st.id)"
              >
                <span class="status-dot" :style="{ background: st.color }" />
                {{ st.label }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="section-menu-btn"
            :class="{ accent: notes.length > 0 }"
            role="menuitem"
            @click="openNotesPanel"
          >
            备注{{ notes.length ? ` ${notes.length}` : '' }}
          </button>
          <button
            type="button"
            class="section-menu-btn"
            :disabled="editBusy"
            role="menuitem"
            @click="startEdit"
          >
            编辑
          </button>
        </div>
      </el-popover>
    </div>

    <div v-if="editing" class="section-edit">
      <textarea
        ref="editorEl"
        v-model="draft"
        class="section-editor"
        spellcheck="true"
        :disabled="editBusy"
        @keydown.meta.enter.prevent="saveEdit()"
      />
      <p v-if="editError" class="section-edit-error">{{ editError }}</p>
      <div class="section-edit-actions">
        <button class="btn primary small" type="button" :disabled="editBusy" @click="saveEdit">
          {{ editBusy ? '保存中…' : '保存' }}
        </button>
        <button class="btn ghost small" type="button" :disabled="editBusy" @click="cancelEdit">
          取消
        </button>
        <span class="muted section-edit-hint">⌘+Enter 保存 · 请保持标题 {#id} 不变</span>
      </div>
    </div>
    <div v-else class="section-body md-body" v-html="section.html" />
    <p v-if="!editing && editError" class="section-edit-error">{{ editError }}</p>
  </section>
</template>
