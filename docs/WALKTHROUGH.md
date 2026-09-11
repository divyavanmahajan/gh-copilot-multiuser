# Walkthrough: from zero to a team driving one Copilot agent

This is the end-to-end path for a team lead setting the room up for the
first time, then a colleague joining. Budget about thirty minutes, most of
it the GitHub App registration.

## 0. What you need

| | Laptop mode | Server mode |
|---|---|---|
| Machine | your laptop, on the office network or VPN | a shared VM or container host |
| Node | 22 or newer | 22 or newer (or just Docker) |
| Copilot | your own Copilot CLI login | a service account token with a Copilot seat |
| GitHub App | one, device flow enabled | one, callback URL registered |
| Network | colleagues can reach your hostname:port | colleagues can reach the server |

Colleagues need a browser and a GitHub account in your org. Nothing to install.

## 1. Register the GitHub App (once per org)

1. Org settings → Developer settings → GitHub Apps → New GitHub App.
2. Name it, e.g. `copilot-room`. Homepage URL can be this repo.
3. Callback URL: `http://<hostname>:3000/auth/github/callback`. Internal
   hostnames are fine; the callback is a browser redirect and GitHub never
   contacts it. Laptop users on device flow do not need it but it does no harm.
4. Tick **Enable Device Flow**.
5. Tick **Request user authorization (OAuth) during installation**.
6. Permissions → Organization permissions → Members: **Read-only**.
7. Create the app. Copy the **Client ID**. Generate a **client secret** and copy it.
8. Install the app on your org (Install App in the left menu).

## 2. Check Copilot policies (org admin)

Org settings → Copilot → Policies: Copilot CLI must be enabled. If the SDK
is a preview feature for your enterprise, enable preview features.

## 3a. Laptop mode

```sh
# once
npm login       # only if your org uses a private registry mirror; otherwise skip
export GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxx
export GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxx

# every session
cd ~/src/the-repo
npx copilot-room --host 0.0.0.0 --org my-org/platform-team --hosts $USER
```

You should see:

```
copilot-room listening on http://0.0.0.0:3000 (repo: /Users/you/src/the-repo, mode: laptop)
[copilot-room] session 2f1c…  ready
```

The runtime signs in with the same credentials as your Copilot CLI. If you
have never used it, run `npx @github/copilot login` first, or set
`COPILOT_GITHUB_TOKEN` to a personal token that has Copilot access.

Tell colleagues: `http://<your-hostname>:3000`. Find the hostname with
`hostname -f` (macOS/Linux) or `hostname` (Windows).

## 3b. Server mode

```sh
docker run -d --name copilot-room -p 3000:3000 \
  -v /srv/the-repo:/workspace \
  -v /srv/copilot-room-state:/state \
  -e GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxx \
  -e GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxx \
  -e COPILOT_GITHUB_TOKEN=ghp_serviceaccount \
  -e COPILOT_ROOM_PUBLIC_URL=http://devbox.corp.local:3000 \
  -e COPILOT_ROOM_ORG=my-org/platform-team \
  -e COPILOT_ROOM_HOSTS=alice,bob \
  -e COPILOT_ROOM_COOKIE_SECRET=$(openssl rand -hex 32) \
  ghcr.io/divyavanmahajan/gh-copilot-multiuser:latest
docker logs -f copilot-room
```

The repo under `/workspace` is what the agent edits. Give it git
credentials for whatever identity you want commits pushed as.

## 4. A colleague joins

1. Open the URL. The login page shows the room name and the sign-in options
   the host enabled: GitHub, Microsoft, or a guest code.
2. Laptop mode: click the **device code** button for GitHub or Microsoft,
   open the link in a new tab, enter the code. Server mode: click the
   sign-in button and approve.
3. What happens next depends on who you are:
   - Listed in `--hosts`: you are in as a host.
   - Member of the allowed GitHub org or team, or of the Entra group: you
     are in as a participant.
   - On the allow list, or admitted by a host before: you are in with that
     role.
   - Everyone else, by default: you see **Waiting for a host**. Keep the
     tab open. A host can change this default per sign-in type (see 4a).
4. The room opens: transcript in the middle, participants and queue on the
   right, prompt box at the bottom. Your name and role sit top right.

## 4a. Admitting people (hosts)

Host approval is the default for every sign-in type: GitHub, Microsoft and
guests. When someone signs in who is not a host, not an org, team or group
member, not on the allow list and not previously admitted, a green card
appears at the top of every host's transcript and the tab title shows a
count:

> Waiting to join · signed in with GitHub · 10:42
> **Dana Example** `dana-gh`
> [Admit as participant] [Admit as viewer] [Reject]

Decisions are remembered in `admissions.json` in the state directory, so
Dana gets straight in next time, and a rejected account stays out until a
host changes it. Hosts can also promote, demote or remove anyone from the
participants panel with the arrow and cross buttons.

### Changing the admission policy

Hosts see an **Admission** panel on the right with one setting per sign-in
type:

| Setting | Effect on people outside the automatic gates |
|---|---|
| Host approves (default) | wait at the door until a host decides |
| Admit as viewer | in immediately, view-only; a host can promote later |
| Admit as participant | in immediately, can prompt |
| Refuse | 403 at sign-in |

