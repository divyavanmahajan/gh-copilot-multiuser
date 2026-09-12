# Using a Copilot room

This guide is for people **working in** a room. If you are the one starting it,
read [WALKTHROUGH.md](WALKTHROUGH.md) first and come back here.

- [The idea](#the-idea)
- [Getting in](#getting-in)
- [What you are looking at](#what-you-are-looking-at)
- [Asking the agent to do something](#asking-the-agent-to-do-something)
- [The queue](#the-queue)
- [Approvals](#approvals)
- [Skills: the `/` menu](#skills-the--menu)
- [Custom agents: the `@` menu](#custom-agents-the--menu)
- [Reading the transcript](#reading-the-transcript)
- [If you are a host](#if-you-are-a-host)
- [Working together without treading on each other](#working-together-without-treading-on-each-other)
- [When something looks wrong](#when-something-looks-wrong)

## The idea

A room is **one Copilot session, one repository, and everybody watching the same
screen**. It is not a chat app with a bot in it. There is a single conversation,
a single working directory, and a single agent, and everyone in the room is
talking to that one agent.

Two things follow from that, and they explain nearly everything else:

- **Only one prompt runs at a time.** Everything else waits in a queue. Two
  people cannot have the agent editing the same files on two trains of thought.
- **What you do is visible.** Your prompt, the commands the agent wants to run,
  the files it changes, and its replies are shown to everyone, with your name on
  them.

The agent knows who is speaking. Each prompt reaches it as `[alice]: …`, so you
can ask *"what did Bob want earlier?"* and get a real answer.

### One room, one session

There is no session switcher, and no way to start a second conversation from
inside the room. The session id in the header is *the* conversation. If your
team needs two lines of work at once, someone has to run a second room on
another port — ask whoever set this one up.

One consequence is worth knowing: if the room has been restarted, the
transcript you can scroll through may be **longer than what the agent
remembers**. The transcript is the room's own record and survives restarts; the
agent's memory belongs to the session, and a restart can start a fresh one. If
the agent seems not to know about something you can see further up, that is
why — quote the part that matters back to it.

## Getting in

Open the URL you were given — usually `http://<someone's-machine>:3000`. You
will be offered whichever sign-in methods the room was started with:

| Method | What you need | Notes |
|---|---|---|
| **GitHub** | a GitHub account | Device code, or a browser redirect. |
| **Microsoft** | a work account | Device code, or a browser redirect. |
| **Guest** | the join code | No account. You are not verified; the badge says `guest`. |

The sign-in screen tells you what happens next — *"you join as a participant"*,
*"a host admits you after sign-in"*, or *"members only"*.

If you land on **"Waiting for a host"**, you are signed in but not admitted
yet. A host has to let you in. If nobody is holding the room open, nothing will
happen — go and ask them.

### Your badge

Next to your name, top right:

| Role | Can prompt | Can answer approvals | Can abort, admit, change settings |
|---|---|---|---|
| **host** | yes | yes | yes |
| **member** | yes | yes | no |
| **viewer** | no | no | no |

A viewer sees everything and can type nothing; the composer says so. A host can
promote a viewer to member at any time.

## What you are looking at

```
┌──────────────────────────────────────────┬──────────────────┐
│ repo name    idle · alice   session 7f3a │  IN THE ROOM     │
├──────────────────────────────────────────┤  alice  host     │
│                                          │  bob    member   │
│  the transcript: prompts, replies,       │  cara   viewer   │
│  tool calls, approval cards              │                  │
│                                          │  QUEUE           │
│                                          │  bob: run tests  │
├──────────────────────────────────────────┴──────────────────┤
│ Ask the agent…  / for a skill, @ for an agent      [ Send ] │
└─────────────────────────────────────────────────────────────┘
```

- **Header** — the room's name, the status, and the session id. Status is
  `idle` (ready), `running` (a turn is in flight, with whose turn it is), or
  `starting`.
- **Transcript** — the shared history. Replayed in full when you join, so you
  can catch up on what happened before you arrived.
- **In the room** — who is here, with their roles. A `typing…` badge appears
  when someone is composing.
- **Queue** — what is waiting, in order, with names.
- **Composer** — where you type. `Enter` sends, `Shift+Enter` makes a newline.

## Asking the agent to do something

Type and press `Enter`. If the agent is idle your prompt starts immediately; if
it is busy the button says **Queue** instead of **Send** and your prompt joins
the line.

Prompts are ordinary language. The agent can read and edit files in the
repository, run commands, and search the web — subject to approvals below.

Good prompts in a shared room tend to be **small and finishable**. A prompt that
runs for fifteen minutes blocks everyone else, and a long turn is hard for
others to follow. Prefer "add a test for the empty-input case in parseConfig" to
"improve the test suite".

## The queue

Only one prompt runs at a time. The rest wait, and everyone can see the line.

- **Your place is visible** to the room, with your name and your text.
- **Withdraw** a prompt while it is still waiting with the `✕` next to it. Once
  it starts running it is no longer yours to pull back.
- **Hosts can withdraw anyone's** prompt, which is the polite way to unblock a
  room when someone has queued something wrong.

## Approvals

The agent asks permission before it runs a shell command, writes a file, or
fetches a URL. A card appears **for everyone**, showing exactly what it wants to
do — the full command, or the diff.

**Only the person whose prompt is running gets the buttons.** Hosts get them
too. Everyone else sees the card read-only, so the room can see what is being
asked without four people racing to answer.

Three choices:

- **Approve** — just this once.
- **Approve for session** — and stop asking for this kind of thing.
- **Reject** — the agent is told no and carries on without it.

You should not have to hunt for one. While any approval is outstanding the
header shows a red **"1 approval waiting"** button — it says *your call* when
the answer is yours — and clicking it jumps to the card. When a card arrives
that is yours to answer, the view scrolls to it. If it is someone else's and
you are reading back through the history, you are left where you are; the
header button is how you keep track.

> **Approvals expire.** No answer within two minutes counts as a rejection. The
> transcript records `permission timeout` and the tool call fails. If you asked
> for something and then walked away, this is why it "did nothing". The timeout
> is configurable by whoever runs the room (`COPILOT_ROOM_PERMISSION_TIMEOUT`).

## Skills: the `/` menu

A **skill** is a reusable instruction the repository ships, living in
`.github/skills/<name>/SKILL.md` (or `.claude/skills/…`). Think of it as a
saved, well-written prompt that everyone can invoke by name.

Type `/` in the composer and a menu appears. Keep typing to narrow it,
`↑`/`↓` to move, `Enter` or `Tab` to pick, `Esc` to clear.

```
/release-notes since v1.2.0
```

The skill is expanded into a full prompt and run as a normal turn — queued,
attributed to you, and visible to everyone, exactly as if you had typed the long
version yourself.

The menu also lists the **runtime's own commands**, marked `builtin` (`/plan`,
`/compact`, `/review` and friends).

Three commands are answered by **your browser alone**, and never reach the
agent or the shared transcript:

| Command | Does |
|---|---|
| `/skills` | lists the skills this repository ships, then the builtins |
| `/agents` | lists the custom agents you can address |
| `/refresh` | re-scans the repository after someone adds or edits a skill |

A `/` the room does not recognise is sent as ordinary text, so a prompt that
happens to start with a path is not mangled into a command.

## Custom agents: the `@` menu

A **custom agent** is a specialist with its own instructions and its own tool
list, defined in `.github/agents/<name>.md` (or `.claude/agents/…`). A reviewer
that never edits files, a documentation writer, a test-focused agent.

Type `@`, pick one, then write your prompt:

```
@reviewer look at the diff on this branch and tell me what breaks
```

That prompt runs **as a subagent**: a separate worker with the agent's own
instructions, reporting back into the transcript. You will see

```
you → @reviewer
▶ @reviewer · Reviews a diff for correctness bugs without touching the code.
…the reply…
✓ @reviewer · 12.4s
```

**It applies to that one prompt only.** There is no mode to switch on and forget
about, and your choice cannot change what anyone else's next turn runs on. If
you want three prompts on the reviewer, mention it three times.

If you type an `@name` the room has never heard of, it tells you immediately
rather than queueing something that would fail later.

> Adding a **new** agent file needs the room restarted before it can be
> addressed — `/refresh` picks up edits to existing ones, but registering a new
> agent happens when the session is created.

## Reading the transcript

- **Your prompts** appear in a monospace block with a coloured edge and your
  name, exactly as typed.
- **The agent's replies** are rendered as markdown: headings, lists, tables,
  links, and code blocks come out formatted.
- **Tool calls** are the dim monospace lines — `▶` starting, `✓` finished,
  `✗` failed. The arguments are shown so you can see precisely what ran.
- **Room events** — `permission timeout`, `turn aborted` — are the italic
  lines.

Everything is written to disk in the room's state directory, so the history
survives a restart and late joiners get the whole thing.

## If you are a host

You get three extra powers, in the header and the side panel.

- **Admitting people.** When someone signs in and the policy is *host approves*,
  a card appears for you. Admit as a participant, admit as a viewer, or refuse.
  Decisions are remembered, so the same person is not asked about twice.
- **Admission policy.** Change how each sign-in type is treated — refuse, ask a
  host, admit as viewer, admit as participant — and it takes effect at the next
  sign-in and survives restarts. The guest join code is shown here too.
- **Abort.** Stops the running turn. Use it when the agent has misunderstood and
  is working down a wrong path; the queue carries on with the next prompt.

Being a host is a duty as much as a power: if the policy is *host approves* and
no host is in the room, nobody new can get in.

## Working together without treading on each other

- **Watch the status before you type.** If a turn is running, yours is going to
  queue.
- **Say what you are doing** in the prompt itself. The agent shows your name, so
  "I'm taking the parser bug" is visible to the room.
- **Answer your own approvals promptly.** The room is blocked while your turn
  waits on a card, and after two minutes the work is thrown away.
- **Don't queue speculatively.** A queue full of half-considered prompts is
  worse than an empty one; you can always add yours when the agent is free.
- **Remember it is one repository.** The agent's edits are real edits to a real
  working tree that someone is hosting. Treat it like a shared machine, because
  it is one.

## When something looks wrong

| What you see | What is happening | What to do |
|---|---|---|
| "Waiting for a host" and nothing changes | no host is connected to admit you | ask whoever runs the room to open it |
| The composer is greyed out | you are a viewer | ask a host to promote you |
| `permission timeout` and a failed tool call | nobody answered the approval within two minutes | run the prompt again and answer the card |
| An approval card you cannot answer | it is not your turn | the author or a host answers it |
| You missed an approval entirely | it arrived while you were reading further up | watch for the red button in the header; click it to jump to the card |
| Your prompt sits in the queue | someone else's turn is running | wait, or ask a host to abort it |
| `/yourskill` was sent as plain text | the room does not know that name | `/refresh`, or check the spelling with `/skills` |
| `no custom agent called X` | no such agent file, or it needs a restart | check `/agents` |
| The page looks stale or blank after an update | your browser is holding an old copy | hard reload (`Ctrl+Shift+R`) |
| You are asked to sign in again | the room restarted and your session cookie is no longer valid | sign in again |
| Nothing updates, but others see activity | your tab lost its connection | reload the page |
