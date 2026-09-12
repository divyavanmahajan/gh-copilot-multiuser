import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/server/settings.js";

describe("SettingsStore", () => {
  it("defaults every sign-in type to host approval", async () => {
    const s = new SettingsStore(await mkdtemp(path.join(tmpdir(), "settings-")));
    expect(await s.load()).toEqual({ admission: { github: "approve", entra: "approve", guest: "approve" } });
  });

  it("lets the command line seed values, and a saved change win over the seed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "settings-"));
    const seeded = new SettingsStore(dir, { admission: { github: "member", guest: undefined } });
    expect((await seeded.load()).admission).toEqual({ github: "member", entra: "approve", guest: "approve" });

    const changed: string[] = [];
    seeded.onChange((v) => changed.push(v.admission.github));
    await seeded.update({ admission: { github: "viewer" } });
    expect(seeded.policy("github")()).toBe("viewer");
    expect(changed).toEqual(["viewer"]);
    expect(JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"))).toEqual({
      admission: { github: "viewer", entra: "approve", guest: "approve" },
    });

    // Same seed on the next start, but the saved value wins.
    const restarted = new SettingsStore(dir, { admission: { github: "member" } });
    expect((await restarted.load()).admission.github).toBe("viewer");
  });

  it("ignores a corrupt settings file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "settings-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "settings.json"), "{not json");
    const s = new SettingsStore(dir);
    expect((await s.load()).admission.entra).toBe("approve");
  });
});
