/**
 * Where this project lives, and which documents the site publishes.
 *
 * Resolved in this order, so a fork or a rename needs no edit:
 *
 *   1. `SITE_URL` / `REPO_URL` in the environment. The Pages workflow passes
 *      the real values, taken from `actions/configure-pages` and
 *      `GITHUB_REPOSITORY`, so a build always describes where it is actually
 *      being published.
 *   2. `GITHUB_REPOSITORY`, which every Actions run sets, giving the
 *      conventional `https://<owner>.github.io/<name>` Pages address.
 *   3. `package.json` - `homepage` and `repository` - for a local build.
 *
 * Markdown cannot read a constant, so the URLs in README.md and docs/ are
 * necessarily literal copies. `npm run sync:site-url` rewrites them from
 * whatever this resolves to, the Pages workflow runs it on a push, and
 * `test/site.test.ts` fails if they drift. That is what keeps them one fact
 * rather than thirteen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");

interface Manifest {
  homepage?: string;
  repository?: { url?: string } | string;
}

const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as Manifest;

/** "owner/name" from the Actions environment, when there is one. */
const fromActions = process.env.GITHUB_REPOSITORY?.split("/");
const actionsOwner = fromActions?.[0];
const actionsName = fromActions?.[1];

/** The repository's web URL, without a trailing slash or the git+/.git wrapping. */
export const REPO_URL = trimSlash(
  clean(
    process.env.REPO_URL ??
      (actionsOwner && actionsName ? `https://github.com/${actionsOwner}/${actionsName}` : undefined) ??
      required(
        typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url,
        "repository.url",
      ),
  ),
);

/** The published documentation site, without a trailing slash. */
export const SITE_URL = trimSlash(
  process.env.SITE_URL ??
    (actionsOwner && actionsName ? `https://${actionsOwner}.github.io/${actionsName}` : undefined) ??
    required(manifest.homepage, "homepage"),
);

/** "owner/name", as GitHub Actions and the container registry spell it. */
export const OWNER_REPO = new URL(REPO_URL).pathname.replace(/^\//, "");

export interface Page {
  /** Source file, relative to the repository root. */
  source: string;
  /** Published file name. */
  slug: string;
  title: string;
  blurb: string;
}

export const PAGES: Page[] = [
  { source: "README.md", slug: "index.html", title: "copilot-room", blurb: "One Copilot agent, one repo, your whole team in the room." },
  { source: "docs/USER-GUIDE.md", slug: "user-guide.html", title: "User guide", blurb: "Using a room: prompts, the queue, approvals, / and @." },
  { source: "docs/WALKTHROUGH.md", slug: "walkthrough.html", title: "Walkthrough", blurb: "Zero to a team driving one agent, step by step." },
  { source: "docs/DEPLOY.md", slug: "deploy.html", title: "Deploying", blurb: "Laptop mode, server mode, HTTPS, proxies." },
  { source: "docs/ENTERPRISE-SETUP.md", slug: "enterprise-setup.html", title: "Enterprise setup", blurb: "GitHub App, Entra, and policy checklist." },
  { source: "docs/LICENSING.md", slug: "licensing.html", title: "Licensing", blurb: "Who needs a Copilot seat, under GitHub and Microsoft agreements." },
  { source: "docs/PUBLISHING.md", slug: "publishing.html", title: "Publishing", blurb: "Cutting a release to npm and GHCR." },
  { source: "docs/DESIGN.md", slug: "design.html", title: "Design", blurb: "Architecture, milestones, and runtime constraints." },
];

/** A file in the repository, for linking to something the site does not publish. */
export function blobUrl(repoRelativePath: string): string {
  return `${REPO_URL}/blob/main/${repoRelativePath}`;
}

function required(value: string | undefined, field: string): string {
  if (!value) throw new Error(`package.json is missing "${field}", which the documentation site is built from`);
  return value;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function clean(url: string): string {
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}
