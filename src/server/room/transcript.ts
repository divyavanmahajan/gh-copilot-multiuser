/**
 * Append-only JSONL transcript with author attribution.
 *
 * The Copilot runtime persists the conversation itself; this file adds what
 * the runtime does not know: who submitted each prompt, who answered each
 * permission request, and when turns started and ended. It doubles as the
 * audit trail.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TranscriptEntry } from "../../protocol/messages.js";

export class Transcript {
  private readonly file: string;
  private readonly recent: TranscriptEntry[] = [];

  constructor(stateDir: string, private readonly keepInMemory = 2000) {
    this.file = path.join(stateDir, "transcript.jsonl");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    let raw = "";
    try {
      raw = await readFile(this.file, "utf8");
    } catch {
      return; // first run
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = TranscriptEntry.safeParse(JSON.parse(line));
      if (parsed.success) this.push(parsed.data);
    }
  }

  async append(entry: TranscriptEntry): Promise<void> {
    this.push(entry);
    await appendFile(this.file, JSON.stringify(entry) + "\n");
  }

  /** Most recent entries, oldest first. Sent to browsers on join. */
  tail(limit = 500): TranscriptEntry[] {
    return this.recent.slice(-limit);
  }

  private push(entry: TranscriptEntry): void {
    this.recent.push(entry);
    if (this.recent.length > this.keepInMemory) this.recent.splice(0, this.recent.length - this.keepInMemory);
  }
}
