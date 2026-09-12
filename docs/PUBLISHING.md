# Publishing a release

A release publishes two artifacts from one git tag:

1. the npm package **`@dvm/gh-copilot-multiuser`**, which is what makes
   `npx @dvm/gh-copilot-multiuser` work, and
2. a Docker image at **`ghcr.io/divyavanmahajan/gh-copilot-multiuser`** for
   server mode.

Both are built by `.github/workflows/release.yml`, which runs on any tag
matching `v*` (and can be started by hand with *Run workflow*). You do not
publish from your laptop; you push a tag.

## One-time setup

There is no npm secret to configure. The npm job authenticates with the OIDC
token GitHub mints for that run, and npm decides whether to trust it from a rule
you add on npmjs.com - **trusted publishing**. The credential lives for the
length of one publish, so there is nothing in repository settings to leak,
rotate, or discover expired at the worst moment.

1. **Create the package by hand, once.** npm can only attach a trusted publisher
   to a package that already exists, and there is no pending-publisher flow, so
   the first version goes up from a laptop:

   ```sh
   npm login              # the account that owns the @dvm scope
   rm -rf dist
   npm publish            # prepublishOnly builds first
   ```

   A scope is an npm username or organisation, so `@dvm/gh-copilot-multiuser`
   requires the npm account `dvm`. Scoped packages are private unless told
   otherwise; `package.json` carries `"publishConfig": { "access": "public" }`
   so a hand publish cannot get this wrong, and the workflow passes
   `--access public` as well.

2. **Add the trusted publisher.** npmjs.com -> *Packages* ->
   **@dvm/gh-copilot-multiuser** -> *Settings* -> *Trusted publishing* -> *GitHub
   Actions*:

   | Field | Value |
   |---|---|
   | Organization or user | `divyavanmahajan` |
   | Repository | `gh-copilot-multiuser` |
   | Workflow filename | `release.yml` |
   | Environment | leave empty |

   The workflow filename is matched literally, and only the workflow named here
   may publish. Renaming or moving `.github/workflows/release.yml` stops
   releases until the rule is updated to match.

3. **Then remove the token.** An automation token that can still publish this
   package undoes the point of the exercise. Delete it at npmjs.com ->
   *Access Tokens*, and delete the `NPM_TOKEN` repository secret if one was ever
   added. The package's *Settings* -> *Publishing access* can also require
   trusted publishing and disallow tokens outright, which makes that removal
   enforced rather than remembered.

4. **Nothing for GHCR.** The Docker job authenticates with the workflow's own
   `GITHUB_TOKEN` via the `packages: write` permission declared on that job.

Two things the npm job depends on, both worth knowing before editing it:

- **`id-token: write`** on the job. Without it there is no OIDC token to
  exchange and the publish fails as unauthenticated.
- **npm 11.5.1 or newer**, which is why the job asks for Node 24. It asserts the
  version before publishing rather than letting an old npm fail confusingly at
  the end.

The npm package mirrors the repository name under the `@dvm` scope, but the
command it installs is still `copilot-room`. That mismatch is harmless: a package
shipping exactly one `bin` runs it whatever the package is called, so
`npx @dvm/gh-copilot-multiuser` starts a room.

## Cutting a release

```sh
git checkout main && git pull
npm ci
npm run typecheck && npm test && npm run build   # what CI will run
```

Bump the version - never edit `package.json` by hand, because `npm version`
also creates the matching commit and tag:

```sh
npm version patch       # or minor / major, or 1.2.3 for an exact version
git push origin main --follow-tags
```

`npm version` writes `v1.2.3` as the tag, which is exactly the pattern the
workflow listens for. Pushing with `--follow-tags` sends the commit and the
tag together; a tag that never reaches the remote publishes nothing.

The npm job re-checks that the tag matches `package.json`, so a hand-made tag
that disagrees with the manifest fails the build instead of publishing a
mislabelled package.

## Verifying

```sh
npx @dvm/gh-copilot-multiuser@1.2.3 --help
docker pull ghcr.io/divyavanmahajan/gh-copilot-multiuser:1.2.3
```

The image is also tagged `1.2` and `latest`. On npm, check the *Provenance*
badge on the package page: publishing over OIDC attaches provenance
automatically - attesting the package was built from this repository at that
commit - so the workflow does not pass `--provenance`, and should not be
"fixed" to.

## What ends up in the package

`package.json` sets `"files": ["dist"]`, so the tarball is `dist/` plus
`package.json`, `README.md`, and `LICENSE` - eight files, around 200 kB
packed and 700 kB unpacked at the time of writing. Source, tests, and docs
are not shipped. Treat those numbers as a sanity check rather than a
constant, and confirm before a release with:

```sh
npm publish --dry-run
```

which prints the exact file list and publishes nothing.

Two traps worth knowing:

- **tsup runs with `clean: false`** (`tsup.config.ts`), so `dist/` accumulates
  files across builds. Before a release build, `rm -rf dist` so a renamed or
  deleted module cannot ship as a leftover.
