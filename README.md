# copilot-room

One GitHub Copilot agent. One repository. Everyone on the call in the room.

`copilot-room` runs a single Copilot agent session against a repo and lets a
small team drive it from their browsers: everyone sees the same streamed
transcript and tool calls, anyone can queue the next prompt, and the agent
keeps one continuous context. Built on the
[GitHub Copilot SDK](https://github.com/github/copilot-sdk).

```sh
cd your-repo
npx copilot-room --host 0.0.0.0 --org your-org --hosts you
```

Colleagues open the URL, sign in with GitHub, and start typing.

## Why

Copilot CLI's own session sharing is view-only and remote control is limited
to the account that started the session. Terminal sharers (ccshare, Coterm)
make the terminal multiplayer, not the agent. This project sits on the SDK's
documented "shared sessions (collaborative)" pattern and adds what a
terminal cannot: identity, a prompt queue, who-is-driving, routed
approvals, and an attributed transcript.

## Features (first milestone)

- Strict queue: one prompt in flight, next starts when the agent goes idle
- Attribution: the agent sees `[alice]: ...` and knows who asked
- Presence and typing indicators
- Permission prompts routed to the prompt author (and hosts), with timeout
- GitHub App sign-in (browser redirect or device code), org/team gate
- Optional guests with a join code, view-only or participating
- Append-only transcript, replayed to late joiners, doubles as audit log
- Works on a corporate LAN with no tunnel; Docker image for a shared server

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture and milestones
- [docs/DEPLOY.md](docs/DEPLOY.md): laptop mode, server mode, HTTPS, proxies
- [docs/ENTERPRISE-SETUP.md](docs/ENTERPRISE-SETUP.md): GitHub App and policy checklist

## Development

```sh
npm install
npm run typecheck && npm test && npm run build
npm run dev          # room server with tsx; run `npx vite` in another shell for HMR
```

Requires Node 22+. The Copilot runtime is pulled in by the SDK as a
platform package; set `COPILOT_CLI_PATH` to use an existing Copilot CLI.

## Status

Skeleton. The server, protocol, queue, auth flows and client are laid out and
typecheck; end-to-end behaviour against a live Copilot session has not been
exercised yet.

## License

MIT
