# Design: one Copilot agent, one repo, everyone in the room

## Problem

Two to five developers are on a call. One GitHub Copilot agent is working in a
repository. Everyone should see what it is doing, anyone should be able to
give it the next instruction, and the agent should keep one continuous
context. GitHub Copilot CLI does not offer this natively: its remote control
is limited to the account that started the session, and shared sessions are
view-only.

Three architectures fit the phrase "multiplayer coding agent":

| | Shape | Examples |
|---|---|---|
| A | Multiplayer terminal: users share the PTY that Copilot CLI runs in | ccshare, Coterm |
| B | Multiplayer agent session: users share one SDK session through a room server | **this project** |
| C | Multiple agents in one workspace, coordinated to avoid collisions | OpenHands, Bothread |

This project is B. GitHub's own SDK documentation describes it as
"Pattern 3: shared sessions (collaborative)", "like a shared chat room with
Copilot", and warns that the SDK provides no session locking, so access must
be serialized by the application. See
<https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/scaling>.

## Architecture

```
 Alice ─┐                                      ┌────────────────────┐
 Bob   ─┼─ browser ── WebSocket ──► Room server │ participants       │
 Carol ─┘                                      │ strict prompt queue │
                                               │ permission router  │
                                               │ JSONL transcript   │
                                               └─────────┬──────────┘
                                                         │ Copilot SDK (JSON-RPC)
                                                         ▼
                                               Copilot runtime, one session
                                                         │
                                                         ▼
                                                  the repository
```

### Components

- **Room server** (`src/server`). Node 22, Hono for HTTP, `ws` for
  WebSockets. Owns the single `CopilotClient` and single `CopilotSession`.
- **Agent wrapper** (`src/server/agent/copilot.ts`). The only file that
  imports the SDK. Creates or resumes the session pinned to the repo,
  forwards an allow-listed subset of session events, reports idle.
- **Strict queue** (`src/server/agent/queue.ts`). Pure state machine. One
  prompt in flight; the next starts on `session.idle`. Authors may withdraw
  their own pending prompt; hosts may withdraw anyone's.
- **Permission router** (`src/server/agent/permissions.ts`). Copilot's
  shell/write/url permission prompts are shown to everyone and answerable by
  the prompt author and connected hosts. No answer before the timeout means
  reject. Abort rejects everything outstanding.
- **Room** (`src/server/room/room.ts`). Participants, presence, fan-out,
  attribution. Every prompt is sent to the agent as `[login]: text`, and the
  session gets an appended system message explaining the shared setting.
- **Transcript** (`src/server/room/transcript.ts`). Append-only JSONL of
  agent events plus the facts the runtime does not know: who submitted each
  prompt, who answered each permission request. Replayed to late joiners.
  This is also the audit trail.
- **Auth** (`src/server/auth`). Pluggable providers producing one
  `Identity` shape. GitHub App (web flow and device flow) and guest (join
  code) exist. Corporate OIDC is the planned third.
- **Protocol** (`src/protocol/messages.ts`). Zod schemas shared by server
  and browser; both sides validate every frame.
- **Web client** (`src/web`). Vite + React. Transcript with streaming
  deltas and tool cards, prompt box, queue panel, presence, approval cards.

### Identity and roles

```
Identity { id, provider: github | guest, login, displayName, role }
Role     host | member | viewer
```

| Action | viewer | member | host |
|---|---|---|---|
| watch | ✓ | ✓ | ✓ |
| submit prompt | | ✓ | ✓ |
| withdraw own prompt | | ✓ | ✓ |
| withdraw anyone's prompt | | | ✓ |
| answer permission prompt | | if author | ✓ |
| abort running turn | | | ✓ |

GitHub users are `member` unless listed in `--hosts`. Guests are `viewer`
or `member` depending on `--guests view|participate`, never `host`. Guest
identity is unverified and is badged as such in the UI and the transcript.

### Copilot authentication and seats

The Copilot runtime authenticates as one account: the host's CLI login in
laptop mode, or a service account token (`COPILOT_GITHUB_TOKEN`) in server
mode. All premium requests bill to that account. On Copilot Enterprise every
participant should hold a seat, and the host pattern should be cleared with
the org admin. Viewing-only guests are low risk; guests who steer the agent
are people without seats driving a seat they do not own.

### What the SDK multi-tenancy guide says, and why most of it does not apply

The multi-tenancy guide targets strangers sharing one runtime: run in
`"empty"` mode, per-user tokens, explicit tool allowlists. This room
deliberately shares one coding agent on one repo among people who trust each
other, so it keeps the default coding-agent mode and one token. What does
carry over: the runtime executes shell commands with the host's privileges,
so run it in a container or a dedicated worktree, and gate who can join.

## Network

- **Laptop mode** binds `127.0.0.1`. Colleagues reach it over the LAN by
  passing `--host 0.0.0.0` or through a tunnel.
- **Server mode** binds `0.0.0.0` and expects `--public-url`.
- **No tunnel needed on a corporate network.** The OAuth callback is a
  browser redirect; GitHub never contacts it, so an internal hostname works.
  Only the room server needs outbound HTTPS to github.com, and the Copilot
  runtime to the Copilot API, through the corporate proxy if any.
- **Device flow** needs no callback URL at all and is the default on laptops
  whose address changes.
- Plain HTTP on a LAN is supported; the session cookie is marked `Secure`
  only when `--public-url` is HTTPS.

## Milestones

**M1 (this skeleton, to be completed):** one room, one repo, GitHub App and
guest sign-in, org/team gate, strict queue with attribution, permission
routing to the author with timeout, transcript with replay, session resume
on restart, Docker image, npm publish.

Acceptance: two browsers on different GitHub accounts submit prompts
alternately; both see identical streamed output; the second prompt waits
for the first turn.

**M2:** corporate OIDC provider, optional Copilot seat verification with an
admin token, voting on destructive actions, per-kind auto-approval rules.

**M3:** multiple rooms per server, Slack/Teams bridge, mid-turn steering.

## Non-goals

Not a replacement for Copilot's own session sharing, not a multi-agent
orchestrator, not a general chat product.
