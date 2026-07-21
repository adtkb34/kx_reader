import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_STATUS, type SectionStatus } from '../../shared/annotations';
import type { BookAnnotations, Note, SectionAnnotation } from '../../shared/types';
import { getBookSectionHashes } from './contentHash';

/**
 * 标注存储接口。当前实现为本地 JSON 文件；
 * 将来接团队后端时，换一个实现（数据库 + 用户维度）即可，路由层不变。
 */
export interface AnnotationStore {
  getBook(bookId: string): Promise<BookAnnotations>;
  setStatus(
    bookId: string,
    sectionId: string,
    status: SectionStatus,
  ): Promise<SectionAnnotation | null>;
  addNote(bookId: string, sectionId: string, text: string): Promise<Note>;
  updateNote(
    bookId: string,
    sectionId: string,
    noteId: string,
    text: string,
  ): Promise<Note | null>;
  deleteNote(bookId: string, sectionId: string, noteId: string): Promise<boolean>;
  deleteSection(bookId: string, sectionId: string): Promise<void>;
}

const SAFE_BOOK_ID = /^[\w][\w.-]*$/;

/** 内容变更时需要打回未读的状态 */
const RESET_ON_CHANGE: ReadonlySet<SectionStatus> = new Set(['read', 'confirmed']);

export class FileAnnotationStore implements AnnotationStore {
  /** 每本书一个串行队列，避免并发写坏文件 */
  private queues = new Map<string, Promise<unknown>>();

  constructor(private dataDir: string) {}

  private fileFor(bookId: string): string {
    if (!SAFE_BOOK_ID.test(bookId)) throw new Error(`invalid book id: ${bookId}`);
    return path.join(this.dataDir, 'annotations', `${bookId}.json`);
  }

  private enqueue<T>(bookId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(bookId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(
      bookId,
      next.catch(() => {}),
    );
    return next;
  }

  private async load(bookId: string): Promise<BookAnnotations> {
    try {
      const raw = await fs.readFile(this.fileFor(bookId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<BookAnnotations>;
      return { version: 1, bookId, sections: parsed.sections ?? {} };
    } catch {
      return { version: 1, bookId, sections: {} };
    }
  }

  private async save(bookId: string, data: BookAnnotations): Promise<void> {
    const file = this.fileFor(bookId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  }

  /**
   * 对照全书小节正文 hash：
   * - 已读 / 确认 且 hash 变了 → 打回未读（无备注则删条目）
   * - 尚无 contentHash 的已读/确认 → 只补写 hash，不改状态（兼容旧数据）
   */
  private async reconcileHashes(bookId: string, data: BookAnnotations): Promise<boolean> {
    const hashes = await getBookSectionHashes(bookId);
    let changed = false;

    for (const [key, entry] of Object.entries(data.sections)) {
      const current = hashes[key];
      if (current == null) continue; // 孤立标注：内容侧已无此小节，留给 orphan 面板

      if (RESET_ON_CHANGE.has(entry.status)) {
        if (!entry.contentHash) {
          entry.contentHash = current;
          changed = true;
        } else if (entry.contentHash !== current) {
          entry.status = DEFAULT_STATUS;
          entry.statusUpdatedAt = new Date().toISOString();
          entry.contentHash = current;
          changed = true;
          if (entry.notes.length === 0) {
            delete data.sections[key];
          }
        }
      } else if (entry.contentHash && entry.contentHash !== current) {
        // 疑问 / 未读：只同步 hash，不改状态
        entry.contentHash = current;
        changed = true;
      }
    }

    return changed;
  }

  getBook(bookId: string): Promise<BookAnnotations> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      if (await this.reconcileHashes(bookId, data)) {
        await this.save(bookId, data);
      }
      return data;
    });
  }

  setStatus(
    bookId: string,
    sectionId: string,
    status: SectionStatus,
  ): Promise<SectionAnnotation | null> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      const entry: SectionAnnotation = data.sections[sectionId] ?? {
        status: DEFAULT_STATUS,
        notes: [],
      };
      entry.status = status;
      entry.statusUpdatedAt = new Date().toISOString();

      if (RESET_ON_CHANGE.has(status)) {
        const hashes = await getBookSectionHashes(bookId);
        const h = hashes[sectionId];
        if (h) entry.contentHash = h;
      } else if (status === DEFAULT_STATUS) {
        delete entry.contentHash;
      }

      if (status === DEFAULT_STATUS && entry.notes.length === 0) {
        delete data.sections[sectionId];
        await this.save(bookId, data);
        return null;
      }
      data.sections[sectionId] = entry;
      await this.save(bookId, data);
      return entry;
    });
  }

  addNote(bookId: string, sectionId: string, text: string): Promise<Note> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      const entry: SectionAnnotation = data.sections[sectionId] ?? {
        status: DEFAULT_STATUS,
        notes: [],
      };
      const now = new Date().toISOString();
      const note: Note = { id: randomUUID(), text, createdAt: now, updatedAt: now };
      entry.notes.push(note);
      data.sections[sectionId] = entry;
      await this.save(bookId, data);
      return note;
    });
  }

  updateNote(
    bookId: string,
    sectionId: string,
    noteId: string,
    text: string,
  ): Promise<Note | null> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      const note = data.sections[sectionId]?.notes.find((n) => n.id === noteId);
      if (!note) return null;
      note.text = text;
      note.updatedAt = new Date().toISOString();
      await this.save(bookId, data);
      return note;
    });
  }

  deleteNote(bookId: string, sectionId: string, noteId: string): Promise<boolean> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      const entry = data.sections[sectionId];
      if (!entry) return false;
      const idx = entry.notes.findIndex((n) => n.id === noteId);
      if (idx < 0) return false;
      entry.notes.splice(idx, 1);
      if (entry.status === DEFAULT_STATUS && entry.notes.length === 0) {
        delete data.sections[sectionId];
      }
      await this.save(bookId, data);
      return true;
    });
  }

  deleteSection(bookId: string, sectionId: string): Promise<void> {
    return this.enqueue(bookId, async () => {
      const data = await this.load(bookId);
      delete data.sections[sectionId];
      await this.save(bookId, data);
    });
  }
}
