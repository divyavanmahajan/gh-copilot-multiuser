import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Admissions, parseAllowList, resolveRole } from "../src/server/auth/admissions.js";
import { EntraProvider } from "../src/server/auth/entra.js";

const alice = { id: "github:1", provider: "github" as const, login: "alice" };

async function fresh(allow = "") {
  const a = new Admissions(await mkdtemp(path.join(tmpdir(), "adm-")), parseAllowList(allow));
  await a.load();
  return a;
}

describe("resolveRole", () => {
  it("hosts win, then the automatic gate", async () => {
    const admissions = await fresh();
    expect(resolveRole({ identity: alice, hosts: ["Alice"], gate: false, policy: "off", admissions })).toBe("host");
    expect(resolveRole({ identity: alice, hosts: [], gate: true, policy: "off", admissions })).toBe("member");
  });

  it("applies the public policy to people outside the gate", async () => {
    const admissions = await fresh();
    const base = { identity: alice, hosts: [], gate: false as const, admissions };
    expect(resolveRole({ ...base, policy: "off" })).toBeNull();
    expect(resolveRole({ ...base, policy: "approve" })).toBe("pending");
    expect(resolveRole({ ...base, policy: "viewer" })).toBe("viewer");
    expect(resolveRole({ ...base, policy: "member" })).toBe("member");
  });

  it("honours a stored decision over the policy, and persists it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "adm-"));
    const a = new Admissions(dir);
    await a.load();
    await a.record(alice, "viewer", "bob");
    expect(resolveRole({ identity: alice, hosts: [], gate: null, policy: "approve", admissions: a })).toBe("viewer");

    const reloaded = new Admissions(dir);
    await reloaded.load();
    expect(resolveRole({ identity: alice, hosts: [], gate: null, policy: "off", admissions: reloaded })).toBe("viewer");

    await reloaded.record(alice, "reject", "bob");
    expect(resolveRole({ identity: alice, hosts: [], gate: null, policy: "member", admissions: reloaded })).toBeNull();
  });

  it("admits people on the allow list by provider and login", async () => {
    const admissions = await fresh("github:ALICE:viewer, entra:carol@corp.com");
    expect(resolveRole({ identity: alice, hosts: [], gate: null, policy: "off", admissions })).toBe("viewer");
    const carol = { id: "entra:9", provider: "entra" as const, login: "carol@corp.com" };
    expect(resolveRole({ identity: carol, hosts: [], gate: null, policy: "off", admissions })).toBe("member");
    expect(() => parseAllowList("nope")).toThrow(/expected provider:login/);
    expect(() => parseAllowList("github:x:king")).toThrow(/bad role/);
  });
});

describe("EntraProvider.identityFromClaims", () => {
  async function provider(overrides: Partial<ConstructorParameters<typeof EntraProvider>[0]> = {}) {
    return new EntraProvider({
      tenantId: "t",
      clientId: "c",
      admission: () => "member",
      publicUrl: "http://localhost",
      hosts: ["boss@corp.com"],
      admissions: await fresh(),
      secureCookies: false,
      ...overrides,
    });
  }

  it("maps claims to an identity and resolves the role", async () => {
    const p = await provider();
    const id = p.identityFromClaims({ oid: "o1", preferred_username: "dave@corp.com", name: "Dave" });
    expect(id).toMatchObject({ id: "entra:o1", provider: "entra", login: "dave@corp.com", displayName: "Dave", role: "member" });
    expect(p.identityFromClaims({ oid: "o2", preferred_username: "Boss@corp.com" })).toMatchObject({ role: "host" });
    expect(p.identityFromClaims({ preferred_username: "nobody" })).toBe("invalid");
  });

  it("gates on group membership when a group is configured", async () => {
    const p = await provider({ group: "g-1", admission: () => "approve" });
    expect(p.identityFromClaims({ oid: "o3", upn: "in@corp.com", groups: ["g-1"] })).toMatchObject({ role: "member" });
    expect(p.identityFromClaims({ oid: "o4", upn: "out@corp.com", groups: [] })).toMatchObject({ role: "pending" });
    const strict = await provider({ group: "g-1", admission: () => "off" });
    expect(strict.identityFromClaims({ oid: "o4", upn: "out@corp.com" })).toBe("forbidden");
  });
});
