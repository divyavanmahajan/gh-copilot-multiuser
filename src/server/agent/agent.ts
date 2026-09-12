/**
 * What the room needs from an agent. CopilotAgent is the real one; tests
 * inject a fake so the queue, permissions, transport and UI contract can be
 * exercised without a Copilot login.
 */
import type { PermissionHandler } from "@github/copilot-sdk";
import type { AgentEvent, Catalog } from "../../protocol/messages.js";

export interface AgentCallbacks {
  onPermissionRequest: PermissionHandler;
  onEvent: (event: AgentEvent) => void;
  onIdle: () => void;
  onError: (message: string) => void;
}

export interface Agent {
  readonly sessionId: string;
  start(): Promise<void>;
  /**
   * Resolves once the runtime accepted the prompt; the turn ends via onIdle.
   * `agentName` routes this one prompt to a custom agent and is restored
   * afterwards, so one person's choice does not reconfigure the room.
   */
  send(authorLogin: string, text: string, agentName?: string): Promise<string>;
  /** Skills and custom agents currently loaded, for the / and @ pickers. */
  catalog(): Promise<Catalog>;
  /** Re-scan the repository and reload what the runtime holds. */
  refreshCatalog(): Promise<Catalog>;
  /** Run a slash command, which either yields a prompt to send or its own output. */
  runCommand(name: string, args: string): Promise<CommandOutcome>;
  abort(): Promise<void>;
  /** Persisted event log for replay to late joiners. */
  history(): Promise<AgentEvent[]>;
  stop(): Promise<void>;
}

/**
 * What a slash command produced. "prompt" is the usual case for a skill: the
 * runtime expands it into prompt text that the room then runs as a turn, so it
 * lands in the transcript with its author like any other prompt. "text" is a
 * command that answered by itself and has nothing to run.
 */
export type CommandOutcome =
  | { kind: "prompt"; text: string; display: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

export type AgentFactory = (callbacks: AgentCallbacks) => Agent;
