import { computed, type ComputedRef, type Ref } from 'vue';
import { tocOf } from '@/stores/books';
import { annotationsFor } from '@/stores/annotations';
import type { SectionAnnotation } from '@shared/types';

export interface OrphanEntry {
  key: string;
  entry: SectionAnnotation;
}

/** 标注 key 在当前目录中已不存在的条目（小节被删除或 id 被改动） */
export function useOrphans(bookId: Ref<string>): ComputedRef<OrphanEntry[]> {
  return computed(() => {
    const toc = tocOf(bookId.value);
    if (!toc) return [];
    const valid = new Set<string>();
    for (const ch of toc.chapters) {
      for (const s of ch.sections) valid.add(`${ch.id}#${s.id}`);
    }
    return Object.entries(annotationsFor(bookId.value))
      .filter(([key]) => !valid.has(key))
      .map(([key, entry]) => ({ key, entry }));
  });
}
