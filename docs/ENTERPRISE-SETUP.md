# Enterprise setup checklist

For a GitHub Enterprise Cloud org running Copilot Enterprise.

## Org admin

1. **Copilot policies.** Enable the Copilot CLI policy for the org. If the
   SDK is still a preview feature for your enterprise, enable preview
   features too.
2. **Create a GitHub App** (Settings → Developer settings → GitHub Apps) in
   the org, not an OAuth App. Enterprise orgs commonly block third-party
   OAuth Apps; a GitHub App installed by the org avoids that.
   - Callback URL: `<public-url>/auth/github/callback` (server mode).
   - Enable **Device Flow** (laptop mode).
   - Permissions: Organization → Members: Read-only (for the org/team gate).
   - Request user authorization (OAuth) during installation: on.
   - Note the client id, generate a client secret.
3. **Install the app** on the org.
4. **Service account** (server mode only): a user with a Copilot Enterprise
   seat whose token the room uses as `COPILOT_GITHUB_TOKEN`. Its Copilot
   premium requests are what the room consumes.
5. **Confirm the usage pattern.** Several seat holders steering one session
   billed to one account is not the default Copilot model. Check it against
   your agreement before rolling out, and keep `--guests participate` off
   unless everyone in the room holds a seat anyway.

## Microsoft Entra ID (optional, for sign-in without GitHub)

1. Entra admin center → App registrations → New registration.
   Single tenant. Redirect URI (Web): `<public-url>/auth/entra/callback`.
   Entra requires `https` here unless the host is `localhost`.
2. Authentication → **Allow public client flows: Yes** if laptops will use
   the device code sign-in (recommended on a plain-http LAN).
3. Certificates & secrets → new client secret (server mode). Laptop mode
   with device code works without one.
4. Token configuration → Add groups claim → Security groups, if you want
   `--entra-group` gating. Keep group membership small enough to avoid the
   groups-overage case, or gate on org membership instead.
5. API permissions: the default `openid`, `profile`, `email` are enough.
   Grant admin consent so users are not prompted.
6. Note the **Directory (tenant) ID** and **Application (client) ID**.

Room settings: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`,
`--entra-group`, `--entra-admission`. Hosts are named by user principal
name in `--hosts`.

## Admission

By default any GitHub or Microsoft account, and any guest with the join
code, can sign in and then waits for a host to admit them as viewer or
participant. Org, team and group members skip the wait. Hosts change the
per-type policy in the UI (host approves, admit as viewer, admit as
participant, refuse) and the setting persists in `settings.json`. Decisions
about individuals are stored in `admissions.json`; review it periodically
and delete entries to revoke. `--allow` pre-approves named accounts for
servers with no host online.

## Licensing

Every person whose work the agent performs needs their own Copilot seat. A
room is a shared view of one session, not a way for one seat to serve several
people, and neither Copilot Business nor Copilot Enterprise changes that. If
you buy through a Microsoft agreement rather than from GitHub, the multiplexing
term in the Microsoft Product Terms says so more explicitly still.

Settle this before a room becomes part of how a team works:
[LICENSING.md](LICENSING.md).

## Skills and custom agents

The room reads the repository's own `.github/skills/`, `.github/agents/`,
`.claude/skills/` and `.claude/agents/` at startup, and offers them to
everyone in the room behind `/` and `@`.

This is a review surface, not just a convenience. **Anyone who can merge a
change to those folders changes what the shared agent does for everyone**,
including the instructions a custom agent runs under. Treat them the way you
treat CI configuration:

- Put `.github/agents/` and `.github/skills/` behind CODEOWNERS review.
- Remember an agent definition is a prompt, not a sandbox. A `tools:` list
  narrows what it may call, but the instruction "never edit files" is
  guidance to a model, not an enforced boundary. The real boundary is where
  you run the runtime.
- `/refresh` re-reads edited definitions without a restart, so a merge can
  change behaviour mid-session.

## Room host

- Set `--org my-org` or `--org my-org/team-slug` so only members can join.
- Set `--hosts` to the logins who may abort turns and answer any permission
  prompt.
- Run the runtime somewhere you would be comfortable letting a colleague run
  arbitrary shell commands: a container, a VM, or a dedicated worktree.
- Set `COPILOT_ROOM_COOKIE_SECRET` so a restart does not sign the room out.

## Users

Nothing to install: a browser, and whichever sign-in the room was started
with - a GitHub account in the org, a Microsoft work account, or the guest
join code. What they can do once inside is in
[USER-GUIDE.md](USER-GUIDE.md).
