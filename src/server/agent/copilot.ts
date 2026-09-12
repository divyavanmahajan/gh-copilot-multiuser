/**
 * Thin wrapper around the Copilot SDK.
 *
 * Owns the single CopilotClient and the single CopilotSession the room uses.
 * Everything the room needs from the agent goes through this class so the
 * rest of the server never imports the SDK directly.
 */
import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotSession, CustomAgentConfig, SessionEvent } from "@github/copilot-sdk";
import type { AgentEvent, Catalog } from "../../protocol/messages.js";
import type { Agent, AgentCallbacks, AgentFactory, CommandOutcome } from "./agent.js";
import { discoverCatalog, type DiscoveredCatalog } from "./catalog.js";

export interface CopilotAgentConfig {
  repo: string;
  model?: string;
  sessionId?: string;
  /** Token for the Copilot runtime. Unset uses the host's CLI login. */
  gitHubToken?: string;
  /** Directory for the runtime's own state (COPILOT_HOME). */
  stateDir?: string;
  /** Called once the repository has been scanned, for the startup log. */
  onCatalog?: (found: DiscoveredCatalog) => void;
}

export type AgentOptions = CopilotAgentConfig & AgentCallbacks;

/** Factory the server uses by default. */
export function copilotAgentFactory(config: CopilotAgentConfig): AgentFactory {
  return (callbacks) => new CopilotAgent({ ...config, ...callbacks });
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
  "subagent.started",
  "subagent.completed",
  "session.error",
  "session.warning",
  "session.compaction_start",
  "session.compaction_complete",
  "session.model_change",
  "session.title_changed",
]);

const ROOM_SYSTEM_MESSAGE = `You are working inside a shared room. Several developers are collaborating with you on the same repository and the same conversation. Each user message is prefixed with the author's name in square brackets, for example "[alice]:". Address people by name when it helps, keep track of who asked for what, and if two requests conflict, say so rather than silently picking one.`;

export class CopilotAgent implements Agent {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private found: DiscoveredCatalog = { skillDirectories: [], skills: [], agents: [], problems: [] };
  /** A subagent turn ends on subagent.completed; the runtime sends no idle. */
  private awaitingSubagent = false;

  constructor(private readonly opts: AgentOptions) {}

  get sessionId(): string {
    if (!this.session) throw new Error("agent not started");
    return this.session.sessionId;
  }

  async start(): Promise<void> {
    // The runtime discovers nothing by default, so hand it what the repo ships.
    this.found = await discoverCatalog(this.opts.repo);
    this.opts.onCatalog?.(this.found);

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
      enableSkills: true,
      skillDirectories: this.found.skillDirectories,
      customAgents: this.found.agents.map(
        (a): CustomAgentConfig => ({
          name: a.name,
          ...(a.displayName ? { displayName: a.displayName } : {}),
          ...(a.description ? { description: a.description } : {}),
          ...(a.tools ? { tools: a.tools } : {}),
          ...(a.model ? { model: a.model } : {}),
          prompt: a.prompt,
        }),
      ),
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
      // A subagent turn is not over when the host session goes quiet; the work
      // is happening in the background task, so wait for it to report.
      if (!this.awaitingSubagent) this.opts.onIdle();
      return;
    }
    if (FORWARDED_EVENTS.has(event.type)) {
      this.opts.onEvent({ type: event.type, id: event.id, timestamp: event.timestamp, data: event.data });
    }
    if (event.type === "subagent.completed" && this.awaitingSubagent) {
      this.awaitingSubagent = false;
      this.opts.onIdle();
    }
  }

  /**
   * Send one prompt. Resolves when the runtime accepted it, not when the turn
   * ends; completion arrives through onIdle.
   */
  async send(authorLogin: string, text: string, agentName?: string): Promise<string> {
    const session = this.session;
    if (!session) throw new Error("agent not started");
    const prompt = `[${authorLogin}]: ${text}`;
    if (!agentName) return session.send({ prompt });

    // Dispatch to the custom agent as a subagent task, which keeps the room's
    // own session untouched: one person's @mention cannot change what anyone
    // else's turn runs on.
    //
    // The authored prompt is carried in the task text rather than left to the
    // agent definition. The bundled runtime cannot apply it — a discovered
    // agent fails outright with "Standalone server does not support session
    // effect 'custom_agent_prompt'", and a config-supplied one is accepted but
    // silently answers as the default agent. Since we parsed the prompt out of
    // the .md ourselves, sending it inline makes the agent behave as written.
    const definition = this.found.agents.find((a) => a.name === agentName);
    const task = definition ? `${definition.prompt}

---

${prompt}` : prompt;
    this.awaitingSubagent = true;
    try {
      const started = await session.rpc.tasks.startAgent({
        agentType: agentName,
        name: agentName,
        description: `asked by ${authorLogin}`,
        prompt: task,
      });
      return String((started as { agentId?: string }).agentId ?? agentName);
    } catch (err) {
      this.awaitingSubagent = false;
      throw err;
    }
  }

  /** Skills and custom agents the runtime is actually holding. */
  async catalog(): Promise<Catalog> {
    const session = this.session;
    if (!session) return { skills: [], agents: [] };
    const [skills, agents] = await Promise.all([
      session.rpc.commands
        .list({ includeBuiltins: true, includeSkills: true, includeClientCommands: true })
        .then((r) => (r.commands ?? []).map((c) => ({
          name: c.name,
          ...(c.description ? { description: c.description } : {}),
          kind: String(c.kind ?? "skill"),
          ...(c.input?.hint ? { inputHint: c.input.hint } : {}),
        })))
        .catch((err: unknown) => {
          this.opts.onError(`could not list skills: ${String(err)}`);
          return [];
        }),
      session.rpc.agent
        .list()
        .then((r) => (r.agents ?? []).map((a) => ({
          name: a.name,
          ...(a.displayName ? { displayName: a.displayName } : {}),
          ...(a.description ? { description: a.description } : {}),
          ...(a.tools ? { tools: a.tools } : {}),
        })))
        .catch((err: unknown) => {
          this.opts.onError(`could not list agents: ${String(err)}`);
          return [];
        }),
    ]);
    return { skills, agents };
  }

  /** Re-scan the repository, then ask the runtime to reload what it holds. */
  async refreshCatalog(): Promise<Catalog> {
    this.found = await discoverCatalog(this.opts.repo);
    this.opts.onCatalog?.(this.found);
    try {
      await this.session?.rpc.agent.reload();
    } catch (err) {
      this.opts.onError(`could not reload agents: ${String(err)}`);
    }
    return this.catalog();
  }

  async runCommand(name: string, args: string): Promise<CommandOutcome> {
    const session = this.session;
    if (!session) throw new Error("agent not started");
    const result = await session.rpc.commands.invoke({ name, input: args });
    // A skill expands into prompt text for the agent to run; other commands
    // answer for themselves. Anything else the runtime can do here (dialogs,
    // model switches, subcommand pickers) has no place in a shared room.
    if (result.kind === "agent-prompt") {
      return { kind: "prompt", text: result.prompt, display: result.displayPrompt || `/${name} ${args}`.trim() };
    }
    if (result.kind === "text") return { kind: "text", text: result.text };
    return { kind: "none" };
  }

  async abort(): Promise<void> {
    this.awaitingSubagent = false;
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
