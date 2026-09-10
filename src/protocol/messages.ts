/**
 * Wire protocol shared by the room server and the browser client.
 *
 * Every WebSocket frame is a JSON object validated against one of these
 * schemas. Keep this file free of server-only or browser-only imports so both
 * sides can consume it.
 */
import { z } from "zod";

export const Role = z.enum(["host", "member", "viewer"]);
export type Role = z.infer<typeof Role>;

export const IdentityProvider = z.enum(["github", "guest"]);
export type IdentityProvider = z.infer<typeof IdentityProvider>;

export const Identity = z.object({
  /** Stable id: `github:<numeric id>` or `guest:<random>`. */
  id: z.string(),
  provider: IdentityProvider,
  /** GitHub login, or the display name a guest chose. */
  login: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  role: Role,
});
export type Identity = z.infer<typeof Identity>;

export const Participant = Identity.extend({
  connectedAt: z.string(),
  typing: z.boolean(),
});
export type Participant = z.infer<typeof Participant>;

export const QueuedPrompt = z.object({
  id: z.string(),
  authorId: z.string(),
  authorLogin: z.string(),
  text: z.string(),
  submittedAt: z.string(),
});
export type QueuedPrompt = z.infer<typeof QueuedPrompt>;

export const RoomStatus = z.enum(["starting", "idle", "running", "error"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

export const PermissionDecision = z.enum(["approve-once", "approve-for-session", "reject"]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/**
 * Subset of Copilot SDK session events the server forwards to browsers.
 * The payload is passed through untouched; the client renders what it knows
 * and ignores the rest. Kept as `unknown` here so the protocol package does
 * not depend on the SDK's generated types.
 */
export const AgentEvent = z.object({
  type: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
  data: z.unknown(),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export const TranscriptEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), at: z.string(), event: AgentEvent }),
  z.object({ kind: z.literal("turn.started"), at: z.string(), prompt: QueuedPrompt }),
  z.object({
    kind: z.literal("turn.finished"),
    at: z.string(),
    promptId: z.string(),
    reason: z.enum(["completed", "aborted", "error"]),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("permission.resolved"),
    at: z.string(),
    requestId: z.string(),
    decision: z.union([PermissionDecision, z.literal("timeout")]),
    byUserId: z.string().optional(),
  }),
]);
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    you: Identity,
    room: z.object({ name: z.string(), repo: z.string(), sessionId: z.string(), model: z.string().optional() }),
    status: RoomStatus,
    participants: z.array(Participant),
    queue: z.array(QueuedPrompt),
    current: QueuedPrompt.nullable(),
    transcript: z.array(TranscriptEntry),
  }),
  z.object({ type: z.literal("participants"), participants: z.array(Participant) }),
  z.object({ type: z.literal("status"), status: RoomStatus }),
  z.object({ type: z.literal("queue"), queue: z.array(QueuedPrompt), current: QueuedPrompt.nullable() }),
  z.object({ type: z.literal("transcript"), entry: TranscriptEntry }),
  z.object({
    type: z.literal("permission.request"),
    requestId: z.string(),
    /** The SDK's PermissionRequest, passed through for display. */
    request: z.unknown(),
    /** Users allowed to answer. Everyone else sees it read-only. */
    deciderIds: z.array(z.string()),
    expiresAt: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt.submit"), text: z.string().min(1).max(20_000) }),
  z.object({ type: z.literal("prompt.withdraw"), promptId: z.string() }),
  z.object({ type: z.literal("typing"), typing: z.boolean() }),
  z.object({ type: z.literal("permission.respond"), requestId: z.string(), decision: PermissionDecision }),
  z.object({ type: z.literal("turn.abort") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Rights derived from a role. Kept here so server and client agree. */
export function can(role: Role, action: "prompt" | "approve" | "abort" | "withdrawOthers"): boolean {
  switch (action) {
    case "prompt":
      return role !== "viewer";
    case "approve":
      return role !== "viewer";
    case "abort":
    case "withdrawOthers":
      return role === "host";
  }
}
