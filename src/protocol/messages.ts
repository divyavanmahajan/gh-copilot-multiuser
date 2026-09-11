/**
 * Wire protocol shared by the room server and the browser client.
 *
 * Every WebSocket frame is a JSON object validated against one of these
 * schemas. Keep this file free of server-only or browser-only imports so both
 * sides can consume it.
 */
import { z } from "zod";

/** `pending` means signed in but not yet admitted by a host. */
export const Role = z.enum(["host", "member", "viewer", "pending"]);
export type Role = z.infer<typeof Role>;

export const IdentityProvider = z.enum(["github", "entra", "guest"]);
export type IdentityProvider = z.infer<typeof IdentityProvider>;

export const Identity = z.object({
  /** Stable id: `github:<numeric id>` or `guest:<random>`. */
  id: z.string(),
  provider: IdentityProvider,
  /** GitHub login, Entra user principal name, or the display name a guest chose. */
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

/** A signed-in user waiting for a host to let them in. */
export const AdmissionRequest = z.object({
  identity: Identity,
  requestedAt: z.string(),
});
export type AdmissionRequest = z.infer<typeof AdmissionRequest>;

/** What a host can do with a pending (or already admitted) user. */
export const AdmissionDecision = z.enum(["viewer", "member", "reject"]);
export type AdmissionDecision = z.infer<typeof AdmissionDecision>;

/**
 * What happens to a signed-in user who is not a host, not on the allow list,
 * has no remembered decision, and did not pass an automatic gate.
 * `approve` (the default) parks them until a host decides.
 */
export const AdmissionPolicy = z.enum(["off", "approve", "viewer", "member"]);
export type AdmissionPolicy = z.infer<typeof AdmissionPolicy>;

/** Host-editable room settings. Persisted; changes apply to the next sign-in. */
export const RoomSettings = z.object({
  admission: z.object({
    github: AdmissionPolicy,
    entra: AdmissionPolicy,
    guest: AdmissionPolicy,
  }),
});
export type RoomSettings = z.infer<typeof RoomSettings>;

export const RoomSettingsPatch = z.object({
  admission: RoomSettings.shape.admission.partial().optional(),
});
export type RoomSettingsPatch = z.infer<typeof RoomSettingsPatch>;
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
    /** Non-empty only for hosts. */
    pendingAdmissions: z.array(AdmissionRequest),
    /** Hosts only: current settings and the guest join code. */
    settings: RoomSettings.nullable(),
    guestCode: z.string().nullable(),
  }),
  z.object({ type: z.literal("participants"), participants: z.array(Participant) }),
  /** Sent to a user who is signed in but not admitted yet. */
  z.object({ type: z.literal("admission.pending"), you: Identity }),
  /** Sent to that user once a host decides. `role` null means rejected. */
  z.object({ type: z.literal("admission.decided"), role: Role.nullable() }),
  /** Sent to hosts whenever the waiting list changes. */
  z.object({ type: z.literal("admissions"), requests: z.array(AdmissionRequest) }),
  /** Sent to hosts whenever settings change. */
  z.object({ type: z.literal("settings"), settings: RoomSettings }),
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
  /** Host admits, changes the role of, or rejects a user by identity id. */
  z.object({ type: z.literal("admission.decide"), userId: z.string(), decision: AdmissionDecision }),
  /** Host changes room settings. */
  z.object({ type: z.literal("settings.update"), patch: RoomSettingsPatch }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Rights derived from a role. Kept here so server and client agree. */
export function can(role: Role, action: "prompt" | "approve" | "abort" | "withdrawOthers" | "admit" | "settings"): boolean {
  if (role === "pending") return false;
  switch (action) {
    case "prompt":
    case "approve":
      return role !== "viewer";
    case "abort":
    case "withdrawOthers":
    case "admit":
    case "settings":
      return role === "host";
  }
}
