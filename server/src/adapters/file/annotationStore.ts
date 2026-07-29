import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_STATUS, type SectionStatus } from '../../../../shared/annotations';
import type { BookAnnotations, Note, SectionAnnotation } from '../../../../shared/types';
import type { AnnotationStore } from '../../ports/annotations';

export type { AnnotationStore };

const SAFE_BOOK_ID = /^[\w][\w.-]*$/;

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

  getBook(bookId: string): Promise<BookAnnotations> {
    return this.enqueue(bookId, async () => this.load(bookId));
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
