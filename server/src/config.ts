import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '../..');
export const BOOKS_DIR = process.env.BOOKS_DIR ?? path.join(ROOT_DIR, 'books');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data');
export const PORT = Number(process.env.PORT ?? 4730);
