/**
 * What the room needs from an agent. CopilotAgent is the real one; tests
 * inject a fake so the queue, permissions, transport and UI contract can be
 * exercised without a Copilot login.
 */
import type { PermissionHandler } from "@github/copilot-sdk";
import type { AgentEvent } from "../../protocol/messages.js";

export interface AgentCallbacks {
  onPermissionRequest: PermissionHandler;
  onEvent: (event: AgentEvent) => void;
  onIdle: () => void;
  onError: (message: string) => void;
}

export interface Agent {
  readonly sessionId: string;
  start(): Promise<void>;
  /** Resolves once the runtime accepted the prompt; the turn ends via onIdle. */
  send(authorLogin: string, text: string): Promise<string>;
  abort(): Promise<void>;
  /** Persisted event log for replay to late joiners. */
  history(): Promise<AgentEvent[]>;
  stop(): Promise<void>;
}

export type AgentFactory = (callbacks: AgentCallbacks) => Agent;
