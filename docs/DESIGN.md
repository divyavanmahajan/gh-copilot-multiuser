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
  registers the discovered skills and custom agents on it, forwards an
  allow-listed subset of session events, and reports idle. A prompt aimed at
  a custom agent is dispatched as a subagent task rather than run on the
  room's own session, so one person's choice cannot change what the next
  person's turn runs on.
- **Catalog** (`src/server/agent/catalog.ts`). Scans the repository for the
  skills and custom agents it ships and hands them to the session. The
  runtime discovers none of this by itself (`enableConfigDiscovery` defaults
  to false), and scanning here means the room knows what exists before the
  agent is asked, which is what the `/` and `@` pickers are built from. Both
  the `.github/` and `.claude/` layouts are read; `.github` wins a name
  collision. Imports no SDK types: it returns plain data that the agent
  wrapper maps onto the SDK's shapes.
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
  `Identity` shape: GitHub App (web flow and device flow), Microsoft Entra
  ID (OIDC web flow with PKCE and device flow, tokens verified against the
  tenant's keys), and guest (join code). Every provider ends in the same
  `resolveRole()` so admission rules live in one place.
- **Admissions** (`src/server/auth/admissions.ts`). Who gets in and as
  what: hosts list, then the provider's automatic gate (org/team, group),
  then a stored decision or the allow list, then the provider's admission
  policy (refuse, wait for a host, viewer, member). Decisions persist in
  `admissions.json`.
- **Settings** (`src/server/settings.ts`). Host-editable, persisted in
  `settings.json`: one admission policy per sign-in type, default
  `approve` for all. Providers read the policy live at sign-in, so a host's
  change in the UI applies to the next person without a restart. Flags seed
  the first start only.
- **Protocol** (`src/protocol/messages.ts`). Zod schemas shared by server
  and browser; both sides validate every frame.
- **Web client** (`src/web`). Vite + React. Transcript with streaming
  deltas, markdown-rendered replies and tool cards, prompt box with the `/`
  and `@` pickers, queue panel, presence, approval cards. `/skills`,
  `/agents` and `/refresh` are answered in the browser from the catalog it
  already holds, so a listing stays private to the reader instead of
  entering the shared transcript.

### Identity and roles

```
Identity { id, provider: github | entra | guest, login, displayName, role }
Role     host | member | viewer | pending
```

| Action | pending | viewer | member | host |
|---|---|---|---|---|
| watch | | ✓ | ✓ | ✓ |
| submit prompt | | | ✓ | ✓ |
| withdraw own prompt | | | ✓ | ✓ |
| withdraw anyone's prompt | | | | ✓ |
| answer permission prompt | | | if author | ✓ |
| abort running turn | | | | ✓ |
| admit, re-role, remove people | | | | ✓ |

`pending` is a signed-in user parked at the door. They hold a WebSocket but
receive nothing except the decision. Hosts see one card per waiting
identity and choose viewer, participant, or reject; the decision is
persisted and applied to every tab that identity has open. Hosts are
configured (`--hosts`), never decided on.

Guests are `viewer` or `member` depending on `--guests view|participate`,
never `host`. Guest identity is unverified and is badged as such in the UI
and the transcript.

### Admission flow

```
sign-in ──► resolveRole ──► host / member ─────────────► hello
                │
                ├─► stored decision / allow list ──────► hello (or 403)
                │
                └─► policy: approve ──► admission.pending ──► host card
                                                              │
                                             admission.decide ┘
                                                              ▼
                                       admission.decided + hello, or rejected
```

Host approval is the default for every sign-in type. On a server with no
host online the automatic paths carry the load: org, team or group gates,
the allow list, remembered decisions, and a policy of admit-as-viewer set
from the UI. Anyone who still ends up waiting is shown to the next host who
connects.

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

## Runtime behaviour we had to work around

These are properties of the bundled Copilot runtime, not of this codebase.
They are written down because each one cost an afternoon to find, and each
workaround looks removable to someone who does not know why it is there.

**The runtime does not apply a custom agent's authored prompt.** An agent
discovered from disk fails outright:

```
Standalone server does not support session effect 'custom_agent_prompt'
```

An agent supplied through `customAgents` is accepted, appears in
`agent.list()`, and is dispatched under its own name — but answers as the
default agent. `agent.select()` is worse: it reports success and
`agent.getCurrent()` confirms the selection, while the selected agent's
prompt has no effect on the next turn at all. Because the catalog has
already parsed the prompt out of the `.md`, the agent wrapper sends it as
part of the subagent's task text. **If a future runtime applies the prompt
itself, the agent will receive it twice and this must be removed.**

**A subagent turn produces no `session.idle`.** The host session goes quiet
while the background task works, so the wrapper ends the turn on
`subagent.completed` instead. Aborting clears the same flag, or the room
would never return to idle.

**Tool names are platform-specific.** The shell tool is `powershell` on
Windows and `bash` on Linux, so a `tools:` list in an agent definition
silently strips the agent of a shell on the other platform. Names observed
from this runtime: `glob`, `powershell`, `read_agent`, `rg`, `skill`,
`task`, `view`.

**Skills only run while the session is idle.** `commands.list` reports
`allowDuringAgentExecution: false` for them, which is why the room expands a
`/command` in `pump()` rather than at submit time.

## Milestones

**M1 (this skeleton, to be completed):** one room, one repo, GitHub App and
guest sign-in, org/team gate, strict queue with attribution, permission
routing to the author with timeout, transcript with replay, session resume
on restart, Docker image, npm publish.

Acceptance: two browsers on different GitHub accounts submit prompts
alternately; both see identical streamed output; the second prompt waits
for the first turn.

**M2 (partly done):** Microsoft Entra ID sign-in and host-approved public
sign-in are in, as are markdown-rendered replies and the repository's own
skills and custom agents behind `/` and `@`. Remaining: optional Copilot
seat verification with an admin token, voting on destructive actions,
per-kind auto-approval rules.

**M3:** multiple rooms per server and switching between sessions from the
UI (today a room is one session; a second conversation means a second room
on another port), Slack/Teams bridge, mid-turn steering.

## Non-goals

Not a replacement for Copilot's own session sharing, not a multi-agent
orchestrator, not a general chat product.
