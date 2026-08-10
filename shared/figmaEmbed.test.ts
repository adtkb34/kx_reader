import { describe, expect, it } from 'vitest';
import { figmaMessageType, renderFigmaEmbed, toFigmaEmbedSrc } from './figmaEmbed';

describe('figmaMessageType', () => {
  it('reads plain string events from Figma', () => {
    expect(figmaMessageType('INITIAL_LOAD')).toBe('INITIAL_LOAD');
    expect(figmaMessageType('  EMBED_LOADED  ')).toBe('EMBED_LOADED');
  });

  it('reads { type } objects', () => {
    expect(figmaMessageType({ type: 'INITIAL_LOAD' })).toBe('INITIAL_LOAD');
  });

  it('returns null for unrelated payloads', () => {
    expect(figmaMessageType(null)).toBeNull();
    expect(figmaMessageType(42)).toBeNull();
    expect(figmaMessageType({ foo: 1 })).toBeNull();
  });
});

describe('toFigmaEmbedSrc', () => {
  it('adds embed-host, footer=false, device-frame=false by default', () => {
    const src = toFigmaEmbedSrc(
      'https://www.figma.com/proto/abc123/Login?node-id=1-2',
    );
    expect(src).toBeTruthy();
    const u = new URL(src!);
    expect(u.origin + u.pathname).toBe('https://embed.figma.com/proto/abc123/Login');
    expect(u.searchParams.get('node-id')).toBe('1-2');
    expect(u.searchParams.get('embed-host')).toBe('kx-reader');
    expect(u.searchParams.get('footer')).toBe('false');
    expect(u.searchParams.get('device-frame')).toBe('false');
  });

  it('preserves an explicit footer value', () => {
    const src = toFigmaEmbedSrc(
      'https://www.figma.com/proto/abc123/Login?footer=true',
    );
    expect(new URL(src!).searchParams.get('footer')).toBe('true');
  });
});

describe('renderFigmaEmbed', () => {
  it('sets iframe src immediately so the browser can fetch Figma ASAP', () => {
    const html = renderFigmaEmbed(
      'https://www.figma.com/proto/abc123/Login?node-id=1-2',
    );
    expect(html).toContain('class="figma-embed"');
    expect(html).toContain('<iframe');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
    expect(html).not.toContain('figma-embed-error');
    const src = html.match(/\ssrc="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    expect(src).toBeTruthy();
    const u = new URL(src!);
    expect(u.origin + u.pathname).toBe('https://embed.figma.com/proto/abc123/Login');
    expect(u.searchParams.get('node-id')).toBe('1-2');
    expect(u.searchParams.get('embed-host')).toBe('kx-reader');
    expect(u.searchParams.get('footer')).toBe('false');
    expect(u.searchParams.get('device-frame')).toBe('false');
  });

  it('uses optional second line as caption', () => {
    const html = renderFigmaEmbed(
      'https://www.figma.com/proto/abc123/Login\n登录流程',
    );
    expect(html).toContain('<span class="md-figcaption">登录流程</span>');
  });

  it('rejects non-proto Figma URLs with error + link', () => {
    const url = 'https://www.figma.com/design/abc123/File';
    const html = renderFigmaEmbed(url);
    expect(html).not.toContain('<iframe');
    expect(html).toContain('figma-embed-error');
    expect(html).toContain(`href="${url}"`);
  });

  it('rejects non-Figma URLs', () => {
    const html = renderFigmaEmbed('https://example.com/proto/x');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('figma-embed-error');
  });

  it('normalizes existing embed.figma.com proto URLs', () => {
    const html = renderFigmaEmbed(
      'https://embed.figma.com/proto/abc123?embed-host=other&node-id=5-3',
    );
    const src = html.match(/\ssrc="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    expect(src).toBeTruthy();
    const u = new URL(src!);
    expect(u.origin + u.pathname).toBe('https://embed.figma.com/proto/abc123');
    expect(u.searchParams.get('node-id')).toBe('5-3');
    expect(u.searchParams.get('embed-host')).toBe('kx-reader');
  });
});
