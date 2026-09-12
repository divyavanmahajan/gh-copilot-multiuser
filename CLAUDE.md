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

## Documentation

Docs are part of the change, not a follow-up. A change that alters what someone
sees or does is not finished until the docs match it, in the same commit.

- `docs/USER-GUIDE.md` — for people working in a room. Update it when the UI,
  the commands, or the rules about who may do what change.
- `docs/WALKTHROUGH.md` — for whoever sets a room up. Update it when flags,
  environment variables, sign-in, or the setup steps change. New failure modes
  belong in its troubleshooting table.
- `docs/DEPLOY.md`, `docs/ENTERPRISE-SETUP.md` — hosting and org policy.
- `docs/PUBLISHING.md` — releases. Update it when the release workflow or the
  contents of the published package change.
- `docs/DESIGN.md` — architecture. Update it when the shape of the system
  changes, not for ordinary features.
- `README.md` links every doc; add new ones to that list.
- The docs are published to GitHub Pages from `main` by
  `.github/workflows/pages.yml`. A new document must be added to `PAGES` in
  `scripts/site-config.ts` or it will not appear on the site.
- The project's own URLs live in `scripts/site-config.ts`, derived from
  `package.json` or from the Actions environment. Do not hand-edit the copies
  in README.md and docs/: run `npm run sync:site-url`. `test/site.test.ts`
  fails if they drift.

Two rules that matter more than the file list:

- **Write down what you had to discover.** If a runtime or an API did not
  behave the way its types promised, say so where the next person will hit it,
  with the error text. A workaround with no explanation gets "cleaned up" later
  by someone who does not know why it exists.
- **Correct docs that a change makes wrong.** Removing a stale sentence is as
  much a part of the change as adding a true one.
