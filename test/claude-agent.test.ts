import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fromRoomDecision, mapClaudeMessage, toRoomPermissionRequest } from "../src/server/agent/claude.js";

const base = { uuid: "u1", session_id: "s1", parent_tool_use_id: null } as const;

describe("mapClaudeMessage", () => {
  it("turns text deltas into assistant.message_delta and a result into idle", () => {
    const names = new Map<string, string>();
    const delta = mapClaudeMessage(
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi " } }, ...base } as unknown as SDKMessage,
      names,
    );
    expect(delta.events.map((e) => e.type)).toEqual(["assistant.message_delta"]);
    expect((delta.events[0]!.data as { deltaContent: string }).deltaContent).toBe("Hi ");
    expect(delta.turnEnded).toBe(false);

    const result = mapClaudeMessage(
      { type: "result", subtype: "success", is_error: false, result: "done", num_turns: 1, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0.01, usage: {}, ...base } as unknown as SDKMessage,
      names,
    );
    expect(result.turnEnded).toBe(true);
    expect(result.events).toEqual([]);
  });

  it("pairs tool_use blocks with tool_result blocks by id", () => {
    const names = new Map<string, string>();
    const start = mapClaudeMessage(
      {
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }] },
        ...base,
      } as unknown as SDKMessage,
      names,
    );
    expect(start.events[0]).toMatchObject({ type: "tool.execution_start", data: { toolCallId: "tu1", toolName: "Bash", arguments: { command: "npm test" } } });

    const done = mapClaudeMessage(
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok", is_error: false }] }, ...base } as unknown as SDKMessage,
      names,
    );
    expect(done.events[0]).toMatchObject({ type: "tool.execution_complete", data: { toolCallId: "tu1", toolName: "Bash", success: true } });
  });

  it("reports an error result as session.error and still ends the turn", () => {
    const m = mapClaudeMessage(
      { type: "result", subtype: "error_max_budget_usd", is_error: true, num_turns: 3, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 5, usage: {}, errors: ["budget"], ...base } as unknown as SDKMessage,
      new Map(),
    );
    expect(m.turnEnded).toBe(true);
    expect(m.events[0]).toMatchObject({ type: "session.error", data: { errorType: "error_max_budget_usd" } });
  });

  it("ignores our own echoed prompts", () => {
    const m = mapClaudeMessage({ type: "user", message: { role: "user", content: "[alice]: hello" }, ...base } as unknown as SDKMessage, new Map());
    expect(m.events).toEqual([]);
  });
});

describe("permission bridging", () => {
  it("shapes Claude tool calls like the requests the approval card renders", () => {
    expect(toRoomPermissionRequest("Bash", { command: "rm -rf build", description: "clean" })).toMatchObject({ kind: "shell", fullCommandText: "rm -rf build", intention: "clean" });
    expect(toRoomPermissionRequest("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" })).toMatchObject({ kind: "write", fileName: "a.ts", diff: "- x\n+ y" });
    expect(toRoomPermissionRequest("WebFetch", { url: "https://example.com" })).toMatchObject({ kind: "url", url: "https://example.com" });
    expect(toRoomPermissionRequest("mcp__github__get_issue", { number: 1 })).toMatchObject({ kind: "mcp", serverName: "github", toolName: "get_issue" });
    expect(toRoomPermissionRequest("Agent", { prompt: "x" })).toMatchObject({ kind: "custom-tool", toolName: "Agent" });
  });

  it("maps the room's decision to the SDK result", () => {
    const input = { command: "ls" };
    const suggestions = [
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" },
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "localSettings" },
    ] as unknown as Parameters<typeof fromRoomDecision>[2];
    expect(fromRoomDecision({ kind: "approve-once" }, input, suggestions)).toEqual({ behavior: "allow", updatedInput: input });
    const session = fromRoomDecision({ kind: "approve-for-session" }, input, suggestions);
    expect(session).toMatchObject({ behavior: "allow" });
    expect((session as { updatedPermissions: unknown[] }).updatedPermissions).toHaveLength(1);
    expect(fromRoomDecision({ kind: "reject" }, input, suggestions)).toMatchObject({ behavior: "deny" });
  });
});