- **`prepublishOnly` runs `npm run build`**, so a manual `npm publish` cannot
  ship a stale or missing `dist/`. It costs an extra rebuild in CI, which is
  cheap insurance against publishing nothing but a `package.json`.

## The documentation site

The docs are also published to GitHub Pages at <https://divyavanmahajan.github.io/gh-copilot-multiuser/>. It is a separate
pipeline from the release above: the site follows `main`, not version tags, so
a documentation fix is live minutes after it merges without cutting a release.

`.github/workflows/pages.yml` runs on a push to `main` that touches `docs/`,
`README.md`, `scripts/build-site.mts`, or the manifest, and can also be started
by hand with *Run workflow*. It runs `npm run build:site` and deploys the
result.

**Setup once:** *Settings* -> *Pages* -> *Source: GitHub Actions*. Until that
is set the build goes green and the deploy step fails with "Pages site not
found".

### How the site is built

`scripts/build-site.mts` renders each markdown file to HTML and wraps it in a
shared shell with the navigation. It uses the same react-markdown pipeline the
room itself uses to render the agent's replies, so a page on the site and a
message in the transcript are formatted identically and there is no second
markdown dependency to keep in step.

Build it locally exactly as CI does:

```sh
npm run build:site      # writes dist/site
```

Then open `dist/site/index.html` in a browser. The output is plain files with
relative links, so `file://` works; no server is needed.

Two details worth knowing before changing it:

- **Adding a document means adding it to `PAGES`** in `scripts/site-config.ts`,
  and to the list in `README.md`. A markdown link to a file that is not in
  `PAGES` is rewritten to point at GitHub rather than 404ing on the site.
- **Heading ids follow GitHub's slugger**, including that runs of spaces are
  not collapsed, so a table of contents written for GitHub keeps working once
  published. `.nojekyll` is written into the output so Pages serves what the
  build produced instead of running Jekyll over it.

### Where the URLs come from

The project's own address is one fact, in `scripts/site-config.ts`. It resolves
in this order:

1. `SITE_URL` and `REPO_URL` from the environment. The Pages workflow sets
   them from `actions/configure-pages`, so a build always describes where it is
   actually being published.
2. `GITHUB_REPOSITORY`, which every Actions run sets, giving the conventional
   `https://<owner>.github.io/<name>`.
3. `package.json` - `homepage` and `repository` - for a local build.

Markdown cannot read a constant, so README.md and the documents carry literal
URLs. `npm run sync:site-url` rewrites them from whatever the above resolves
to, and the Pages workflow runs it on every push: **a fork, a transfer or a
rename corrects its own links and commits the result**, rather than advertising
the repository it came from. That commit touches paths this workflow watches,
so it triggers one further run, which finds nothing to change and stops.

Locally:

```sh
npm run sync:site-url              # rewrite to match package.json
npm run sync:site-url -- --check   # fail if anything disagrees
```

`test/site.test.ts` makes the same assertion, so a drifted URL fails the test
suite rather than waiting to be noticed by a reader.

## Publishing by hand

Only if the workflow is broken, and only if the package's publishing access
still permits tokens - see step 3 above. You lose provenance, because npm can
only attest to a build it ran:

```sh
npm login
rm -rf dist
npm publish          # prepublishOnly builds first
```

## Fixing a bad release

Do not unpublish. npm only allows it within 72 hours and it breaks anyone who
already installed the version; the version number is then burned forever.
Publish a fixed patch version and mark the bad one:

```sh
npm deprecate @dvm/gh-copilot-multiuser@1.2.3 "Broken release, use 1.2.4"
```

If a secret leaks into a published tarball, treat the secret as compromised and
rotate it - removing the version does not remove copies.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ENEEDAUTH` or `E404` on publish, `actions/setup-node` older than v7 | with `registry-url` set, those versions write `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc` even when nothing sets that variable. npm reads the empty line as "already authenticated" and never attempts the OIDC exchange. v7 removed the placeholder; on an older version, strip the line after `setup-node` runs with `sed -i '/_authToken/d' "${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"` |
| `ENEEDAUTH` on setup-node v7 | no trusted publisher matches this run - check the workflow filename on npmjs.com, and that `id-token: write` is on the job |
| `npm 10.x is older than 11.5.1` | the job's Node version was lowered; trusted publishing needs npm 11.5.1+ |
| `E404` on the very first publish | trusted publishing cannot create a package - publish the first version by hand (setup step 1) |
| `E403` on publish | the signed-in account does not own the `@dvm` scope, or the name is taken |
| Package published private | both `--access public` and `publishConfig.access` were removed; a scoped package defaults to private |
| `tag v1.2.3 != package.json 1.2.4` | tag made by hand; delete it and use `npm version` |
| Provenance badge missing | the repo must be public, and `package.json` needs a `repository` field |
| Workflow never ran | the tag was not pushed - `git push origin v1.2.3` |
