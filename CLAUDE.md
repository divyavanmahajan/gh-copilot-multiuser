# Repository instructions for AI assistants

## Commit messages

- Do not add AI attribution to commit messages. No `Co-Authored-By` lines
  naming Claude or any other assistant, no `Claude-Session` or similar
  trailers, no model names or session links.
- Do not mention AI assistants in pull request titles or descriptions either.
- Write ordinary commit messages: a short imperative subject line and, when
  useful, a body explaining why.

## Project

- TypeScript throughout. Run `npm run typecheck && npm test && npm run build`
  before committing.
- `src/server/agent/copilot.ts` is the only file that imports the Copilot SDK.
- `src/protocol/messages.ts` is shared by server and browser; keep it free of
  server-only or browser-only imports.
- Docs live in `docs/`. Update `docs/WALKTHROUGH.md` when user-facing
  behaviour changes.
