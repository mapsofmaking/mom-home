# staging/: what test.mapsofmaking.org serves

Pages shown before they are real, for the networks Maps of Making talks to.
None of it is the app: Vite never reads this folder, `tsc` doesn't either, and
nothing here ends up on home.mapsofmaking.org. It is not a demo mode inside the
app (kit ADR 005 still holds): it is a separate site, with its own image.

| Path | What |
|---|---|
| `site/index.html` | The landing page |
| `site/tour/index.html` | The tour: seven scenes, next and back. Hand-written, no build |
| `dry-run.html` | The dry run's source, also published as a claude.ai artifact |
| `site/dry-run/fonts/` | The dry run's fonts, served from this host |
| `build.mjs` | Makes `dist-staging/`: `site/` as it is, plus `dry-run/index.html` |
| `test/` | Builds the pages and walks them in jsdom (part of `npm test`) |
| `Dockerfile` | The image `ghcr.io/mapsofmaking/mom-staging` |

## The dry run reads the app's tree

`dry-run.html` keeps a copy of `public/onboarding.ttl` so the artifact runs on
its own. The build replaces that copy with the app's current file, and drops
the Google Fonts and jsDelivr tags: the gateway lets these pages call no other
host. So a tile or a `ui*` key renamed in the tree shows up in the dry run at
the next build, and the tests in `test/` fail if it breaks something.

The artifact's copy can lag; refresh it when the tree changes in a way worth
showing there.

## Build and try

```bash
npm run staging                     # -> dist-staging/
npx vite preview --outDir dist-staging   # or any static server
npx vitest run staging/             # the staging tests alone
```

## Deploy

CI builds the image on every pull request and publishes
`ghcr.io/mapsofmaking/mom-staging:sha-<commit>` and `:main` on every push to
`main`. On the server, the stack lives in
[vps-infra](https://github.com/mapsofmaking/vps-infra) (`staging/`); to update:

```bash
cd /srv/infra/staging && docker compose pull && docker compose up -d
```
