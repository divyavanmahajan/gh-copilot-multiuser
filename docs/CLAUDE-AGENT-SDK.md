# Exploration: supporting the Claude Agent SDK as a second agent backend

Status: exploration on a branch. Findings verified against
`@anthropic-ai/claude-agent-sdk` 0.3.270 types and the docs at
code.claude.com on 2026-09-12. A compiling adapter spike lives in
`src/server/agent/claude.ts`; it has not been run against a live session.

## Summary

Feasible, and a good fit. The room already hides the agent behind a small
`Agent` interface (start, send, abort, history, stop, plus callbacks for
events, idle, permission requests). The Claude Agent SDK's streaming input
mode gives exactly the shape the room wants: one long-lived process, one
session, user messages pushed in one at a time, a result message per turn,
a permission callback per tool call, and interrupt. Nothing in the room's
queue, admissions, transcript or UI needs to change.

What does need work, in order of effort:

1. A room-native permission request type. Today the `Agent` interface
   leaks the Copilot SDK's `PermissionHandler` type. The Claude adapter has
   to fake a Copilot-shaped request, which works for the fields the UI
   reads but is the wrong long-term shape.
2. Authentication and terms. The Claude Agent SDK must use an API key (or
   Bedrock, Vertex, Foundry, Claude Platform on AWS). Anthropic does not
   allow third-party products to offer claude.ai subscription login unless
   previously approved. This changes the host story: the room bills to an
   API key the host controls, not to a seat.
3. Structured questions. Claude asks clarifying questions through the
   `AskUserQuestion` tool, which arrives through the same permission
   callback with a questions array. The room's approval card cannot answer
   it yet. The spike denies it with a message asking Claude to ask in
   prose; a proper card is a small UI feature.
4. Package weight. The SDK bundles a native Claude Code binary as
   platform-specific optional dependencies (233 MB installed on
   linux-x64). It should stay an optional peer dependency that hosts
   install only when they pick the Claude backend.

Estimate for a first working milestone once the spike is exercised against
a live session: two to three days, most of it the permission type refactor
and the question card.

## How the two SDKs compare for this room

| Concern | Copilot SDK (`@github/copilot-sdk`) | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
|---|---|---|
| Process model | Client spawns a runtime; JSON-RPC over stdio | `query()` spawns the bundled Claude Code binary; async generator of messages |
| Session object | `CopilotSession` with `send`, `on`, `abort`, `getEvents` | No session object. Streaming input mode: pass an `AsyncIterable<SDKUserMessage>` and keep it open; `Query` extends `AsyncGenerator<SDKMessage>` |
| Turn boundary | `session.idle` event | `result` message per user turn (`subtype` success or error variants, cumulative `total_cost_usd`) |
| Streaming text | `assistant.message_delta` | `stream_event` wrapping raw Messages API events, when `includePartialMessages: true` |
| Tool start / end | `tool.execution_start` / `tool.execution_complete` | `tool_use` block in an `assistant` message / `tool_result` block in a `user` message with `tool_use_result` |
| Permission prompt | `onPermissionRequest(request)` with a `kind` union (shell, write, url, mcp, ...) | `canUseTool(toolName, input, {signal, suggestions})` with a per-tool input record |
| Approve for session | `approve-for-session` result kind | Return `updatedPermissions` echoing the SDK's `suggestions` |
| Reject | `{kind: "reject"}` | `{behavior: "deny", message}`; Claude sees the message |
| Abort | `session.abort()` | `query.interrupt()` |
| Resume | `client.resumeSession(id)` | `options.resume = id`; id arrives on the `system`/`init` and `result` messages |
| History for late joiners | `session.getEvents()` | `getSessionMessages(id)` reads the on-disk JSONL |
| Session storage | `~/.copilot/session-state/` | `~/.claude/projects/<encoded-cwd>/<id>.jsonl`, or a `sessionStore` adapter for shared storage |
| Attribution | Prompt prefix `[login]:` plus appended system message | Same. `SDKUserMessage.origin` exists but its `peer` kind is for cross-session messaging, not for several humans on one session; `{kind: "human"}` is what a host must stamp on keyboard input |
| Auth | Host's Copilot CLI login or a GitHub token | `ANTHROPIC_API_KEY`, or a cloud provider via `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`. No claude.ai login for third-party products |
| Node | 20.19+ or 22.12+ | 18+ |
| Install size | Platform runtime package | Platform binary, about 233 MB on linux-x64 |

## Mapping onto the room's `Agent` interface

