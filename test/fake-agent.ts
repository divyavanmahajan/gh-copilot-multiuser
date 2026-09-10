/**
 * Scripted stand-in for the Copilot runtime. Each prompt produces a short
 * streamed reply; a prompt containing "run" first asks for shell permission.
 */
import type { Agent, AgentCallbacks, AgentFactory } from "../src/server/agent/agent.js";
import type { AgentEvent } from "../src/protocol/messages.js";

export class FakeAgent implements Agent {
  readonly sessionId = "fake-session";
  readonly prompts: string[] = [];
  readonly log: AgentEvent[] = [];
  aborted = 0;
  private turn: Promise<void> = Promise.resolve();

  constructor(private readonly cb: AgentCallbacks) {}

  async start(): Promise<void> {
    queueMicrotask(() => this.cb.onIdle()); // runtime reports idle after start
  }

  async send(authorLogin: string, text: string): Promise<string> {
    const prompt = `[${authorLogin}]: ${text}`;
    this.prompts.push(prompt);
    this.turn = this.runTurn(prompt, text);
    return `msg-${this.prompts.length}`;
  }

  private async runTurn(prompt: string, text: string): Promise<void> {
    await tick();
    this.emit("user.message", { content: prompt });
    if (/\brun\b/.test(text)) {
      const result = await this.cb.onPermissionRequest(
        { kind: "shell", fullCommandText: "npm test", intention: "run the tests" } as never,
        { sessionId: this.sessionId },
      );
      const kind = (result as { kind: string }).kind;
      this.emit("tool.execution_start", { toolCallId: "tc1", toolName: "shell", arguments: { command: "npm test" } });
      this.emit("tool.execution_complete", { toolCallId: "tc1", success: kind !== "reject" });
    }
    for (const word of ["Sure, ", "done."]) {
      await tick();
      this.emit("assistant.message_delta", { messageId: "m1", deltaContent: word });
    }
    this.emit("assistant.message", { messageId: "m1", content: "Sure, done." });
    await tick();
    this.cb.onIdle();
  }

  async abort(): Promise<void> {
    this.aborted++;
  }

  async history(): Promise<AgentEvent[]> {
    return [...this.log];
  }

  async stop(): Promise<void> {
    await this.turn;
  }

  private emit(type: string, data: unknown): void {
    const event: AgentEvent = { type, id: `${type}-${this.log.length}`, timestamp: new Date().toISOString(), data };
    this.log.push(event);
    this.cb.onEvent(event);
  }
}

export function fakeAgentFactory(): AgentFactory & { instance: () => FakeAgent } {
  let inst: FakeAgent | null = null;
  const factory = ((cb: AgentCallbacks) => (inst = new FakeAgent(cb))) as unknown as AgentFactory & { instance: () => FakeAgent };
  factory.instance = () => {
    if (!inst) throw new Error("agent not created yet");
    return inst;
  };
  return factory;
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 2));

/** Wait until `pred` holds or the timeout expires. */
export async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await tick();
  }
}
