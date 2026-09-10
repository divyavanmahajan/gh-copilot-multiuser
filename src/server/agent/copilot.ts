/**
 * Thin wrapper around the Copilot SDK.
 *
 * Owns the single CopilotClient and the single CopilotSession the room uses.
 * Everything the room needs from the agent goes through this class so the
 * rest of the server never imports the SDK directly.
 */
import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotSession, PermissionHandler, SessionEvent } from "@github/copilot-sdk";
import type { AgentEvent } from "../../protocol/messages.js";

export interface AgentOptions {
  repo: string;
  model?: string;
  sessionId?: string;
  /** Token for the Copilot runtime. Unset uses the host's CLI login. */
  gitHubToken?: string;
  /** Directory for the runtime's own state (COPILOT_HOME). */
  stateDir?: string;
  onPermissionRequest: PermissionHandler;
  onEvent: (event: AgentEvent) => void;
  onIdle: () => void;
  onError: (message: string) => void;
}

/**
 * Session events forwarded to browsers. Anything not listed stays server-side.
 * Extend deliberately: some events carry large payloads or host paths.
 */
const FORWARDED_EVENTS = new Set<string>([
  "user.message",
  "assistant.turn_start",
  "assistant.message_start",
  "assistant.message_delta",
  "assistant.message",
  "assistant.reasoning_delta",
  "assistant.turn_end",
  "tool.execution_start",
  "tool.execution_progress",
  "tool.execution_complete",
  "session.error",
  "session.warning",
  "session.compaction_start",
  "session.compaction_complete",
  "session.model_change",
  "session.title_changed",
]);

const ROOM_SYSTEM_MESSAGE = `You are working inside a shared room. Several developers are collaborating with you on the same repository and the same conversation. Each user message is prefixed with the author's name in square brackets, for example "[alice]:". Address people by name when it helps, keep track of who asked for what, and if two requests conflict, say so rather than silently picking one.`;

export class CopilotAgent {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: AgentOptions) {}

  get sessionId(): string {
    if (!this.session) throw new Error("agent not started");
    return this.session.sessionId;
  }

  async start(): Promise<void> {
    this.client = new CopilotClient({
      workingDirectory: this.opts.repo,
      ...(this.opts.gitHubToken ? { gitHubToken: this.opts.gitHubToken } : {}),
      ...(this.opts.stateDir ? { baseDirectory: this.opts.stateDir } : {}),
      logLevel: "warning",
    });
    await this.client.start();

    const common = {
      model: this.opts.model,
      streaming: true,
      workingDirectory: this.opts.repo,
      onPermissionRequest: this.opts.onPermissionRequest,
      systemMessage: { mode: "append" as const, content: ROOM_SYSTEM_MESSAGE },
    };

    if (this.opts.sessionId) {
      try {
        this.session = await this.client.resumeSession(this.opts.sessionId, common);
      } catch (err) {
        this.opts.onError(`could not resume session ${this.opts.sessionId}, creating a new one: ${String(err)}`);
      }
    }
    if (!this.session) {
      this.session = await this.client.createSession({ ...common, sessionId: this.opts.sessionId });
    }

    this.unsubscribe = this.session.on((event: SessionEvent) => this.dispatch(event));
  }

  private dispatch(event: SessionEvent): void {
    if (event.type === "session.idle") {
      this.opts.onIdle();
      return;
    }
    if (FORWARDED_EVENTS.has(event.type)) {
      this.opts.onEvent({ type: event.type, id: event.id, timestamp: event.timestamp, data: event.data });
    }
  }

  /**
   * Send one prompt. Resolves when the runtime accepted it, not when the turn
   * ends; completion arrives through onIdle.
   */
  async send(authorLogin: string, text: string): Promise<string> {
    if (!this.session) throw new Error("agent not started");
    return this.session.send({ prompt: `[${authorLogin}]: ${text}` });
  }

  async abort(): Promise<void> {
    await this.session?.abort();
  }

  /** Full persisted event log, used to replay history to late joiners. */
  async history(): Promise<AgentEvent[]> {
    if (!this.session) return [];
    const events = await this.session.getEvents();
    return events
      .filter((e) => FORWARDED_EVENTS.has(e.type))
      .map((e) => ({ type: e.type, id: e.id, timestamp: e.timestamp, data: e.data }));
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    await this.session?.disconnect();
    await this.client?.stop();
  }
}
