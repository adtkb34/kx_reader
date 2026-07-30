<script setup lang="ts">
import { computed } from 'vue';
import type { BookToc, LensSelection } from '@shared/types';
import {
  digestAnchorId,
  filterChapters,
  groupChaptersForDigest,
  visibleTocSections,
} from '@shared/lenses';
import { annotationsFor, sectionKey } from '@/stores/annotations';

const props = defineProps<{
  toc: BookToc;
  bookId: string;
  lensSelection?: LensSelection | null;
}>();

interface OutlineSection {
  chapterId: string;
  sectionId: string;
  title: string;
  level: number;
}

interface OutlinePage {
  chapterId: string;
  title: string;
  sections: OutlineSection[];
}

interface OutlineGroup {
  groupTitle: string | null;
  pages: OutlinePage[];
}

const anns = computed(() => annotationsFor(props.bookId));

const groups = computed((): OutlineGroup[] => {
  const chapters = filterChapters(props.toc.chapters, props.lensSelection ?? null, props.toc);
  return groupChaptersForDigest(props.toc, chapters)
    .map((g) => ({
      groupTitle: g.groupTitle,
      pages: g.pages
        .map((ch) => ({
          chapterId: ch.id,
          title: ch.title,
          sections: visibleTocSections(ch, props.lensSelection ?? null, props.toc).map((s) => ({
            chapterId: ch.id,
            sectionId: s.id,
            title: s.title,
            level: s.level,
          })),
        }))
        .filter((p) => p.sections.length > 0),
    }))
    .filter((g) => g.pages.length > 0);
});

function noteCount(chapterId: string, sectionId: string): number {
  return anns.value[sectionKey(chapterId, sectionId)]?.notes.length ?? 0;
}

function goSection(chapterId: string, sectionId: string): void {
  const el = document.getElementById(digestAnchorId(chapterId, sectionId));
  if (!el) return;
  const topbarOffset = 64;
  const y = el.getBoundingClientRect().top + window.scrollY - topbarOffset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}
</script>

<template>
  <aside v-if="groups.length" class="chapter-outline">
    <nav class="chapter-outline-nav">
      <div v-for="(g, gi) in groups" :key="g.groupTitle ?? `g-${gi}`" class="digest-outline-group">
        <div v-if="g.groupTitle" class="digest-outline-group-title">{{ g.groupTitle }}</div>
        <div v-for="page in g.pages" :key="page.chapterId" class="digest-outline-page-block">
          <div class="digest-outline-page-title">{{ page.title }}</div>
          <ul class="toc-sections digest-outline">
            <li
              v-for="s in page.sections"
              :key="s.chapterId + '#' + s.sectionId"
              :class="`lvl-${s.level}`"
            >
              <a href="#" @click.prevent="goSection(s.chapterId, s.sectionId)">
                <span class="toc-sec-title">{{ s.title }}</span>
                <span v-if="noteCount(s.chapterId, s.sectionId)" class="note-count">
                  {{ noteCount(s.chapterId, s.sectionId) }}
                </span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  </aside>
</template>
