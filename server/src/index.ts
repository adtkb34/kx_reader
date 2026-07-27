import { DATA_DIR, PORT } from './config';
import { FileAnnotationStore } from './adapters/file/annotationStore';
import { fileBookRepository } from './adapters/file/bookRepository';
import { createAppContext } from './app/context';
import { createHttpApp } from './http/createApp';

const ctx = createAppContext({
  books: fileBookRepository,
  annotations: new FileAnnotationStore(DATA_DIR),
});

const app = createHttpApp(ctx);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
