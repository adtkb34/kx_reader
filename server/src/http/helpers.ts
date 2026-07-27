import type { Request, Response } from 'express';
import type { AppContext } from '../app/context';

export function badRequest(res: Response, error: string): void {
  res.status(400).json({ error });
}

export async function requireBook(
  ctx: AppContext,
  req: Request,
  res: Response,
): Promise<string | null> {
  const bookId = req.params.bookId as string;
  if (!(await ctx.books.bookExists(bookId))) {
    res.status(404).json({ error: `book "${bookId}" not found` });
    return null;
  }
  return bookId;
}
