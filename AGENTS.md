# AGENTS.md

## Cursor Cloud specific instructions

Doc Book Reader (`doc-book-reader`) is a single-product npm-workspaces monorepo: an Express + TypeScript API (`server/`) and a Vue 3 + Vite reader SPA (`client/`), sharing types in `shared/`. Persistence is plain JSON files on disk (`data/annotations/`), content lives in `books/`; there is no database or external service.

- Node 20+ is required (`engines.node >=20`). Dependencies for all workspaces install from the repo root with a single `npm install`.
- Run both dev services with `npm run dev` (root): server on port `4730` (tsx watch), Vite client on port `5173` (proxies `/api` → 4730). Open `http://localhost:5173`. See `README.md` for the full command list and single-port prod alternative (`npm run build && npm start`).
- Lint/typecheck: there is no separate linter; `npm run typecheck` (root) runs `tsc --noEmit` for the server and `vue-tsc --noEmit` for the client. `npm run build` also runs typecheck first.
- A sample book (`books/sample`) and sample annotations (`data/annotations/sample.json`) ship in-repo, so the full reader/annotation flow is testable out of the box with no external setup. Both `books/*` (except `books/sample`) and `data/annotations/*` (except `sample.json`) are gitignored.
- Verifying annotations: writing a section status/note through the UI persists to `data/annotations/sample.json`. Check via `GET /api/books/sample/annotations`. Since `sample.json` is tracked by git, revert test writes with `git checkout -- data/annotations/sample.json` to keep the tree clean.
- The optional in-app AI feature is off by default (`AGENT_ENABLED=1` to enable) and requires a local Cursor Agent / Claude Code CLI on PATH; git version-compare features require a per-book `git init`. Neither is needed for normal development or testing.
