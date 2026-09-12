# Licensing: who needs a Copilot seat

> **Short answer.** Every human whose work the agent performs needs their own
> Copilot seat. A room does not let one licensed account serve several people.
> Neither Copilot Business nor Copilot Enterprise changes that, and buying
> through Microsoft rather than GitHub makes it more explicit, not less.

This is a summary for people deciding whether to run a room, not legal advice.
Terms change; check the current ones with whoever owns licensing at your
organisation before relying on any of this.

## Why this project has to say something

`copilot-room` runs **one** Copilot session and lets a team drive it. The
runtime authenticates as a single account — the host's CLI login, or a
`COPILOT_GITHUB_TOKEN`. Everyone else prompts through the browser.

That shape is exactly the thing licensing terms are written about. It is worth
being clear about it up front, because the architecture makes it look as though
one seat is doing the work of five.

## If you buy Copilot from GitHub

Copilot Business and Copilot Enterprise sit under the same document, the
**GitHub Copilot Product Specific Terms**, which apply when those plans are
purchased directly from GitHub. Underneath them, the **General Terms** are what
matter here: a licence is for **one individual End User**, and **End User
accounts may not be shared by individuals**.

Seat mechanics follow from that. A seat is assigned to a unique user account.
The Enterprise-specific billing rules are all about *not double-paying for the
same person* — a user with seats in several organisations inside one enterprise
is billed once, and where both a Business and an Enterprise seat exist only the
enterprise seat is billed. That is deduplicating one human, which is the
opposite of allowing several humans on one seat.

**There is no Enterprise carve-out for seat sharing.**

## What Enterprise actually adds

Shared *context*, not shared *sessions*:

- codebase indexing across private repositories
- Copilot Chat inside GitHub.com
- knowledge bases grounding Chat in documentation, runbooks and wikis
- pull request summaries

A whole team can draw on the same indexed corpus, but each person prompts from
their own seat and their own identity — Copilot Spaces, for example, still
spends one premium request per user prompt. **The artefact is shared; the
interaction is not.**

One thing genuinely is pooled: included credits are pooled at the billing
entity level for Business and Enterprise, rather than each user holding a fixed
allowance. That is a **shared budget, not a shared licence**. The distinction is
worth stating plainly inside a team, because "we have a pooled enterprise pool"
is the phrasing that leads people to assume shared access is fine.

## Where Enterprise cuts against sharing

Enterprise adds SCIM provisioning on top of SAML, so identity is bound to your
directory and every seat maps to a directory principal, with fine-grained audit
events.

If the hope is that enterprise-grade administration makes a shared automation
identity defensible, it does the reverse: **a shared service account acting as a
Copilot proxy is more visible under that regime, and easy to demonstrate after
the fact.**

## If you buy through a Microsoft agreement

Large organisations often do. In that case the GitHub-hosted terms do not
govern; the **Microsoft Product Terms** do, and they bring in **multiplexing**,
which is a Universal License Term applying to all Microsoft products:

> Hardware or software you use to multiplex or pool connections, or reduce the
> number of devices or users that access or use the software, does not reduce
> the number of licences you need.

Microsoft's guidance on this is blunt: there is no such thing as *unlicensed
user access*, and users who access or receive information from content provided
by an automated process must be appropriately licensed, however many tiers sit
between them and the product.

A workflow that authenticates as one licensed user and serves requests from
many people is the textbook multiplexing pattern, and the Product Terms say it
does not reduce the seat count. This is a more explicit answer than anything
GitHub publishes on the question.

## So, who needs a seat?

| | Needs a seat |
|---|---|
| Anyone who submits prompts — host, member | **Yes.** Their work is what the agent performs. |
| The account the runtime authenticates as | **Yes**, and it does not cover anyone else. |
| A viewer who only watches | **Ask.** Under the Microsoft multiplexing language, receiving output of an automated process is not obviously exempt. Treat "watching" as the conservative case and check. |
| Someone reading the transcript afterwards | **Ask**, for the same reason. |

The practical test is not which Copilot tier you hold. It is **whether each
human whose work the agent performs holds a seat**. The purchasing channel
changes only which clause you cite:

| Bought from | Governing terms | The clause |
|---|---|---|
| GitHub | Copilot Product Specific Terms + General Terms | one individual End User; accounts may not be shared |
| Microsoft | Microsoft Product Terms | multiplexing does not reduce licences |

## What this means for running a room

- **Give every participant their own seat.** Then the room is a shared view of
  one session that licensed people are driving, not a way around seat count.
- **Do not run a room as a shared service account for unlicensed colleagues.**
  That is the pattern both sets of terms are written against.
- **The room helps you show this.** Every prompt is attributed and recorded in
  the transcript with the author's identity, so who drove what is a matter of
  record rather than reconstruction. The same audit trail that makes a shared
  room reviewable also makes an unlicensed one obvious.
- **Guest sign-in is for convenience inside a licensed team**, not a way to
  bring unlicensed people to a seat. Guests are unverified and badged as such;
  that badge is a licensing signal as much as a security one.

If you are unsure which agreement you are under, the answer is usually with
whoever negotiated your GitHub or Microsoft contract. It is worth knowing
before a room becomes part of how your team works rather than after.
