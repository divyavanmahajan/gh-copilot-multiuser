import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_REPO, PAGES, REPO_URL, SITE_URL, blobUrl, repoRoot } from "../scripts/site-config.js";

const read = (rel: string) => readFile(path.join(repoRoot, rel), "utf8");

/**
 * The project's URLs are one fact spread over a manifest, a README and half a
 * dozen documents, because markdown cannot read a constant. These tests are
 * what make that safe: they fail the moment a copy drifts from the manifest, so
 * `npm run sync:site-url` is a fix rather than a thing to remember.
 */
describe("site configuration", () => {
  it("derives both URLs from the manifest when not running in Actions", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      homepage: string;
      repository: { url: string };
    };
    expect(SITE_URL).toBe(manifest.homepage.replace(/\/+$/, ""));
    expect(REPO_URL).toBe(manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""));
    expect(OWNER_REPO).toMatch(/^[^/]+\/[^/]+$/);
    expect(blobUrl("docs/DESIGN.md")).toBe(`${REPO_URL}/blob/main/docs/DESIGN.md`);
  });

  it("publishes every document the README links, under the name the README uses", async () => {
    const readme = await read("README.md");
    const linked = [...readme.matchAll(/https:\/\/[a-z0-9-]+\.github\.io\/[^/)]+\/([A-Za-z0-9-]+\.html)/g)].map(
      (m) => m[1],
    );
    expect(linked.length).toBeGreaterThan(0);
    const published = new Set(PAGES.map((p) => p.slug));
    for (const slug of linked) expect(published).toContain(slug);
  });

  it("keeps every site URL in the markdown pointing at this repository", async () => {
    const files = ["README.md", "CLAUDE.md", ...PAGES.map((p) => p.source)];
    for (const rel of new Set(files)) {
      const text = await read(rel);
      for (const [url] of text.matchAll(/https:\/\/[a-z0-9-]+\.github\.io\/[A-Za-z0-9._-]+/gi)) {
        expect(url, `${rel} links a different site`).toBe(SITE_URL);
      }
      for (const [url] of text.matchAll(/https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/g)) {
        // Links to other projects are fine; only our own name must match.
        if (url.endsWith(OWNER_REPO.split("/")[1] ?? "")) {
          expect(url, `${rel} links a different repository`).toBe(REPO_URL);
        }
      }
    }
  });

  it("names a source file that exists for every published page", async () => {
    for (const page of PAGES) {
      await expect(read(page.source), `${page.source} is listed in PAGES but missing`).resolves.toBeTruthy();
      expect(page.slug).toMatch(/^[a-z0-9-]+\.html$/);
      expect(page.title.length).toBeGreaterThan(0);
    }
    // index.html has to exist or the site has no landing page.
    expect(PAGES.some((p) => p.slug === "index.html")).toBe(true);
  });
});
