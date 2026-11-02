# Fixtures

`atelier-du-canal.ttl` and `atelier-du-canal.json` are copied from maps_of_making
`tests/fixtures/space/` at commit `12bb32a` (Story 14.7): the space file as the map
reads it, in both formats. `src/lib/spacefile.test.ts` holds home's writer to the
Turtle one (the same draft values give the same statements). When the map's
reading changes, copy the new files and move this pin.
