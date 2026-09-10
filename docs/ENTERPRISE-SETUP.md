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

## Room host

- Set `--org my-org` or `--org my-org/team-slug` so only members can join.
- Set `--hosts` to the logins who may abort turns and answer any permission
  prompt.
- Run the runtime somewhere you would be comfortable letting a colleague run
  arbitrary shell commands: a container, a VM, or a dedicated worktree.

## Users

Nothing to install. A browser and a GitHub account in the org.
