import { describe, expect, it } from "vitest";
import { PromptQueue } from "../src/server/agent/queue.js";

describe("PromptQueue", () => {
  it("runs one prompt at a time in submission order", () => {
    const q = new PromptQueue();
    const a = q.submit({ authorId: "u1", authorLogin: "alice", text: "first" });
    const b = q.submit({ authorId: "u2", authorLogin: "bob", text: "second" });

    expect(q.startNext()?.id).toBe(a.id);
    expect(q.isRunning).toBe(true);
    // Second call while running must not start anything.
    expect(q.startNext()).toBeNull();

    expect(q.finish()?.id).toBe(a.id);
    expect(q.startNext()?.id).toBe(b.id);
    expect(q.finish()?.id).toBe(b.id);
    expect(q.startNext()).toBeNull();
    expect(q.snapshot()).toEqual({ state: "idle", current: null, queue: [] });
  });

  it("lets authors withdraw their own pending prompt only", () => {
    const q = new PromptQueue();
    const a = q.submit({ authorId: "u1", authorLogin: "alice", text: "x" });
    expect(q.withdraw(a.id, "u2")).toBe(false);
    expect(q.withdraw(a.id, "u2", true)).toBe(true); // host override
    expect(q.length).toBe(0);
  });

  it("does not withdraw a running prompt", () => {
    const q = new PromptQueue();
    const a = q.submit({ authorId: "u1", authorLogin: "alice", text: "x" });
    q.startNext();
    expect(q.withdraw(a.id, "u1", true)).toBe(false);
    expect(q.finish()?.id).toBe(a.id);
  });

  it("finish is a no-op when idle", () => {
    expect(new PromptQueue().finish()).toBeNull();
  });
});
