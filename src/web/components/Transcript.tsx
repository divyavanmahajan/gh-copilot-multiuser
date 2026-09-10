import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../../protocol/messages.js";

/**
 * Renders the transcript. Streaming deltas for the same message are
 * coalesced into one block; the final assistant.message replaces them.
 */
export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [entries.length]);

  const blocks = coalesce(entries);
  return (
    <div>
      {blocks.map((b) => (
        <div key={b.key} className={`entry ${b.cls}`}>
          {b.who && <div className="who">{b.who}</div>}
          <pre>{b.text}</pre>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

interface Block {
  key: string;
  cls: string;
  who?: string;
  text: string;
}

function coalesce(entries: TranscriptEntry[]): Block[] {
  const out: Block[] = [];
  let streaming: Block | null = null;
  let i = 0;
  for (const e of entries) {
    i++;
    if (e.kind === "turn.started") {
      streaming = null;
      out.push({ key: `t${i}`, cls: "user", who: e.prompt.authorLogin, text: e.prompt.text });
      continue;
    }
    if (e.kind === "turn.finished") {
      streaming = null;
      if (e.reason !== "completed") out.push({ key: `f${i}`, cls: "meta", text: `turn ${e.reason}${e.error ? `: ${e.error}` : ""}` });
      continue;
    }
    if (e.kind === "permission.resolved") {
      out.push({ key: `p${i}`, cls: "meta", text: `permission ${e.decision}${e.byUserId ? ` by ${e.byUserId.split(":")[1] ?? e.byUserId}` : ""}` });
      continue;
    }
    const d = (e.event.data ?? {}) as Record<string, unknown>;
    switch (e.event.type) {
      case "assistant.message_delta": {
        const delta = String(d.deltaContent ?? "");
        if (streaming) streaming.text += delta;
        else {
          streaming = { key: `s${i}`, cls: "assistant", who: "copilot", text: delta };
          out.push(streaming);
        }
        break;
      }
      case "assistant.message": {
        const content = String(d.content ?? "");
        if (streaming) {
          streaming.text = content || streaming.text;
          streaming = null;
        } else if (content) out.push({ key: `m${i}`, cls: "assistant", who: "copilot", text: content });
        break;
      }
      case "tool.execution_start":
        streaming = null;
        out.push({ key: `ts${i}`, cls: "tool", text: `▶ ${String(d.toolName ?? "tool")} ${summarize(d.arguments)}` });
        break;
      case "tool.execution_complete":
        out.push({ key: `tc${i}`, cls: "tool", text: `✓ ${String(d.toolName ?? "tool")}${d.success === false ? " (failed)" : ""}` });
        break;
      case "session.error":
        out.push({ key: `e${i}`, cls: "meta", text: `error: ${String(d.message ?? "")}` });
        break;
      default:
        break;
    }
  }
  return out;
}

function summarize(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}
