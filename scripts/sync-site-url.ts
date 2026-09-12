/**
 * Rewrites the project's own URLs in the markdown and the manifest to wherever
 * the repository actually lives.
 *
 * Markdown cannot read a constant, so README.md and docs/ carry literal URLs.
 * This keeps them honest: the Pages workflow runs it on a push with the real
 * location introspected from the Actions environment, so a fork, a transfer or
 * a rename fixes its own links instead of advertising the original repository.
 *
 *   npm run sync:site-url          # rewrite, report what changed
 *   npm run sync:site-url -- --check   # fail if anything would change
 *
 * The site build does not depend on this: it resolves the same values itself.
 * This exists for the text a reader sees on npm and on GitHub.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { OWNER_REPO, PAGES, REPO_URL, SITE_URL, repoRoot } from "./site-config.js";

/** Files that may mention the project's own location. */
const TARGETS = ["README.md", "CLAUDE.md", ...PAGES.filter((p) => p.source !== "README.md").map((p) => p.source)];

const check = process.argv.includes("--check");

/**
 * Matches any GitHub Pages address, repository URL or GHCR image for a project
 * of this name, whoever owns it. Anchoring on the repository name rather than
 * the owner is what lets a fork rewrite the original owner's URLs to its own.
 */
function patterns(name: string): Array<{ find: RegExp; replace: string }> {
  const n = escapeRegExp(name);
  return [
    // https://<owner>.github.io/<name>
    { find: new RegExp(`https://[a-z0-9-]+\\.github\\.io/${n}`, "gi"), replace: SITE_URL },
    // https://github.com/<owner>/<name>
    { find: new RegExp(`https://github\\.com/[A-Za-z0-9-]+/${n}`, "g"), replace: REPO_URL },
    // ghcr.io/<owner>/<name>
    { find: new RegExp(`ghcr\\.io/[A-Za-z0-9-]+/${n}`, "g"), replace: `ghcr.io/${OWNER_REPO.toLowerCase()}` },
  ];
}

async function main(): Promise<void> {
  const name = OWNER_REPO.split("/")[1];
  if (!name) throw new Error(`could not read a repository name from ${OWNER_REPO}`);
  const rules = patterns(name);

  const changed: string[] = [];
  for (const rel of TARGETS) {
    const file = path.join(repoRoot, rel);
    const before = await readFile(file, "utf8");
    let after = before;
    for (const { find, replace } of rules) after = after.replace(find, replace);
    if (after === before) continue;
    changed.push(rel);
    if (!check) await writeFile(file, after, "utf8");
  }

  // The manifest is the fallback the rest of this reads when not in Actions, so
  // it has to agree too.
  const manifestPath = path.join(repoRoot, "package.json");
  const manifestBefore = await readFile(manifestPath, "utf8");
  const manifestAfter = manifestBefore
    .replace(/("homepage":\s*")[^"]*(")/, `$1${SITE_URL}$2`)
    .replace(/("url":\s*"git\+)[^"]*(")/, `$1${REPO_URL}.git$2`)
    .replace(/("bugs":\s*")[^"]*(")/, `$1${REPO_URL}/issues$2`);
  if (manifestAfter !== manifestBefore) {
    changed.push("package.json");
    if (!check) await writeFile(manifestPath, manifestAfter, "utf8");
  }

  if (changed.length === 0) {
    console.log(`site URLs already match ${SITE_URL}`);
    return;
  }
  if (check) {
    console.error(
      `these files disagree with ${SITE_URL}:\n  ${changed.join("\n  ")}\n` +
        `run \`npm run sync:site-url\` to fix them`,
    );
    process.exit(1);
  }
  console.log(`rewrote to ${SITE_URL}:\n  ${changed.join("\n  ")}`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((err: unknown) => {
  console.error("sync-site-url failed:", err);
  process.exit(1);
});
