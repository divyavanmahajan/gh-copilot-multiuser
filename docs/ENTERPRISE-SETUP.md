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

## Room host

- Set `--org my-org` or `--org my-org/team-slug` so only members can join.
- Set `--hosts` to the logins who may abort turns and answer any permission
  prompt.
- Run the runtime somewhere you would be comfortable letting a colleague run
  arbitrary shell commands: a container, a VM, or a dedicated worktree.

## Users

Nothing to install. A browser and a GitHub account in the org.
