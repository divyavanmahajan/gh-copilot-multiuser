# Deploying copilot-room

## Prerequisites

- Node 22 or newer on the host. The Copilot runtime ships as an optional
  platform package of the SDK, so no separate CLI install is required. Set
  `COPILOT_CLI_PATH` to use an existing Copilot CLI instead.
- A GitHub App (see ENTERPRISE-SETUP.md) with its client id and secret.
- Copilot access for the account the runtime will use.

## Laptop mode (host's machine, same network)

```sh
export GITHUB_APP_CLIENT_ID=...
export GITHUB_APP_CLIENT_SECRET=...
cd ~/src/the-repo
npx copilot-room --host 0.0.0.0 --org my-org/my-team --hosts alice
```

The runtime uses your own Copilot CLI login. Colleagues open
`http://<your-hostname>:3000`, sign in with the device code shown, and are
in. Nothing leaves the network except the room's calls to github.com and
the runtime's calls to the Copilot API.

Use `--public-url http://<your-hostname>:3000` if you prefer the browser
redirect sign-in over the device code.

### Off-network colleagues

VPN first. If you must expose the room to the internet, put a tunnel in
front (`cloudflared tunnel --url http://localhost:3000`) and keep device
flow, which does not care that the tunnel URL changes.

## Server mode (shared box or container)

```sh
docker build -t copilot-room .
docker run -d --name room \
  -p 3000:3000 \
  -v /srv/the-repo:/workspace \
  -v /srv/room-state:/state \
  -e GITHUB_APP_CLIENT_ID=... \
  -e GITHUB_APP_CLIENT_SECRET=... \
  -e COPILOT_GITHUB_TOKEN=... \
  -e COPILOT_ROOM_PUBLIC_URL=http://devbox.corp.local:3000 \
  -e COPILOT_ROOM_ORG=my-org/my-team \
  -e COPILOT_ROOM_HOSTS=alice,bob \
  -e COPILOT_ROOM_COOKIE_SECRET=$(openssl rand -hex 32) \
  copilot-room
```

`COPILOT_GITHUB_TOKEN` belongs to a service account with a Copilot seat.
The repo checkout at `/workspace` is what the agent edits; make its git
credentials whatever you want the agent to commit and push as.

Register `http://devbox.corp.local:3000/auth/github/callback` as the
GitHub App's callback URL. Internal hostnames are fine.

## Sign-in options

| Variable or flag | Effect |
|---|---|
| `GITHUB_APP_CLIENT_ID` / `_SECRET` | enables GitHub sign-in |
| `--org ORG[/TEAM]` | org or team members admitted as participants |
| `--public-github POLICY` | seed for other GitHub accounts (default: approve) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | enables Microsoft Entra ID sign-in |
| `--entra-group ID` | group members admitted as participants |
| `--entra-admission POLICY` | seed for other tenant users (default: approve) |
| `--guests POLICY`, `--guest-code CODE` | seed for guests (default: approve) and their join code |
| `--allow github:alice:member,entra:bob@corp.com:viewer` | pre-approved accounts |
| `--hosts alice,bob@corp.com` | GitHub logins or Entra UPNs with the host role |

POLICY is `off`, `approve`, `viewer` or `member`. Flags only seed the first
start; hosts change policies in the UI and the value persists in
`settings.json` under the state directory. Host decisions about individual
people are stored next to it in `admissions.json`.
Entra redirect sign-in needs an `https` public URL; the device code sign-in
does not.

## HTTPS

Optional. Terminate TLS in front (nginx, Caddy, a corporate ingress) and set
`--public-url https://...` so cookies are marked Secure. For a laptop,
`mkcert` plus a reverse proxy works.

## Guests

Guests are allowed by default and wait for a host. The join code is printed
at startup and shown to hosts in the UI; set it with `--guest-code`. Guests
are unverified and badged as such.

## Proxies

The room and the Copilot runtime honour `HTTPS_PROXY`. Corporate CA bundles
go in `NODE_EXTRA_CA_CERTS`.

## State

`--state-dir` (default `<repo>/.copilot-room`, git-ignored) holds the
transcript. The Copilot runtime keeps its own session state under
`~/.copilot/session-state/<sessionId>`; pass `--session-id` to resume a
specific one after a restart.