The change takes effect for the next sign-in and is saved to
`settings.json` in the state directory, so it survives restarts. Command
line flags (`--public-github`, `--entra-admission`, `--guests`) only seed
the value on the very first start; after that the saved setting wins. The
panel also shows the guest join code when guests are allowed.

## 4b. Signing in with Microsoft Entra ID

Set three environment variables and the Microsoft button appears:

```sh
export ENTRA_TENANT_ID=00000000-0000-0000-0000-000000000000
export ENTRA_CLIENT_ID=11111111-1111-1111-1111-111111111111
export ENTRA_CLIENT_SECRET=...        # omit if the app allows public client flows only
npx copilot-room --host 0.0.0.0 --entra-group <group-object-id> --hosts alice@corp.com
```

Everyone in the tenant may sign in. With `--entra-group`, members of that
group are participants at once; everyone else follows the Microsoft
admission setting, which defaults to host approval. `--hosts` accepts
Entra user principal names alongside GitHub logins. The app registration
steps are in ENTERPRISE-SETUP.md.

Entra only accepts `https` redirect URIs (except localhost), so on a plain
HTTP LAN use the **device code** button; it needs no redirect at all.

## 5. Driving the agent together

- **Send** a prompt when the status reads *idle*. It runs immediately and
  everyone sees the streamed reply, tool calls, and file edits.
- **Queue** a prompt while a turn is running. It sits in the right-hand
  panel with your name, and starts when the agent goes idle. You can
  withdraw it until then; a host can withdraw anyone's.
- **Approvals.** When Copilot wants to run a command, write a file or fetch
  a URL, a card appears for everyone. Only the author of the running prompt
  (and hosts) get the buttons. No answer in two minutes means reject.
- **Abort.** A host can stop the running turn from the header.
- **Attribution.** The agent sees `[alice]: …` and `[bob]: …`, so ask it
  "what did Bob ask for earlier" and it knows.
- **Late joiners** get the transcript replayed on entry.

## 5a. Server mode without a host online

The admission card needs a host in the room. On a shared server nobody may
be there when someone signs in, so use the automatic paths and keep host
approval as the exception:

- **Org, team, tenant or group gate.** `--org my-org/team` and
  `--entra-group <id>` admit members with no human involved. This is the
  primary path for a company deployment.
- **Allow list.** `--allow github:alice:member,entra:bob@corp.com:viewer`
  (or `COPILOT_ROOM_ALLOW`) pre-approves named people, including partners
  from another org.
- **Remembered decisions.** Once a host has admitted someone, the decision
  in `admissions.json` lets them in on every later visit, host or no host.
- **Default viewer.** Set a sign-in type to *Admit as viewer* in the
  Admission panel (or seed it with `--public-github viewer`); outsiders can
  watch immediately and a host promotes them when one is around.
- **Waiting still works.** People who do end up waiting stay on the waiting
  screen, and the next host to connect sees the cards and can decide.

## 6. Guests without GitHub or Microsoft accounts

Guests are people with only a name and the join code. They are allowed by
default and, like everyone else, wait for a host to admit them. The join
code is printed at startup and shown in the hosts' Admission panel; pin it
with `--guest-code`:

```sh
npx copilot-room --host 0.0.0.0 --org my-org --guest-code kiwi-42
```

Switch guests to *Refuse* in the Admission panel (or seed `--guests off`)
for a members-only room. Guests are badged in the UI and transcript and
can never be hosts. Think twice before admitting guests as participants
unless everyone in the room holds a Copilot seat anyway.

## 7. Stopping and resuming

Ctrl-C stops the room. Start it again the same way and pass
`--session-id <id>` (printed at startup and shown in the header) to pick
up the same Copilot conversation. The attributed transcript lives in
`.copilot-room/transcript.jsonl` inside the repo (git-ignored) or in
`/state` for Docker.

## 8. Releasing a new version (maintainers)

```sh
npm version minor          # bumps package.json and creates the git tag
git push --follow-tags
```

The Release workflow publishes `copilot-room` to npm (needs the `NPM_TOKEN`
repository secret) and pushes the Docker image to GitHub Container
Registry. Users then get the new version with `npx copilot-room@latest` or
`docker pull ghcr.io/divyavanmahajan/gh-copilot-multiuser:latest`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Startup hangs after "listening" never prints | runtime cannot authenticate | run `npx @github/copilot login` or set `COPILOT_GITHUB_TOKEN` |
| "you are not a member of the allowed organization" | org/team gate | check `--org`, and that the user's membership is public or the app has Members: read |
| Device flow says "failed: incorrect_client_credentials" | wrong client id | re-copy from the app page |
| Browser redirect sign-in loops | callback URL mismatch | the app's callback must equal `--public-url` + `/auth/github/callback` |
| Colleagues get connection refused | bound to localhost | add `--host 0.0.0.0` |
| "Waiting for a host" never ends | no host connected | a host opens the room, or use `--allow` / set the type to *Admit as viewer* |
| Microsoft redirect sign-in fails with AADSTS50011 | redirect URI mismatch or http | register `<public-url>/auth/entra/callback` (https) or use the device code |
| Microsoft device code fails with AADSTS7000218 | public client flows disabled | enable "Allow public client flows" on the app registration |
| Entra group gate rejects members | `groups` claim missing | add the groups claim to the ID token in Token configuration |
| Cookie not set over HTTP | `--public-url` is https | use an http public URL, or terminate TLS |
| Corporate proxy errors | proxy not honoured | set `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` |
