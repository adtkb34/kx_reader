import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT_DIR } from '../config';
import type { AppContext } from '../app/context';
import { booksRouter } from './routes/books';
import { annotationsRouter } from './routes/annotations';
import { gitRouter } from './routes/git';
import { agentRouter } from './routes/agent';

/**
 * Build the Express app. Auth middleware can mount here later
 * (before domain routers) without changing use-case code.
 */
export function createHttpApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());

  // Future: app.use(authMiddleware)

  app.use(booksRouter(ctx));
  app.use(annotationsRouter(ctx));
  app.use(gitRouter(ctx));
  app.use(agentRouter(ctx));

  const clientDist = path.join(ROOT_DIR, 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(clientDist, 'index.html'));
      } else {
        next();
      }
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
