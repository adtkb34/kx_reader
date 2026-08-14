/** Trigger a browser download of a UTF-8 text file. */
export function downloadTextFile(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through
    }
  }
  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1].trim();
  const plain = header.match(/filename\s*=\s*([^;]+)/i);
  return plain?.[1]?.trim() ?? null;
}

/** Safe filename segment (Windows / macOS friendly). */
export function sanitizeDownloadName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'export';
}
