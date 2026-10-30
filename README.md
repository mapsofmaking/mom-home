# mom-home

The Maps of Making home app, at `home.mapsofmaking.org`. One app, two modes:

- **Signed out:** onboarding. A makerspace describes itself, then publishes
  its file, on a pod or on its own host.
- **Signed in:** through the space's pod, the same page becomes the workbench.
  It is a hex view of what the coordinator can do next. Each tile's state is
  read from the pod, never stored as progress.

The plan is Epic 14 in
[maps_of_making](https://github.com/mapsofmaking/maps_of_making). The stories
are in `_bmad-output/implementation-artifacts/14-*.md`. The rules for where
each tile sits are in `docs/explanation/home-hex-view.md`.

**Kit version:** copied from
[`solid-kit`](https://github.com/nicolasdb/solid-kit) at `f880797`. Every
divergence from the kit is a diff against that commit.

## The tree

`public/onboarding.ttl` holds the tiles, their positions and their
requirements. It also holds the cues, the words and every line Bernard speaks
in the app. It is the only copy of that text, so a change of wording is an
edit to that file. The `onb:` vocabulary is a draft. It moves to the
Maps of Making ontology once it is stable.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run verify   # typecheck + tests + audit
```

`/api/` is the map's API (geocode, register, heartbeat). In dev it is proxied
to the map's own stack on `localhost:8080`: run
`docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up`
in maps_of_making.

## Deploy

CI builds one image on every push to `main` and publishes it as
`ghcr.io/mapsofmaking/mom-home:sha-<commit>`. Setup and each release:

1. On the server, `docker-compose.yml` runs the tag set in `HOME_TAG`.
2. The container writes `/id.jsonld`, the Solid-OIDC Client ID Document, at
   start from `PUBLIC_URL` (default `https://home.mapsofmaking.org/`).
3. Routing lives in [mapsofmaking/vps-infra](https://github.com/mapsofmaking/vps-infra):
   `gateway/sites/mom-home.caddy` sends `/` to this container and `/api/` to
   the map (`maps-web`). It needs DNS for `home.mapsofmaking.org` first.
4. On the server (`/srv/mom-home`), `.env` beside `docker-compose.yml` sets
   `HOME_TAG`.
