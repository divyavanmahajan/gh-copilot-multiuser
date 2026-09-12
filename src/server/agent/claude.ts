/**
 * Claude Agent SDK backend (experimental).
 *
 * Drives one long-lived `query()` in streaming input mode: the room pushes
 * user messages into a channel, the SDK yields messages back, a `result`
 * message ends each turn, and `canUseTool` routes approvals to the room.
 *
 * The SDK is an optional peer dependency and is imported lazily, so a
 * Copilot-only install never loads it. See docs/CLAUDE-AGENT-SDK.md for the
 * exploration behind this file and the known gaps (permission request
 * shape, AskUserQuestion).
 */
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest, PermissionRequestResult } from "@github/copilot-sdk";
import type { AgentEvent } from "../../protocol/messages.js";
import type { Agent, AgentCallbacks, AgentFactory } from "./agent.js";

export interface ClaudeAgentConfig {
  repo: string;
  model?: string;
  sessionId?: string;
  /** Anthropic API key for the runtime. Unset means the process environment decides. */
  apiKey?: string;
  /** Hard per-session spend cap, surfaced by the SDK as an error result. */
  maxBudgetUsd?: number;
}

export type ClaudeAgentOptions = ClaudeAgentConfig & AgentCallbacks;

export function claudeAgentFactory(config: ClaudeAgentConfig): AgentFactory {
  return (callbacks) => new ClaudeAgent({ ...config, ...callbacks });
}

const ROOM_SYSTEM_MESSAGE = `You are working inside a shared room. Several developers are collaborating with you on the same repository and the same conversation. Each user message is prefixed with the author's name in square brackets, for example "[alice]:". Address people by name when it helps, keep track of who asked for what, and if two requests conflict, say so rather than silently picking one. Ask clarifying questions in plain prose rather than with structured question tools.`;

/** Push-based async iterable: the SDK reads from it, the room writes to it. */
class Channel<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    this.closed = true;
    this.waiter?.({ value: undefined as never, done: true });
    this.waiter = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => (this.waiter = resolve));
      },
    };
  }
}

export class ClaudeAgent implements Agent {
  private query: Query | null = null;
  private readonly input = new Channel<SDKUserMessage>();
  private pump: Promise<void> = Promise.resolve();
  private id: string;
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly opts: ClaudeAgentOptions) {
    this.id = opts.sessionId ?? "pending";
  }

  get sessionId(): string {
    return this.id;
  }

  async start(): Promise<void> {
    let sdk: typeof import("@anthropic-ai/claude-agent-sdk");
    try {
      sdk = await import("@anthropic-ai/claude-agent-sdk");
    } catch {
      throw new Error("Claude backend selected but @anthropic-ai/claude-agent-sdk is not installed; run: npm install @anthropic-ai/claude-agent-sdk");
    }

    const options: Options = {
      cwd: this.opts.repo,
      model: this.opts.model,
      resume: this.opts.sessionId,
      includePartialMessages: true,
      permissionMode: "default",
      canUseTool: this.canUseTool,
      systemPrompt: { type: "preset", preset: "claude_code", append: ROOM_SYSTEM_MESSAGE },
      maxBudgetUsd: this.opts.maxBudgetUsd,
      env: { ...(process.env as Record<string, string>), ...(this.opts.apiKey ? { ANTHROPIC_API_KEY: this.opts.apiKey } : {}) },
    };

    this.query = sdk.query({ prompt: this.input, options });

    // Resolve once the runtime announced itself; the session id lives on that message.
    const ready = new Promise<void>((resolve) => {
      this.onInit = resolve;
    });
    const q = this.query;
    this.pump = (async () => {
      try {
        for await (const message of q) this.dispatch(message);
      } catch (err) {
        this.opts.onError(`claude runtime stopped: ${String(err)}`);
      } finally {
        this.onInit?.();
      }
    })();
    await ready;
  }

  private onInit: (() => void) | null = null;

  private dispatch(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      this.id = message.session_id;
      this.onInit?.();
      this.onInit = null;
    }
    const mapped = mapClaudeMessage(message, this.toolNames);
    for (const event of mapped.events) this.opts.onEvent(event);
    if (mapped.turnEnded) this.opts.onIdle();
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, { suggestions }) => {
    if (toolName === "AskUserQuestion") {
      return { behavior: "deny", message: "This room cannot answer structured questions yet. Ask in plain prose and the team will reply." };
    }
    const request = toRoomPermissionRequest(toolName, input);
    const result = await this.opts.onPermissionRequest(request, { sessionId: this.id });
    return fromRoomDecision(result as PermissionRequestResult, input, suggestions ?? []);
  };

  async send(authorLogin: string, text: string): Promise<string> {
    if (!this.query) throw new Error("agent not started");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.input.push({
      type: "user",
      message: { role: "user", content: `[${authorLogin}]: ${text}` },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
    return id;
  }

  async abort(): Promise<void> {
    await this.query?.interrupt();
  }

  async history(): Promise<AgentEvent[]> {
    if (this.id === "pending") return [];
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const messages = await sdk.getSessionMessages(this.id);
    const names = new Map<string, string>();
    const out: AgentEvent[] = [];
    for (const m of messages) {
      const mapped = mapClaudeMessage({ ...(m as unknown as SDKMessage) }, names);
      out.push(...mapped.events);
    }
    return out;
  }

  async stop(): Promise<void> {
    this.input.close();
    this.query?.close();
    await this.pump;
  }
}

// ---------------------------------------------------------------------------
// Pure mapping, unit tested without the SDK.
// ---------------------------------------------------------------------------

export interface Mapped {
  events: AgentEvent[];
  turnEnded: boolean;
}

/**
 * Translate one SDK message into the room's agent events (which reuse the
 * Copilot event vocabulary so the browser needs no change). `toolNames`
 * carries tool_use id -> name across messages so completions can be labelled.
 */
export function mapClaudeMessage(message: SDKMessage, toolNames: Map<string, string>): Mapped {
  const at = new Date().toISOString();
  const ev = (type: string, data: unknown): AgentEvent => ({ type, id: `${type}-${Math.random().toString(36).slice(2, 10)}`, timestamp: at, data });
  const events: AgentEvent[] = [];

  switch (message.type) {
    case "stream_event": {
      const e = message.event as { type: string; delta?: { type: string; text?: string; thinking?: string }; index?: number };
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        events.push(ev("assistant.message_delta", { deltaContent: e.delta.text ?? "", messageId: message.uuid }));
      } else if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta") {
        events.push(ev("assistant.reasoning_delta", { deltaContent: e.delta.thinking ?? "", messageId: message.uuid }));
      }
      break;
    }
    case "assistant": {
      const blocks = (message.message?.content ?? []) as unknown as Array<Record<string, unknown>>;
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
          events.push(ev("assistant.message", { content: b.text, messageId: message.message.id }));
        } else if (b.type === "tool_use") {
          const id = String(b.id);
          const name = String(b.name);
          toolNames.set(id, name);
          events.push(ev("tool.execution_start", { toolCallId: id, toolName: name, arguments: b.input }));
        }
      }
      if (message.error) events.push(ev("session.error", { message: message.error, errorType: message.error }));
      break;
    }
    case "user": {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const b of content as unknown as Array<Record<string, unknown>>) {
          if (b.type === "tool_result") {
            const id = String(b.tool_use_id);
            events.push(ev("tool.execution_complete", { toolCallId: id, toolName: toolNames.get(id), success: b.is_error !== true }));
          }
        }
      }
      break;
    }
    case "tool_progress":
      events.push(ev("tool.execution_progress", { toolCallId: message.tool_use_id, toolName: message.tool_name }));
      break;
    case "result": {
      if (message.is_error) {
        const text = "result" in message ? String(message.result) : message.subtype;
        events.push(ev("session.error", { message: text, errorType: message.subtype }));
      }
      return { events, turnEnded: true };
    }
    case "system":
      if (message.subtype === "compact_boundary") events.push(ev("session.compaction_complete", {}));
      break;
    default:
      break;
  }
  return { events, turnEnded: false };
}

