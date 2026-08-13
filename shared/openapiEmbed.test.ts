import { describe, expect, it } from 'vitest';
import { renderOpenApiEmbed } from './openapiEmbed';

describe('renderOpenApiEmbed', () => {
  it('renders asset path placeholder', () => {
    const html = renderOpenApiEmbed('assets/openapi/demo.yaml\n工艺 API');
    expect(html).toContain('class="openapi-embed"');
    expect(html.startsWith('<pre class="openapi-embed"')).toBe(true);
    expect(html).toContain('data-spec-path="assets/openapi/demo.yaml"');
    expect(html).toContain('工艺 API');
    expect(html).toContain('openapi-embed-mount');
    expect(html).toContain('<span class="openapi-embed-mount"');
  });

  it('renders remote url placeholder', () => {
    const html = renderOpenApiEmbed('https://example.com/openapi.json');
    expect(html).toContain('data-spec-url="https://example.com/openapi.json"');
    expect(html).not.toContain('data-spec-path');
  });

  it('renders inline openapi as base64', () => {
    const html = renderOpenApiEmbed('openapi: 3.0.3\ninfo:\n  title: Demo\n  version: 1.0.0');
    expect(html).toContain('data-spec-b64="');
    expect(html).not.toContain('data-spec-path');
  });

  it('errors on empty body', () => {
    expect(renderOpenApiEmbed('')).toContain('openapi-embed-error');
  });
});
