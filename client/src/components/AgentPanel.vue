<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import {
  api,
  type AgentBehaviorSummary,
  type AgentSummary,
  type AgentSseEvent,
} from '@/api';
import { loadToc } from '@/stores/books';
import { loadAnnotations } from '@/stores/annotations';
import { bumpChapterReload, ui } from '@/stores/ui';

const props = defineProps<{
  bookId: string;
  chapterId: string;
}>();

const AGENT_KEY = 'reader.agent.agentId';
const BEHAVIOR_KEY = 'reader.agent.behaviorId';
const MODEL_KEY = 'reader.agent.model';

const status = ref<{
  enabled: boolean;
  defaultAgent: string;
  defaultBehavior: string;
} | null>(null);
const agents = ref<AgentSummary[]>([]);
const behaviors = ref<AgentBehaviorSummary[]>([]);
const agentId = ref('');
const behaviorId = ref('');
const model = ref('');
const settingsOpen = ref(false);
const statusError = ref('');
const draft = ref('');
const logText = ref('');
const running = ref(false);
const finishedOk = ref(false);
const runError = ref('');
const logEl = ref<HTMLElement | null>(null);

const selectedAgent = computed(() => agents.value.find((a) => a.id === agentId.value));
const selectedBehavior = computed(() => behaviors.value.find((b) => b.id === behaviorId.value));
const modelOptions = computed(() => selectedAgent.value?.models ?? []);

const settingsSummary = computed(() => {
  const agentTitle = selectedAgent.value?.title || agentId.value || '—';
  const behaviorTitle = selectedBehavior.value?.title || behaviorId.value || '—';
  const modelOpt = modelOptions.value.find((m) => m.id === model.value);
  const modelLabel = modelOpt?.title || '默认';
  return `${agentTitle} · ${behaviorTitle} · ${modelLabel}`;
});

const canSend = computed(
  () =>
    !!status.value?.enabled &&
    !!selectedAgent.value?.binOk &&
    !!draft.value.trim() &&
    !running.value,
);

function pickModelForAgent(agent: AgentSummary | undefined, preferred?: string): string {
  if (!agent || agent.models.length === 0) return '';
  if (preferred != null && agent.models.some((m) => m.id === preferred)) {
    return preferred;
  }
  const fromDefault = agent.defaultModel ?? '';
  if (agent.models.some((m) => m.id === fromDefault)) {
    return fromDefault;
  }
  return agent.models[0]?.id ?? '';
}

function pickBehavior(preferred?: string): string {
  if (preferred && behaviors.value.some((b) => b.id === preferred)) {
    return preferred;
  }
  const fallback =
    behaviors.value.find((b) => b.id === status.value?.defaultBehavior) ?? behaviors.value[0];
  return fallback?.id ?? '';
}

async function loadStatus(): Promise<void> {
  statusError.value = '';
  try {
    const [st, catalog] = await Promise.all([api.agentStatus(), api.agentsCatalog()]);
    status.value = st;
    agents.value = catalog.agents;
    behaviors.value = catalog.behaviors;

    const storedAgent = localStorage.getItem(AGENT_KEY) ?? '';
    const agent =
      catalog.agents.find((a) => a.id === storedAgent) ??
      catalog.agents.find((a) => a.id === catalog.defaultAgent) ??
      catalog.agents[0];
    agentId.value = agent?.id ?? st.defaultAgent;

    const storedBehavior = localStorage.getItem(BEHAVIOR_KEY) ?? '';
    behaviorId.value = pickBehavior(
      storedBehavior || catalog.defaultBehavior || st.defaultBehavior,
    );

    const storedModel = localStorage.getItem(MODEL_KEY);
    model.value = pickModelForAgent(agent, storedModel ?? undefined);
  } catch (e) {
    statusError.value = e instanceof Error ? e.message : String(e);
    status.value = null;
  }
}

watch(agentId, (id) => {
  if (!id) return;
  localStorage.setItem(AGENT_KEY, id);
  const agent = agents.value.find((a) => a.id === id);
  model.value = pickModelForAgent(agent, model.value);
});

watch(behaviorId, (id) => {
  if (!id) return;
  localStorage.setItem(BEHAVIOR_KEY, id);
});

watch(model, (v) => {
  localStorage.setItem(MODEL_KEY, v);
});

async function scrollLog(): Promise<void> {
  await nextTick();
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
}

function appendLog(text: string): void {
  logText.value += text;
  void scrollLog();
}

async function send(): Promise<void> {
  const prompt = draft.value.trim();
  if (!prompt || running.value) return;
  running.value = true;
  finishedOk.value = false;
  runError.value = '';
  logText.value = '';
  const label = [
    selectedAgent.value?.title ?? agentId.value,
    selectedBehavior.value?.title ?? behaviorId.value,
  ]
    .filter(Boolean)
    .join(' / ');
  appendLog(`› [${label}] ${prompt}\n\n`);

  try {
    for await (const event of api.agentRun(props.bookId, prompt, {
      chapterId: props.chapterId || undefined,
      agentId: agentId.value || undefined,
      behaviorId: behaviorId.value || undefined,
      model: model.value || undefined,
    })) {
      handleEvent(event);
    }
    if (!runError.value && finishedOk.value) {
      await Promise.all([loadToc(props.bookId), loadAnnotations(props.bookId)]);
      bumpChapterReload();
      appendLog('\n（已写盘，页面已重载）\n');
    }
  } catch (e) {
    runError.value = e instanceof Error ? e.message : String(e);
    appendLog(`\n错误：${runError.value}\n`);
  } finally {
    running.value = false;
  }
}

