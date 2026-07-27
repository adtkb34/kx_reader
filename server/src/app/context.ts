import type { Actor } from '../domain/actor';
import { LOCAL_ACTOR } from '../domain/actor';
import type { AnnotationStore } from '../ports/annotations';
import type { BookRepository } from '../ports/books';

export interface AppContext {
  books: BookRepository;
  annotations: AnnotationStore;
  /** Default actor until HTTP auth exists. */
  actor: Actor;
}

export function createAppContext(deps: {
  books: BookRepository;
  annotations: AnnotationStore;
  actor?: Actor;
}): AppContext {
  return {
    books: deps.books,
    annotations: deps.annotations,
    actor: deps.actor ?? LOCAL_ACTOR,
  };
}
