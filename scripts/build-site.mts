/**
 * Builds the documentation site published to GitHub Pages.
 *
 * The markdown in `docs/` is the source of truth; this only wraps it. Rendering
 * goes through the same react-markdown pipeline the room itself uses, so a page
 * on the site and a reply in the transcript are formatted identically, and no
 * second markdown dependency has to be kept in step with the first.
 *
 * Output lands in `dist/site`, which the Pages workflow uploads.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "site");

interface Page {
  /** Source file, relative to the repository root. */
  source: string;
  /** Published file name. */
  slug: string;
  title: string;
  blurb: string;
}

const PAGES: Page[] = [
  { source: "README.md", slug: "index.html", title: "copilot-room", blurb: "One Copilot agent, one repo, your whole team in the room." },
  { source: "docs/USER-GUIDE.md", slug: "user-guide.html", title: "User guide", blurb: "Using a room: prompts, the queue, approvals, / and @." },
  { source: "docs/WALKTHROUGH.md", slug: "walkthrough.html", title: "Walkthrough", blurb: "Zero to a team driving one agent, step by step." },
  { source: "docs/DEPLOY.md", slug: "deploy.html", title: "Deploying", blurb: "Laptop mode, server mode, HTTPS, proxies." },
  { source: "docs/ENTERPRISE-SETUP.md", slug: "enterprise-setup.html", title: "Enterprise setup", blurb: "GitHub App, Entra, and policy checklist." },
  { source: "docs/PUBLISHING.md", slug: "publishing.html", title: "Publishing", blurb: "Cutting a release to npm and GHCR." },
  { source: "docs/DESIGN.md", slug: "design.html", title: "Design", blurb: "Architecture, milestones, and runtime constraints." },
];

/** Markdown file -> published page, for rewriting links between documents. */
const BY_SOURCE = new Map(PAGES.map((p) => [p.source, p]));

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const written = new Set<string>();
  const write = async (name: string, contents: string) => {
    await writeFile(path.join(out, name), contents, "utf8");
    written.add(name);
  };

  for (const page of PAGES) {
    const markdown = await readFile(path.join(root, page.source), "utf8");
    const body = withHeadingIds(
      renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, markdown)),
    );
    await write(page.slug, shell(page, rewriteLinks(body, page)));
  }

  await write("styles.css", STYLES);
  // Without this, Pages runs the output through Jekyll, which drops files
  // beginning with an underscore and rewrites things we have already rendered.
  await write(".nojekyll", "");

  // Drop anything a previous build produced that this one did not, so a page
  // removed from PAGES stops being published. Overwriting in place rather than
  // deleting the directory first keeps this working on Windows, where an open
  // file viewer is enough to make rmdir fail with EBUSY.
  for (const stale of await readdir(out)) {
    if (!written.has(stale)) await rm(path.join(out, stale), { recursive: true, force: true });
  }
  console.log(`built ${PAGES.length} pages into ${path.relative(root, out)}`);
}

/**
 * Point links at the built pages. Anchors and external URLs are left alone.
 * A link to a document that is not published keeps pointing at GitHub, so it
 * still resolves rather than 404ing on the site.
 */
function rewriteLinks(html: string, from: Page): string {
  const fromDir = path.posix.dirname(from.source);
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    if (/^(https?:|mailto:|#)/.test(href)) return whole;
    const [target, anchor] = href.split("#");
    if (!target) return whole;
    const resolved = path.posix.normalize(path.posix.join(fromDir === "." ? "" : fromDir, target));
    const page = BY_SOURCE.get(resolved);
    if (page) return `href="${page.slug}${anchor ? `#${anchor}` : ""}"`;
    if (target.endsWith(".md")) {
      return `href="https://github.com/divyavanmahajan/gh-copilot-multiuser/blob/main/${resolved}"`;
    }
    return whole;
  });
}

/**
 * Give headings the ids GitHub would give them, so a table of contents copied
 * from the markdown keeps working on the site.
 */
function withHeadingIds(html: string): string {
  const used = new Map<string, number>();
  return html.replace(/<(h[1-6])>([\s\S]*?)<\/\1>/g, (_whole, tag: string, inner: string) => {
    const base = slug(inner.replace(/<[^>]*>/g, ""));
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen}`;
    return `<${tag} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</${tag}>`;
  });
}

function slug(text: string): string {
  // Matches GitHub's own slugger, including the detail that runs of spaces are
  // not collapsed: "Skills: the `/` menu" becomes "skills-the--menu", so a
  // table of contents copied out of the markdown still lands on its heading.
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/ /g, "-");
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(page: Page, body: string): string {
  const nav = PAGES.map(
    (p) =>
      `<a href="${p.slug}"${p.slug === page.slug ? ' aria-current="page"' : ""}>${escape(p.title)}</a>`,
  ).join("\n        ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title === "copilot-room" ? page.title : `${page.title} · copilot-room`)}</title>
<meta name="description" content="${escape(page.blurb)}">
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='14'>💬</text></svg>">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="wrap">
  <nav>
    <div class="brand"><a href="index.html">copilot-room</a></div>
    <div class="links">
        ${nav}
    </div>
    <div class="repo"><a href="https://github.com/divyavanmahajan/gh-copilot-multiuser">Source on GitHub</a></div>
  </nav>
  <main id="content">
${body}
  </main>
</div>
</body>
</html>
`;
}

const STYLES = `:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --panel: #f6f8fa;
  --border: #d0d7de;
  --text: #1f2328;
  --muted: #656d76;
  --accent: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #4493f8;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 8px; top: 8px; background: var(--accent); color: #fff; padding: 8px; border-radius: 6px; z-index: 10; }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 40px; max-width: 1100px; margin: 0 auto; padding: 32px 24px 96px; }
nav { position: sticky; top: 32px; align-self: start; }
.brand a { font-weight: 700; font-size: 18px; color: var(--text); text-decoration: none; }
nav .links { display: flex; flex-direction: column; margin: 20px 0; }
nav .links a { color: var(--muted); text-decoration: none; padding: 6px 10px; border-radius: 6px; font-size: 15px; }
nav .links a:hover { background: var(--panel); color: var(--text); }
nav .links a[aria-current="page"] { background: var(--panel); color: var(--text); font-weight: 600; }
nav .repo a { color: var(--muted); font-size: 14px; }
main { min-width: 0; }
h1, h2, h3, h4 { line-height: 1.25; margin: 32px 0 12px; }
h1 { font-size: 32px; margin-top: 0; }
h2 { font-size: 24px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
h3 { font-size: 19px; }
p, ul, ol, blockquote, table { margin: 0 0 16px; }
ul, ol { padding-left: 24px; }
li { margin: 4px 0; }
a { color: var(--accent); }
.anchor { float: left; margin-left: -22px; width: 22px; color: var(--muted); opacity: 0; text-decoration: none; font-weight: 400; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 85%; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 1px 5px; }
pre { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
pre code { background: none; border: 0; padding: 0; font-size: 13.5px; line-height: 1.5; }
blockquote { border-left: 3px solid var(--border); padding-left: 14px; margin-left: 0; color: var(--muted); }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 7px 12px; text-align: left; vertical-align: top; }
th { background: var(--panel); }
hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
img { max-width: 100%; }
@media (max-width: 800px) {
  .wrap { grid-template-columns: 1fr; gap: 20px; padding: 20px 16px 64px; }
  nav { position: static; }
  nav .links { flex-flow: row wrap; }
}
`;

main().catch((err: unknown) => {
  console.error("site build failed:", err);
  process.exit(1);
});
