/**
 * Who is performing a read/write. Today always local anonymous;
 * future auth can pass `{ kind: 'user', userId }` without changing adapters yet.
 */
export type Actor =
  | { kind: 'local' }
  | { kind: 'user'; userId: string };

export const LOCAL_ACTOR: Actor = { kind: 'local' };
