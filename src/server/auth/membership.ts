/**
 * Access gate: is this GitHub user a member of the allowed org (or team)?
 * Uses the user's own token, so the room needs no admin credentials.
 */
export interface MembershipCheck {
  org: string;
  team?: string;
}

export async function isMember(
  apiBase: string,
  userToken: string,
  login: string,
  allowed: MembershipCheck,
): Promise<boolean> {
  const headers = { Authorization: `Bearer ${userToken}`, Accept: "application/vnd.github+json", "User-Agent": "copilot-room" };
  const url = allowed.team
    ? `${apiBase}/orgs/${allowed.org}/teams/${allowed.team}/memberships/${login}`
    : `${apiBase}/user/memberships/orgs/${allowed.org}`;
  const res = await fetch(url, { headers });
  if (res.status !== 200) return false;
  const body = (await res.json()) as { state?: string };
  return body.state === "active";
}
