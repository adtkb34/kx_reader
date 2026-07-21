/**
 * 小节状态定义：server 与 client 共用的唯一来源。
 * 需要新增状态时只改这里（以及样式里对应的颜色即可）。
 */
export const SECTION_STATUSES = [
  { id: 'unread', label: '未读', color: '#9ca3af' },
  { id: 'read', label: '已读', color: '#22c55e' },
  { id: 'question', label: '疑问', color: '#f59e0b' },
  { id: 'confirmed', label: '确认', color: '#3b82f6' },
] as const;

export type SectionStatus = (typeof SECTION_STATUSES)[number]['id'];

export const SECTION_STATUS_IDS = SECTION_STATUSES.map((s) => s.id) as SectionStatus[];

export const DEFAULT_STATUS: SectionStatus = 'unread';

export function statusMeta(id: SectionStatus) {
  return SECTION_STATUSES.find((s) => s.id === id) ?? SECTION_STATUSES[0];
}
