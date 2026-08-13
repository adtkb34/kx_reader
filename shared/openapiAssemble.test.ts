import { describe, expect, it } from 'vitest';
import { assembleModuleView } from './ruler';
import type { BookToc, TocChapter } from './types';

function page(
  partial: Pick<TocChapter, 'id' | 'title' | 'file'> &
    Partial<Pick<TocChapter, 'role' | 'layers' | 'sections'>>,
): TocChapter {
  return { sections: [], ...partial };
}

/** Minimal process module: ruler tick + OpenAPI hang (mirrors METOAK MES). */
const toc: BookToc = {
  id: 'metoak-mes',
  title: 'METOAK MES',
  ruler: {
    axes: ['priority', 'status'],
    links: {
      '202608101427': ['20260810142707'],
    },
  },
  lensAxisOrder: ['biz', 'impl', 'status', 'priority', 'role'],
  lenses: {
    biz: [
      { id: 'overview', title: '概览' },
      { id: 'flow', title: '流程' },
    ],
    impl: [{ id: 'api', title: '接口' }],
    status: [
      { id: 'planned', title: '待规划' },
      { id: 'doing', title: '进行中' },
    ],
    priority: [{ id: 'p1', title: 'P1' }],
    role: [{ id: 'process-eng', title: '工艺员' }],
  },
  tree: [
    {
      type: 'group',
      id: 'resource-support',
      title: '资源支撑',
      children: [
        {
          type: 'group',
          id: 'process',
          title: '工艺定义',
          children: [
            { type: 'page', id: '202608101208', title: '工艺', file: 'process/index.md' },
            { type: 'page', id: '202608121630', title: '工艺接口', file: 'process/api.md' },
          ],
        },
      ],
    },
  ],
  chapters: [
    page({
      id: '202608101208',
      title: '工艺',
      file: 'process/index.md',
      role: 'ruler',
      layers: { priority: 'p1', role: ['process-eng'] },
      sections: [{ id: '202608101427', title: '工艺流程', level: 2 }],
    }),
    page({
      id: '202608121630',
      title: '工艺接口',
      file: 'process/api.md',
      layers: { impl: 'api', priority: 'p1' },
      sections: [{ id: '20260810142707', title: '', level: 2 }],
    }),
  ],
};

describe('openapi hang under process module', () => {
  it('includes api hang when status axis is open', () => {
    const view = assembleModuleView(
      toc,
      {
        impl: ['api'],
        priority: ['p1'],
        biz: ['biz'],
        status: ['status'],
        role: ['process-eng'],
      },
      null,
      '202608101208',
      'index',
    );
    const hangIds =
      view?.buckets.flatMap((b) =>
        b.keys.flatMap((k) => k.groups.flatMap((g) => g.blocks.map((x) => x.sectionId))),
      ) ?? [];
    expect(hangIds).toContain('20260810142707');
  });
});
