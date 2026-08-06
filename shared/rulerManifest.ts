import { findLensNode } from './lenses';
import type { BookLens, BookRuler, LensAxisId } from './types';

/** Book id / lens / link key segment. */
const SAFE_SEGMENT = /^[\w][\w.-]*$/;

/**
 * Parse `ruler` from book.json.
 * Empty `links: {}` is allowed (skeleton books before hang-offs are written).
 * Per-key `[]` is allowed (outline-only parents with no hang-offs).
 */
export function parseBookRuler(
  bookId: string,
  raw: unknown,
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): BookRuler | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const axis = (raw as { axis?: unknown }).axis;
  const keys = (raw as { keys?: unknown }).keys;
  const linksRaw = (raw as { links?: unknown }).links;
  if (typeof axis !== 'string' || !SAFE_SEGMENT.test(axis)) {
    console.warn(`book ${bookId}: ruler.axis invalid; skipping ruler`);
    return undefined;
  }
  if (bookLenses && !bookLenses[axis]) {
    console.warn(`book ${bookId}: ruler.axis "${axis}" not in lenses; skipping ruler`);
    return undefined;
  }
  if (keys != null && (typeof keys !== 'string' || !SAFE_SEGMENT.test(keys))) {
    console.warn(`book ${bookId}: ruler.keys invalid; skipping ruler`);
    return undefined;
  }
  if (typeof keys === 'string' && bookLenses) {
    const node = findLensNode(bookLenses[axis] ?? [], keys);
    if (!node) {
      console.warn(`book ${bookId}: ruler.keys "${keys}" not under axis "${axis}"; skipping ruler`);
      return undefined;
    }
  }
  if (!linksRaw || typeof linksRaw !== 'object' || Array.isArray(linksRaw)) {
    console.warn(`book ${bookId}: ruler.links must be an object; skipping ruler`);
    return undefined;
  }
  const links: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(linksRaw as Record<string, unknown>)) {
    if (!SAFE_SEGMENT.test(key)) {
      console.warn(`book ${bookId}: ruler.links key "${key}" invalid; skipping`);
      continue;
    }
    if (
      !Array.isArray(val) ||
      !val.every((s) => typeof s === 'string' && SAFE_SEGMENT.test(s))
    ) {
      console.warn(
        `book ${bookId}: ruler.links["${key}"] must be a string array; skipping`,
      );
      continue;
    }
    links[key] = [...(val as string[])];
  }
  return {
    axis,
    ...(typeof keys === 'string' ? { keys } : {}),
    links,
  };
}
