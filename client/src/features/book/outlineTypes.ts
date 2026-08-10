/** Shared right-rail outline row (digest / module). */
export interface DigestOutlineRow {
  id: string;
  title: string;
  level: number;
  number: string;
  chapterId?: string;
  sectionId?: string;
  isKey?: boolean;
  leafTitle?: string;
}
