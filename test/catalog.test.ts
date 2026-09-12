import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCatalog, parseFrontMatter } from "../src/server/agent/catalog.js";
import { parseCommand, splitAgentMention } from "../src/protocol/messages.js";

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), "catalog-"));
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(repo, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return repo;
}

const skill = (name: string, description: string) => `---
name: ${name}
description: ${description}
---

Do the thing.
`;

describe("discoverCatalog", () => {
  it("finds skills and agents in both the github and claude layouts", async () => {
    const repo = await repoWith({
      ".github/skills/release-notes/SKILL.md": skill("release-notes", "Draft release notes."),
      ".claude/skills/tidy-imports/SKILL.md": skill("tidy-imports", "Sort imports."),
      ".github/agents/reviewer.md": `---
name: reviewer
description: Reviews a diff.
tools: ["bash", "view"]
---

You review changes.
`,
      ".claude/agents/scribe.md": `---
description: Writes docs.
---

You write documentation.
`,
    });
    const found = await discoverCatalog(repo);

    expect(found.skills.map((s) => s.name)).toEqual(["release-notes", "tidy-imports"]);
    expect(found.skills.find((s) => s.name === "release-notes")?.description).toBe("Draft release notes.");
    expect(found.skillDirectories).toEqual([
      path.join(repo, ".github/skills"),
      path.join(repo, ".claude/skills"),
    ]);

    expect(found.agents.map((a) => a.name)).toEqual(["reviewer", "scribe"]);
    const reviewer = found.agents.find((a) => a.name === "reviewer");
    expect(reviewer?.tools).toEqual(["bash", "view"]);
    expect(reviewer?.prompt).toBe("You review changes.");
    // The name falls back to the filename when the front matter omits it.
    expect(found.agents.find((a) => a.name === "scribe")?.source).toBe("claude");
    expect(found.problems).toEqual([]);
  });

  it("returns an empty catalog for a repository with neither folder", async () => {
    const found = await discoverCatalog(await repoWith({ "README.md": "nothing here" }));
    expect(found).toEqual({ skillDirectories: [], skills: [], agents: [], problems: [] });
  });

  it("lets the github copy win when a name appears in both layouts", async () => {
    const repo = await repoWith({
      ".github/agents/dup.md": "---\nname: dup\n---\n\nfrom github.\n",
      ".claude/agents/dup.md": "---\nname: dup\n---\n\nfrom claude.\n",
    });
    const found = await discoverCatalog(repo);
    expect(found.agents).toHaveLength(1);
    expect(found.agents[0]?.source).toBe("github");
    expect(found.agents[0]?.prompt).toBe("from github.");
  });

  it("skips an agent with no prompt instead of registering an empty one", async () => {
    const repo = await repoWith({ ".github/agents/hollow.md": "---\nname: hollow\n---\n" });
    const found = await discoverCatalog(repo);
    expect(found.agents).toEqual([]);
    expect(found.problems[0]).toContain("no prompt body");
  });
});

describe("parseFrontMatter", () => {
  it("reads scalars and inline lists, and leaves the body alone", () => {
    const { data, body } = parseFrontMatter(`---
name: thing
tools: ["a", "b"]
description: 'quoted: with a colon'
---

body text
`);
    expect(data.name).toBe("thing");
    expect(data.tools).toEqual(["a", "b"]);
    expect(data.description).toBe("quoted: with a colon");
    expect(body.trim()).toBe("body text");
  });

  it("treats a file with no front matter as all body", () => {
    const { data, body } = parseFrontMatter("just a prompt\n");
    expect(data).toEqual({});
    expect(body).toBe("just a prompt\n");
  });
});

describe("prompt parsing", () => {
  it("splits a leading slash command from its arguments", () => {
    expect(parseCommand("/release-notes since v1.2.0")).toEqual({ name: "release-notes", args: "since v1.2.0" });
    expect(parseCommand("/plan")).toEqual({ name: "plan", args: "" });
    expect(parseCommand("not a command")).toBeNull();
    // A bare slash is not a command. A path still parses, which is why the
    // room only treats a name it knows as a command.
    expect(parseCommand("/ leading space")).toBeNull();
    expect(parseCommand("/usr/bin is a path")).toEqual({ name: "usr", args: "/bin is a path" });
  });

  it("strips a leading agent mention from the prompt text", () => {
    expect(splitAgentMention("@reviewer look at the diff")).toEqual({ agent: "reviewer", text: "look at the diff" });
    expect(splitAgentMention("no mention here")).toEqual({ text: "no mention here" });
    // A mention with nothing after it is not routing, it is just text.
    expect(splitAgentMention("@reviewer")).toEqual({ text: "@reviewer" });
    expect(splitAgentMention("mid @reviewer sentence")).toEqual({ text: "mid @reviewer sentence" });
  });
});
