/**
 * Strict prompt queue.
 *
 * The Copilot SDK does not lock sessions, so the room owns the only handle
 * and this queue guarantees that exactly one prompt is in flight. Pure state
 * machine: no I/O, no timers, fully unit-testable.
 */
import { randomUUID } from "node:crypto";
import type { QueuedPrompt } from "../../protocol/messages.js";

export type QueueState = "idle" | "running";

export interface QueueSnapshot {
  state: QueueState;
  current: QueuedPrompt | null;
  queue: QueuedPrompt[];
}

export class PromptQueue {
  private state: QueueState = "idle";
  private current: QueuedPrompt | null = null;
  private readonly pending: QueuedPrompt[] = [];

  snapshot(): QueueSnapshot {
    return { state: this.state, current: this.current, queue: [...this.pending] };
  }

  /** Append a prompt. Returns the queued record (with id and timestamp). */
  submit(input: { authorId: string; authorLogin: string; text: string; agent?: string }): QueuedPrompt {
    const prompt: QueuedPrompt = {
      id: randomUUID(),
      authorId: input.authorId,
      authorLogin: input.authorLogin,
      text: input.text,
      submittedAt: new Date().toISOString(),
      ...(input.agent ? { agent: input.agent } : {}),
    };
    this.pending.push(prompt);
    return prompt;
  }

  /**
   * Remove a pending prompt. `canWithdrawOthers` lets the host pull anyone's
   * prompt; otherwise only the author may withdraw. Returns false if nothing
   * was removed (unknown id, wrong author, or already running).
   */
  withdraw(promptId: string, byUserId: string, canWithdrawOthers = false): boolean {
    const idx = this.pending.findIndex((p) => p.id === promptId);
    if (idx === -1) return false;
    const prompt = this.pending[idx]!;
    if (prompt.authorId !== byUserId && !canWithdrawOthers) return false;
    this.pending.splice(idx, 1);
    return true;
  }

  /** Move the head of the queue into the running slot. Null if idle or empty. */
  startNext(): QueuedPrompt | null {
    if (this.state === "running" || this.pending.length === 0) return null;
    this.current = this.pending.shift()!;
    this.state = "running";
    return this.current;
  }

  /** Mark the running prompt finished. Returns it, or null if nothing ran. */
  finish(): QueuedPrompt | null {
    if (this.state !== "running") return null;
    const done = this.current;
    this.current = null;
    this.state = "idle";
    return done;
  }

  get isRunning(): boolean {
    return this.state === "running";
  }

  get length(): number {
    return this.pending.length;
  }
}
