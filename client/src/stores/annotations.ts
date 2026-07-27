import { reactive } from 'vue';
import { api } from '@/api/client';
import { DEFAULT_STATUS, type SectionStatus } from '@shared/annotations';
import type { AnnotationMap, Note, SectionAnnotation } from '@shared/types';

const state = reactive<{ byBook: Record<string, AnnotationMap> }>({ byBook: {} });

export function sectionKey(chapterId: string, sectionId: string): string {
  return `${chapterId}#${sectionId}`;
}

export function annotationsFor(bookId: string): AnnotationMap {
  return state.byBook[bookId] ?? {};
}

export async function loadAnnotations(bookId: string): Promise<void> {
  const data = await api.annotations(bookId);
  state.byBook[bookId] = data.sections ?? {};
}

export function entryOf(bookId: string, key: string): SectionAnnotation | undefined {
  return state.byBook[bookId]?.[key];
}

export function statusOf(bookId: string, key: string): SectionStatus {
  return entryOf(bookId, key)?.status ?? DEFAULT_STATUS;
}

export function notesOf(bookId: string, key: string): Note[] {
  return entryOf(bookId, key)?.notes ?? [];
}

function mapFor(bookId: string): AnnotationMap {
  if (!state.byBook[bookId]) state.byBook[bookId] = {};
  return state.byBook[bookId];
}

export async function setStatus(bookId: string, key: string, status: SectionStatus): Promise<void> {
  const updated = await api.setStatus(bookId, key, status);
  const map = mapFor(bookId);
  if (updated) map[key] = updated;
  else delete map[key];
}

export async function addNote(bookId: string, key: string, text: string): Promise<void> {
  const note = await api.addNote(bookId, key, text);
  const map = mapFor(bookId);
  const entry = map[key] ?? { status: DEFAULT_STATUS, notes: [] };
  entry.notes = [...entry.notes, note];
  map[key] = entry;
}

export async function updateNote(
  bookId: string,
  key: string,
  noteId: string,
  text: string,
): Promise<void> {
  const note = await api.updateNote(bookId, key, noteId, text);
  const entry = entryOf(bookId, key);
  if (!entry) return;
  entry.notes = entry.notes.map((n) => (n.id === noteId ? note : n));
}

export async function deleteNote(bookId: string, key: string, noteId: string): Promise<void> {
  await api.deleteNote(bookId, key, noteId);
  const map = mapFor(bookId);
  const entry = map[key];
  if (!entry) return;
  entry.notes = entry.notes.filter((n) => n.id !== noteId);
  if (entry.status === DEFAULT_STATUS && entry.notes.length === 0) delete map[key];
}

export async function deleteSection(bookId: string, key: string): Promise<void> {
  await api.deleteSection(bookId, key);
  delete mapFor(bookId)[key];
}
