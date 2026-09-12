import { describe, expect, it } from "vitest";
import { itemsFor, localCommand, pickerFor } from "../src/web/components/CommandPicker.js";
import type { Catalog } from "../src/protocol/messages.js";

const catalog: Catalog = {
  skills: [
    { name: "release-notes", description: "Draft release notes.", kind: "skill" },
    { name: "tidy-imports", description: "Sort imports.", kind: "skill" },
    { name: "compact", description: "Compact the session.", kind: "builtin" },
    // The runtime ships a /skills of its own, which collides with the room's.
    { name: "skills", description: "Runtime skill listing.", kind: "builtin" },
  ],
  agents: [
    { name: "reviewer", description: "Reviews a diff.", tools: ["bash", "view"] },
    { name: "scribe", description: "Writes docs." },
  ],
};

describe("pickerFor", () => {
  it("opens on a lone trigger and narrows as you type", () => {
    expect(pickerFor("/")).toEqual({ kind: "/", query: "" });
    expect(pickerFor("/rel")).toEqual({ kind: "/", query: "rel" });
    expect(pickerFor("@rev")).toEqual({ kind: "@", query: "rev" });
  });

  it("stays shut once the prompt is past its first token", () => {
    // A space means the name is settled and arguments have begun.
    expect(pickerFor("/release-notes ")).toBeNull();
    expect(pickerFor("@reviewer look at this")).toBeNull();
    // Mid-sentence a slash is a path and an at-sign is a person.
    expect(pickerFor("see src/web/App.tsx")).toBeNull();
    expect(pickerFor("ask @reviewer about it")).toBeNull();
    expect(pickerFor("")).toBeNull();
  });
});

describe("itemsFor", () => {
  it("offers the room's own commands alongside the repository's skills", () => {
    const items = itemsFor({ kind: "/", query: "" }, catalog).map((i) => i.name);
    expect(items).toContain("skills");
    expect(items).toContain("agents");
    expect(items).toContain("refresh");
    expect(items).toContain("release-notes");
    expect(items).toContain("compact");
  });

  it("shows the room's /skills once, not alongside the runtime's", () => {
    const skills = itemsFor({ kind: "/", query: "skills" }, catalog);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.note).toBe("room");
  });

  it("filters by prefix", () => {
    expect(itemsFor({ kind: "/", query: "rel" }, catalog).map((i) => i.name)).toEqual(["release-notes"]);
    expect(itemsFor({ kind: "/", query: "zzz" }, catalog)).toEqual([]);
  });

  it("labels where a skill came from and how big an agent is", () => {
    const skill = itemsFor({ kind: "/", query: "release" }, catalog)[0];
    expect(skill?.note).toBe("skill");
    const builtin = itemsFor({ kind: "/", query: "compact" }, catalog)[0];
    expect(builtin?.note).toBe("builtin");
    const reviewer = itemsFor({ kind: "@", query: "rev" }, catalog)[0];
    expect(reviewer?.note).toBe("2 tools");
    expect(itemsFor({ kind: "@", query: "scr" }, catalog)[0]?.note).toBeUndefined();
  });

  it("offers only agents behind @, never skills", () => {
    expect(itemsFor({ kind: "@", query: "" }, catalog).map((i) => i.name)).toEqual(["reviewer", "scribe"]);
  });
});

describe("localCommand", () => {
  it("claims the three the browser answers itself", () => {
    expect(localCommand("/skills")).toBe("skills");
    expect(localCommand("/agents")).toBe("agents");
    expect(localCommand("/refresh")).toBe("refresh");
  });

  it("leaves everything else to the agent", () => {
    expect(localCommand("/release-notes")).toBeNull();
    // With arguments it is no longer the bare listing command.
    expect(localCommand("/skills please")).toBeNull();
    expect(localCommand("skills")).toBeNull();
  });
});
