import { filenameFromContentDisposition } from '@/download';
import type { DigestExportPayload } from '@shared/digestExport';
import type { SectionStatus } from '@shared/annotations';
import type {
  ChapterCompareResult,
  CompareMode,
} from '@shared/sectionDiff';
import type {
  BookAnnotations,
  BookSummary,
  BookToc,
  ChapterContent,
  Note,
  SectionAnnotation,
} from '@shared/types';

export interface GitCommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitRefSummary {
  name: string;
  sha: string;
  kind: 'branch' | 'tag' | 'other';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default message
    }
    if (res.status === 502 || res.status === 504) {
      message =
        'API 服务未连接（502）。请确认已启动后端：AGENT_ENABLED=1 npm run dev（需同时有 server:4730 与 client:5173）';
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function queryString(query: Record<string, string | string[]>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) sp.append(key, item);
    } else {
      sp.set(key, value);
    }
  }
  return sp.toString();
}

export const api = {
  books: () => request<BookSummary[]>('/books'),

  toc: (bookId: string) => request<BookToc>(`/books/${bookId}`),

  chapter: (bookId: string, chapterId: string) =>
    request<ChapterContent>(`/books/${bookId}/chapters/${chapterId}`),

  exportDigest: (bookId: string, query: Record<string, string | string[]>) =>
    request<DigestExportPayload>(`/books/${bookId}/export?${queryString(query)}`),

  async exportDigestFile(
    bookId: string,
    query: Record<string, string | string[]>,
  ): Promise<{ filename: string; blob: Blob }> {
    const res = await fetch(`/api/books/${bookId}/export?${queryString(query)}`);
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // keep default
      }
      if (res.status === 502 || res.status === 504) {
        message =
          'API 服务未连接（502）。请确认已启动后端：AGENT_ENABLED=1 npm run dev（需同时有 server:4730 与 client:5173）';
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename =
      filenameFromContentDisposition(res.headers.get('content-disposition')) ??
      (blob.type.includes('zip') ? 'export.zip' : 'export.md');
    return { filename, blob };
  },

  annotations: (bookId: string) => request<BookAnnotations>(`/books/${bookId}/annotations`),

  setStatus: (bookId: string, sectionId: string, status: SectionStatus) =>
    request<SectionAnnotation | null>(`/books/${bookId}/annotations/status`, {
      method: 'PUT',
      body: JSON.stringify({ sectionId, status }),
    }),

  addNote: (bookId: string, sectionId: string, text: string) =>
    request<Note>(`/books/${bookId}/annotations/notes`, {
      method: 'POST',
      body: JSON.stringify({ sectionId, text }),
    }),

  updateNote: (bookId: string, sectionId: string, noteId: string, text: string) =>
    request<Note>(`/books/${bookId}/annotations/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ sectionId, text }),
    }),

  deleteNote: (bookId: string, sectionId: string, noteId: string) =>
    request<{ ok: boolean }>(
      `/books/${bookId}/annotations/notes/${noteId}?sectionId=${encodeURIComponent(sectionId)}`,
      { method: 'DELETE' },
    ),

  deleteSection: (bookId: string, sectionId: string) =>
    request<{ ok: boolean }>(
      `/books/${bookId}/annotations/section?sectionId=${encodeURIComponent(sectionId)}`,
      { method: 'DELETE' },
    ),

  gitStatus: (bookId: string) => request<{ hasGit: boolean }>(`/books/${bookId}/git/status`),

  gitRefs: (bookId: string) => request<GitRefSummary[]>(`/books/${bookId}/git/refs`),

  gitHistory: (bookId: string, limit = 100) =>
    request<GitCommitSummary[]>(`/books/${bookId}/git/history?limit=${limit}`),

  chapterHistory: (bookId: string, chapterId: string, limit = 50) =>
    request<GitCommitSummary[]>(
      `/books/${bookId}/chapters/${chapterId}/history?limit=${limit}`,
    ),

  chapterCompare: (
    bookId: string,
    chapterId: string,
    from: string,
    to: string,
    mode: CompareMode = 'unified',
  ) =>
    request<ChapterCompareResult>(
      `/books/${bookId}/chapters/${chapterId}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`,
    ),

  getSection: (bookId: string, chapterId: string, sectionId: string) =>
    request<{ id: string; title: string; markdown: string }>(
      `/books/${bookId}/chapters/${chapterId}/sections/${encodeURIComponent(sectionId)}`,
    ),

  putSection: (bookId: string, chapterId: string, sectionId: string, markdown: string) =>
    request<{ id: string; title: string; markdown: string }>(
      `/books/${bookId}/chapters/${chapterId}/sections/${encodeURIComponent(sectionId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ markdown }),
      },
    ),

  agentStatus: () =>
    request<{
      enabled: boolean;
      defaultAgent: string;
      defaultBehavior: string;
    }>('/agent/status'),

  agentsCatalog: () => request<AgentsCatalog>('/agents/catalog'),

  /**
   * Start an agent run; yields SSE events until the stream ends.
   * Events: { type: 'log'|'done'|'error', ... }
   */
  async *agentRun(
    bookId: string,
    prompt: string,
    opts?: {
      chapterId?: string;
      agentId?: string;
      behaviorId?: string;
      model?: string;
    },
  ): AsyncGenerator<AgentSseEvent> {
    const res = await fetch(`/api/books/${bookId}/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        chapterId: opts?.chapterId,
        agentId: opts?.agentId,
        behaviorId: opts?.behaviorId,
        model: opts?.model,
      }),
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // keep default
      }
      if (res.status === 502 || res.status === 504) {
        message =
          'API 服务未连接（502）。请确认已启动后端：AGENT_ENABLED=1 npm run dev（需同时有 server:4730 与 client:5173）';
      }
      throw new Error(message);
    }
    if (!res.body) {
      throw new Error('no response body');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('data:'));
        if (!line) continue;
        const json = line.slice('data:'.length).trim();
        if (!json) continue;
        try {
          yield JSON.parse(json) as AgentSseEvent;
        } catch {
          // skip malformed
        }
      }
    }
  },
};

export type AgentSseEvent =
  | { type: 'log'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; code: number }
  | { type: 'error'; message: string };

export interface AgentModelOption {
  id: string;
  title: string;
}

export interface AgentBehaviorSummary {
  id: string;
  title: string;
}

export interface AgentSummary {
  id: string;
  title: string;
  driver: string;
  bin: string;
  binOk: boolean;
  defaultModel: string;
  models: AgentModelOption[];
}

export interface AgentsCatalog {
  defaultAgent: string;
  defaultBehavior: string;
  agents: AgentSummary[];
  behaviors: AgentBehaviorSummary[];
}