/** Shape a Claude tool call like the Copilot permission requests the UI already renders. */
export function toRoomPermissionRequest(toolName: string, input: Record<string, unknown>): PermissionRequest {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  let request: Record<string, unknown>;
  switch (toolName) {
    case "Bash":
      request = { kind: "shell", fullCommandText: s("command") ?? "", intention: s("description") ?? "", commands: [], possiblePaths: [], possibleUrls: [], hasWriteFileRedirection: false, canOfferSessionApproval: true };
      break;
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const diff = s("old_string") !== undefined ? `- ${s("old_string")}\n+ ${s("new_string") ?? ""}` : (s("content") ?? "");
      request = { kind: "write", fileName: s("file_path") ?? s("notebook_path") ?? "", diff, intention: `${toolName} ${s("file_path") ?? ""}`, canOfferSessionApproval: true };
      break;
    }
    case "Read":
      request = { kind: "read", path: s("file_path") ?? "", intention: "read a file" };
      break;
    case "WebFetch":
    case "WebSearch":
      request = { kind: "url", url: s("url") ?? s("query") ?? "", intention: toolName };
      break;
    default: {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(toolName);
      request = mcp
        ? { kind: "mcp", serverName: mcp[1], toolName: mcp[2], intention: JSON.stringify(input).slice(0, 400) }
        : { kind: "custom-tool", toolName, intention: JSON.stringify(input).slice(0, 400) };
    }
  }
  return request as unknown as PermissionRequest;
}

/** Map the room's decision back into the SDK's PermissionResult. */
export function fromRoomDecision(
  result: PermissionRequestResult,
  input: Record<string, unknown>,
  suggestions: NonNullable<Parameters<CanUseTool>[2]["suggestions"]>,
): PermissionResult {
  switch (result.kind) {
    case "approve-once":
      return { behavior: "allow", updatedInput: input };
    case "approve-for-session":
    case "approve-for-location":
    case "approve-permanently":
      return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions.filter((s) => s.destination === "session") };
    default:
      return { behavior: "deny", message: "A person in the room declined this action." };
  }
}
