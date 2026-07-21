<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  api,
  type GitCommitSummary,
  type GitRefSummary,
} from '@/api';
import { ui } from '@/stores/ui';
import type { ChapterCompareResult, CompareMode, SectionChangeKind } from '@shared/sectionDiff';

const props = defineProps<{
  bookId: string;
  chapterId: string;
}>();

const hasGit = ref<boolean | null>(null);
const loadError = ref('');
const refs = ref<GitRefSummary[]>([]);
const history = ref<GitCommitSummary[]>([]);
const fromRef = ref('HEAD');
const toRef = ref('HEAD');
const mode = ref<CompareMode>('unified');
const comparing = ref(false);
const result = ref<ChapterCompareResult | null>(null);
const expanded = ref<Record<string, boolean>>({});
const hideUnchanged = ref(true);

const kindLabel: Record<SectionChangeKind, string> = {
  unchanged: '未变',
  changed: '已改',
  added: '新增',
  removed: '删除',
};

const visibleSections = computed(() => {
  const sections = result.value?.sections ?? [];
  if (!hideUnchanged.value) return sections;
  return sections.filter((s) => s.kind !== 'unchanged');
});

const refOptions = computed(() => {
  const names = new Set<string>();
  const opts: { value: string; label: string }[] = [];
  const push = (value: string, label: string) => {
    if (names.has(value)) return;
    names.add(value);
    opts.push({ value, label });
  };
  push('HEAD', 'HEAD');
  for (const r of refs.value) {
    push(r.name, `${r.kind}: ${r.name}`);
  }
  for (const h of history.value) {
    push(h.sha, `${h.shortSha} — ${h.subject || '(no subject)'}`);
  }
  return opts;
});

async function bootstrap(): Promise<void> {
  loadError.value = '';
  result.value = null;
  try {
    const status = await api.gitStatus(props.bookId);
    hasGit.value = status.hasGit;
    if (!status.hasGit) return;
    const [r, h] = await Promise.all([
      api.gitRefs(props.bookId),
      api.chapterHistory(props.bookId, props.chapterId),
    ]);
    refs.value = r;
    history.value = h;
    if (h.length >= 2) {
      toRef.value = h[0].sha;
      fromRef.value = h[1].sha;
    } else if (h.length === 1) {
      toRef.value = h[0].sha;
      fromRef.value = h[0].sha;
    } else {
      fromRef.value = 'HEAD';
      toRef.value = 'HEAD';
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    hasGit.value = false;
  }
}

async function runCompare(): Promise<void> {
  comparing.value = true;
  loadError.value = '';
  try {
    result.value = await api.chapterCompare(
      props.bookId,
      props.chapterId,
      fromRef.value.trim(),
      toRef.value.trim(),
      mode.value,
    );
    const open: Record<string, boolean> = {};
    for (const s of result.value.sections) {
      if (s.kind !== 'unchanged') open[s.id] = true;
    }
    expanded.value = open;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    result.value = null;
  } finally {
    comparing.value = false;
  }
}

function toggle(id: string): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}

function close(): void {
  ui.compareOpen = false;
}

onMounted(bootstrap);
watch(
  () => [props.bookId, props.chapterId] as const,
  () => {
    void bootstrap();
  },
);
</script>

<template>
  <div class="modal-mask" @click.self="close">
    <div class="modal compare-modal">
      <header class="modal-header">
        <h2>对比变更</h2>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>

      <p v-if="hasGit === false" class="muted">
        本书目录下没有 Git 仓库。请在该书根目录执行
        <code>git init</code> 并 commit 内容后，再使用对比。每本书应为独立仓库。
      </p>

      <template v-else-if="hasGit">
        <div class="compare-controls">
          <label class="compare-field">
            <span>From</span>
            <input v-model="fromRef" list="compare-ref-options" class="compare-input" />
          </label>
          <label class="compare-field">
            <span>To</span>
            <input v-model="toRef" list="compare-ref-options" class="compare-input" />
          </label>
          <datalist id="compare-ref-options">
            <option v-for="o in refOptions" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </datalist>
          <div class="compare-mode" role="group" aria-label="展示方式">
            <button
              type="button"
              class="btn ghost"
              :class="{ active: mode === 'unified' }"
              @click="mode = 'unified'"
            >
              Unified
            </button>
            <button
              type="button"
              class="btn ghost"
              :class="{ active: mode === 'sideBySide' }"
              @click="mode = 'sideBySide'"
            >
              Side by side
            </button>
          </div>
          <label class="compare-check">
            <input v-model="hideUnchanged" type="checkbox" />
            隐藏未变小节
          </label>
          <button class="btn" type="button" :disabled="comparing" @click="runCompare">
            {{ comparing ? '对比中…' : '对比' }}
          </button>
        </div>

        <p v-if="loadError" class="error-inline">{{ loadError }}</p>

        <div v-if="result" class="compare-meta muted">
          {{ result.from.slice(0, 7) }} → {{ result.to.slice(0, 7) }} ·
          {{ visibleSections.length }} 个小节
          <template v-if="hideUnchanged">
            （共 {{ result.sections.length }}）
          </template>
        </div>

        <p v-if="result && visibleSections.length === 0" class="muted">没有差异。</p>

        <div
          v-for="sec in visibleSections"
          :key="sec.id"
          class="compare-section"
          :data-kind="sec.kind"
        >
          <button type="button" class="compare-section-head" @click="toggle(sec.id)">
            <span class="kind-chip" :data-kind="sec.kind">{{ kindLabel[sec.kind] }}</span>
            <span class="compare-section-title">{{ sec.title }}</span>
            <code class="compare-section-id">{{ sec.id }}</code>
            <span class="spacer" />
            <span class="muted">{{ expanded[sec.id] ? '▾' : '▸' }}</span>
          </button>
          <div v-if="expanded[sec.id]" class="compare-body" :data-mode="mode">
            <template v-if="mode === 'sideBySide'">
              <div class="diff-cols">
                <pre class="diff-col from"><template
                  v-for="(line, i) in sec.lines"
                  :key="'L' + i"
                  ><span
                    v-if="line.op !== 'add'"
                    class="diff-line"
                    :class="line.op"
                    >{{ line.op === 'del' ? '- ' : '  ' }}{{ line.text }}
</span></template></pre>
                <pre class="diff-col to"><template
                  v-for="(line, i) in sec.lines"
                  :key="'R' + i"
                  ><span
                    v-if="line.op !== 'del'"
                    class="diff-line"
                    :class="line.op"
                    >{{ line.op === 'add' ? '+ ' : '  ' }}{{ line.text }}
</span></template></pre>
              </div>
            </template>
            <pre v-else class="diff-unified"><template
              v-for="(line, i) in sec.lines"
              :key="i"
              ><span class="diff-line" :class="line.op"
                >{{ line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ' }} {{ line.text }}
</span></template></pre>
          </div>
        </div>
      </template>

      <p v-else-if="loadError" class="error-inline">{{ loadError }}</p>
      <p v-else class="muted">检查 Git 仓库…</p>
    </div>
  </div>
</template>
