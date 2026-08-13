/**
 * Compact OpenAPI → HTML for the reader (book-like ops list, not Redoc portal).
 */

export type OpenApiSpec = {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, unknown>>;
};

const METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function schemaLabel(schema: unknown): string {
  const s = asRecord(schema);
  if (!s) return '';
  if (typeof s.$ref === 'string') {
    const ref = s.$ref;
    const name = ref.split('/').pop();
    return name || ref;
  }
  if (typeof s.type === 'string') {
    if (s.type === 'array') {
      const items = schemaLabel(s.items);
      return items ? `${items}[]` : 'array';
    }
    if (s.format) return `${s.type}(${s.format})`;
    return s.type;
  }
  if (Array.isArray(s.oneOf)) return 'oneOf';
  if (Array.isArray(s.anyOf)) return 'anyOf';
  if (asRecord(s.allOf)) return 'object';
  return 'object';
}

function paramRows(op: Record<string, unknown>): string {
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  if (params.length === 0) return '';
  const rows = params
    .map((p) => {
      const param = asRecord(p);
      if (!param) return '';
      const name = String(param.name ?? '');
      const where = String(param.in ?? '');
      const required = param.required === true ? '是' : '';
      const typ = schemaLabel(param.schema) || String(param.type ?? '');
      const desc = String(param.description ?? '');
      return (
        `<tr>` +
        `<td><code>${esc(name)}</code></td>` +
        `<td>${esc(where)}</td>` +
        `<td>${esc(typ)}</td>` +
        `<td>${esc(required)}</td>` +
        `<td>${esc(desc)}</td>` +
        `</tr>`
      );
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return (
    `<div class="openapi-block">` +
    `<div class="openapi-block-title">参数</div>` +
    `<table class="openapi-table">` +
    `<thead><tr><th>名称</th><th>位置</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  );
}

function bodyBlock(op: Record<string, unknown>): string {
  const body = asRecord(op.requestBody);
  if (!body) return '';
  const content = asRecord(body.content);
  if (!content) return '';
  const entries = Object.entries(content);
  if (entries.length === 0) return '';
  const lines = entries
    .map(([ct, raw]) => {
      const media = asRecord(raw);
      const typ = schemaLabel(media?.schema);
      return (
        `<tr>` +
        `<td><code>${esc(ct)}</code></td>` +
        `<td>${esc(typ)}</td>` +
        `<td>${body.required === true ? '是' : ''}</td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<div class="openapi-block">` +
    `<div class="openapi-block-title">请求体</div>` +
    `<table class="openapi-table">` +
    `<thead><tr><th>Content-Type</th><th>类型</th><th>必填</th></tr></thead>` +
    `<tbody>${lines}</tbody>` +
    `</table></div>`
  );
}

function responseRows(op: Record<string, unknown>): string {
  const responses = asRecord(op.responses);
  if (!responses) return '';
  const rows = Object.entries(responses)
    .map(([code, raw]) => {
      const resp = asRecord(raw);
      const desc = String(resp?.description ?? '');
      const content = asRecord(resp?.content);
      const first = content ? Object.values(content)[0] : null;
      const typ = schemaLabel(asRecord(first)?.schema);
      return (
        `<tr>` +
        `<td><code>${esc(code)}</code></td>` +
        `<td>${esc(typ)}</td>` +
        `<td>${esc(desc)}</td>` +
        `</tr>`
      );
    })
    .join('');
  if (!rows) return '';
  return (
    `<div class="openapi-block">` +
    `<div class="openapi-block-title">响应</div>` +
    `<table class="openapi-table">` +
    `<thead><tr><th>状态</th><th>类型</th><th>说明</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  );
}

export function renderOpenApiView(spec: OpenApiSpec): string {
  const title = spec.info?.title?.trim() || 'API';
  const version = spec.info?.version?.trim() || '';
  const desc = spec.info?.description?.trim() || '';
  const paths = spec.paths ?? {};

  const ops: string[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    for (const method of METHODS) {
      const op = asRecord(item[method]);
      if (!op) continue;
      const summary = String(op.summary ?? op.operationId ?? '').trim();
      const parts = [paramRows(op), bodyBlock(op), responseRows(op)].filter(Boolean);
      const detail =
        parts.join('') || `<p class="openapi-empty">无参数与响应说明</p>`;
      ops.push(
        `<details class="openapi-op">` +
          `<summary>` +
          `<span class="openapi-method openapi-method-${method}">${method.toUpperCase()}</span>` +
          `<span class="openapi-path"><code>${esc(path)}</code></span>` +
          (summary ? `<span class="openapi-op-summary">${esc(summary)}</span>` : '') +
          `</summary>` +
          `<div class="openapi-op-body">${detail}</div>` +
          `</details>`,
      );
    }
  }

  if (ops.length === 0) {
    return `<div class="openapi-view openapi-view-empty">规范中没有 paths</div>`;
  }

  return (
    `<div class="openapi-view">` +
    `<div class="openapi-head">` +
    `<div class="openapi-title">${esc(title)}` +
    (version ? `<span class="openapi-ver">${esc(version)}</span>` : '') +
    `</div>` +
    (desc ? `<div class="openapi-desc">${esc(desc)}</div>` : '') +
    `</div>` +
    `<div class="openapi-ops">${ops.join('')}</div>` +
    `</div>`
  );
}

export function parseOpenApiText(text: string): OpenApiSpec {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('空规范');
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as OpenApiSpec;
  }
  // Lazy: caller may pass already-parsed object via JSON; YAML parsed in client.
  throw new Error('YAML_NEEDED');
}
