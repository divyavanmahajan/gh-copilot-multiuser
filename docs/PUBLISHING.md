# Publishing a release

A release publishes two artifacts from one git tag:

1. the npm package **`copilot-room`**, which is what makes `npx copilot-room`
   work, and
2. a Docker image at **`ghcr.io/divyavanmahajan/gh-copilot-multiuser`** for
   server mode.

Both are built by `.github/workflows/release.yml`, which runs on any tag
matching `v*` (and can be started by hand with *Run workflow*). You do not
publish from your laptop; you push a tag.

## One-time setup

1. **npm account and token.** Sign in at npmjs.com, then *Access Tokens* ->
   *Generate New Token* -> **Automation** (it bypasses 2FA, which interactive
   tokens cannot do in CI).
2. **Repository secret.** GitHub repo -> *Settings* -> *Secrets and variables*
   -> *Actions* -> *New repository secret*, named `NPM_TOKEN`.
3. **Nothing for GHCR.** The Docker job authenticates with the workflow's own
   `GITHUB_TOKEN` via the `packages: write` permission already declared in the
   workflow.
4. **Check the name is free.** `npm view copilot-room version` returning a 404
   means the name is still available. If someone takes it first, change `name`
   in `package.json` to a scoped one (`@yourorg/copilot-room`) - scoped packages
   also need `--access public`, which the workflow already passes.

The npm package name (`copilot-room`) deliberately differs from the repository
name (`gh-copilot-multiuser`); only the repository name appears in the image
tag.

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
npx copilot-room@1.2.3 --help
docker pull ghcr.io/divyavanmahajan/gh-copilot-multiuser:1.2.3
```

The image is also tagged `1.2` and `latest`. On npm, check the *Provenance*
badge on the package page: the workflow publishes with `--provenance`, which
attests the package was built from this repository at that commit.

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

## Publishing by hand

Only if the workflow is broken. You lose provenance, because npm can only
attest to a build it ran:

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
npm deprecate copilot-room@1.2.3 "Broken release, use 1.2.4"
```

If a secret leaks into a published tarball, treat the secret as compromised and
rotate it - removing the version does not remove copies.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ENEEDAUTH` in CI | `NPM_TOKEN` missing, expired, or not an Automation token |
| `E403` on publish | name taken by someone else, or the token lacks publish rights |
| `tag v1.2.3 != package.json 1.2.4` | tag made by hand; delete it and use `npm version` |
| Provenance step fails | the repo must be public, and `package.json` needs a `repository` field |
| Workflow never ran | the tag was not pushed - `git push origin v1.2.3` |
