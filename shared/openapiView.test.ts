import { describe, expect, it } from 'vitest';
import { renderOpenApiView, type OpenApiSpec } from './openapiView';

describe('renderOpenApiView', () => {
  it('renders compact method/path rows', () => {
    const spec: OpenApiSpec = {
      openapi: '3.0.3',
      info: { title: 'Demo', version: '1.0.0', description: '示例' },
      paths: {
        '/items': {
          get: {
            summary: '列表',
            parameters: [
              {
                name: 'q',
                in: 'query',
                schema: { type: 'string' },
                description: '搜索',
              },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ItemPage' },
                  },
                },
              },
            },
          },
          post: {
            summary: '创建',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Item' },
                },
              },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    };
    const html = renderOpenApiView(spec);
    expect(html).toContain('class="openapi-view"');
    expect(html).toContain('Demo');
    expect(html).toContain('openapi-method-get');
    expect(html).toContain('/items');
    expect(html).toContain('列表');
    expect(html).toContain('ItemPage');
    expect(html).toContain('创建');
    expect(html).not.toContain('redoc');
  });
});