```
Agent.start()    -> query({ prompt: <push channel>, options })  then wait for system/init
Agent.send()     -> channel.push({ type: "user", message: { role: "user", content: "[login]: text" },
                                   parent_tool_use_id: null, origin: { kind: "human" } })
Agent.abort()    -> query.interrupt()
Agent.history()  -> getSessionMessages(sessionId) mapped through the same event mapper
Agent.stop()     -> channel.close(); query.close()
onEvent          <- stream_event (text_delta, thinking_delta), assistant (text, tool_use),
                    user (tool_result), tool_progress, system compact_boundary, errors
onIdle           <- result
onPermission     <- canUseTool
```

The mapper from `SDKMessage` to the room's `AgentEvent` is a pure function
in the spike (`mapClaudeMessage`) and is unit tested with synthetic
messages. It reuses the Copilot event names so the browser needs no change:
`assistant.message_delta`, `assistant.message`, `tool.execution_start`,
`tool.execution_complete`, `session.error`, and so on.

### Permission requests

The room's approval card reads `kind`, `intention`, `fullCommandText`,
`fileName`, `diff`, `url`, `serverName`, `toolName`. The spike synthesises
those from the Claude tool name and input:

| Claude tool | Room kind | Fields |
|---|---|---|
| `Bash` | `shell` | `fullCommandText` from `command`, `intention` from `description` |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `write` | `fileName` from `file_path`, `diff` from `old_string` / `new_string` or `content` |
| `Read` | `read` | `path` |
| `WebFetch`, `WebSearch` | `url` | `url` or `query` |
| `mcp__<server>__<tool>` | `mcp` | `serverName`, `toolName` |
| anything else | `custom-tool` | `toolName`, JSON input |

Decisions map as approve once -> allow with the original input, approve for
session -> allow plus `updatedPermissions` echoing the SDK's suggestions,
reject and timeout -> deny with a message.

`allowedTools` and permission modes are deliberately left at defaults so
every write and command reaches the callback and therefore the room. Reads
inside the working directory never prompt in either SDK.

## Differences that affect the product

- **Who pays.** Copilot bills the host's seat. Claude bills the API key.
  For an enterprise, a workspace key with a spend limit per room is the
  natural setup, and `maxBudgetUsd` on the query gives a hard per-session
  cap that the room can surface.
- **Cost visibility.** Every `result` carries cumulative `total_cost_usd`
  and per-model usage. Worth a header badge once the backend is in.
- **Permission evaluation order.** Hooks, deny rules, ask rules, mode,
  allow rules, then `canUseTool`. Rules in the repo's `.claude/settings.json`
  apply because the `project` setting source loads by default. A host who
  wants every action to reach the room must not add bare allow rules.
- **Structured questions.** `AskUserQuestion` needs a card with 1 to 4
  questions and 2 to 4 options each, answered by the prompt author. The
  room already routes approvals to the author, so this slots in beside the
  existing approval card.
- **Effort and thinking.** The SDK exposes `effort` and `thinking`
  options. A host setting for effort would be cheap to add next to the
  admission settings.
- **Sandboxing.** Both runtimes execute commands as the host user. The
  existing advice stands: run the room in a container or dedicated worktree.
- **Branding.** Anthropic's guidelines allow "Claude Agent" or "Powered by
  Claude" and disallow presenting the product as Claude Code. The room's
  UI should say "Claude agent" in the header when that backend is active.

## Proposed rollout

1. **Refactor** the `Agent` interface to a room-owned `PermissionRequest`
   and `PermissionDecision`; adapt the Copilot wrapper to it. Half a day.
2. **Exercise the spike** against a live session with an API key: confirm
   init ordering in streaming mode, delta shapes, tool result pairing, and
   interrupt behaviour. Half a day.
3. **Question card** for `AskUserQuestion`. Half a day.
4. **Backend selection** is already wired: `--agent claude` or
   `COPILOT_ROOM_AGENT=claude`, with the SDK loaded lazily so the base
   install stays Copilot-sized. Add docs and a header badge. Quarter day.
5. **Cost badge and `--max-budget-usd`.** Quarter day.

## Open questions

- Whether a room should allow switching backend per session or fix it at
  startup. The spike fixes it at startup, which keeps one transcript per
  runtime and avoids mixing session formats.
- Whether to keep the `[login]:` prefix or move attribution into a
  mid-conversation system message per turn. The prefix works on both SDKs
  today; revisit if the model starts echoing prefixes.
- Whether the shared `sessionStore` adapter is worth wiring for server
  mode, so a room can move between hosts. Not needed for the first cut.