function handleEvent(event: AgentSseEvent): void {
  if (event.type === 'log') {
    appendLog(event.text);
    return;
  }
  if (event.type === 'error') {
    runError.value = event.message;
    appendLog(`\n错误：${event.message}\n`);
    return;
  }
  if (event.type === 'done') {
    finishedOk.value = event.code === 0;
    if (event.code !== 0) {
      runError.value = `agent exited with code ${event.code}`;
      appendLog(`\n退出码 ${event.code}\n`);
    } else {
      appendLog('\n完成。\n');
    }
  }
}

function close(): void {
  ui.agentOpen = false;
}

onMounted(loadStatus);
</script>

<template>
  <aside class="agent-panel">
    <header class="agent-panel-header">
      <div class="notes-header-text">
        <div class="panel-label">AI · Agent</div>
        <div class="panel-title">写盘后重载</div>
      </div>
      <el-button text @click="close">关闭</el-button>
    </header>

    <div class="agent-body">
      <el-alert
        v-if="statusError"
        type="error"
        :title="statusError"
        :closable="false"
        show-icon
      />

      <template v-else-if="status">
        <el-alert
          v-if="!status.enabled"
          type="warning"
          :closable="false"
          show-icon
          title="Agent 未启用"
          description="请用 npm run dev:agent，或设置 AGENT_ENABLED=1，并先执行 agent login。"
        />
        <el-alert
          v-else-if="selectedAgent && !selectedAgent.binOk"
          type="warning"
          :closable="false"
          show-icon
          title="找不到 CLI"
          :description="`当前二进制：${selectedAgent.bin}。请安装对应工具，或在 config/agents.json 里改该 agent 的 bin。`"
        />
        <div v-else-if="selectedAgent?.binOk" class="agent-settings-bar">
          <el-popover
            v-model:visible="settingsOpen"
            placement="bottom-start"
            :width="300"
            trigger="click"
            :show-arrow="false"
            popper-class="agent-settings-popper"
          >
            <template #reference>
              <el-button
                class="agent-settings-trigger"
                text
                :icon="Setting"
                title="设置"
                aria-label="打开设置"
              />
            </template>
            <div class="agent-settings-pop">
              <div class="agent-settings-title">设置</div>
              <el-form label-position="top" size="small" class="agent-settings-form">
                <el-form-item label="代理">
                  <el-select v-model="agentId" placeholder="选择代理" style="width: 100%">
                    <el-option
                      v-for="a in agents"
                      :key="a.id"
                      :label="a.title"
                      :value="a.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="行为">
                  <el-select v-model="behaviorId" placeholder="选择行为" style="width: 100%">
                    <el-option
                      v-for="b in behaviors"
                      :key="b.id"
                      :label="b.title"
                      :value="b.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="模型">
                  <el-select v-model="model" placeholder="选择模型" style="width: 100%">
                    <el-option
                      v-for="m in modelOptions"
                      :key="m.id || '__default__'"
                      :label="m.title"
                      :value="m.id"
                    />
                  </el-select>
                </el-form-item>
              </el-form>
              <el-text size="small" type="info">
                默认改当前章；整本书请在指令里写明。
              </el-text>
            </div>
          </el-popover>
          <el-text class="agent-settings-summary" truncated :title="settingsSummary">
            {{ settingsSummary }}
          </el-text>
        </div>
      </template>
      <el-skeleton v-else :rows="3" animated />

      <el-card shadow="never" class="agent-log-card" body-class="agent-log-card-body">
        <pre ref="logEl" class="agent-log">{{ logText || '（日志会出现在这里）' }}</pre>
      </el-card>

      <el-alert
        v-if="finishedOk && !running"
        type="success"
        :closable="false"
        show-icon
        title="已写盘并重载"
      />
      <el-alert
        v-if="runError && !running"
        type="error"
        :closable="false"
        show-icon
        :title="runError"
      />
    </div>

    <footer class="agent-footer">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="4"
        resize="none"
        placeholder="例如：把「项目概览」小节写得更短，保留所有 {#id}…"
        :disabled="running || !status?.enabled || !selectedAgent?.binOk"
        @keydown.meta.enter.prevent="send"
      />
      <div class="agent-footer-actions">
        <el-text size="small" type="info">⌘+Enter 发送</el-text>
        <el-button type="primary" :loading="running" :disabled="!canSend" @click="send">
          {{ running ? '运行中…' : '发送' }}
        </el-button>
      </div>
    </footer>
  </aside>
</template>
