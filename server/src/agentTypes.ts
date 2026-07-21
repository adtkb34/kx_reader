export type AgentSseEvent =
  | { type: 'log'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; code: number }
  | { type: 'error'; message: string };
