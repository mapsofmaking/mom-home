# Fixtures

`atelier-du-canal.ttl` and `atelier-du-canal.json` are copied from maps_of_making
`tests/fixtures/space/` at commit `12bb32a` (Story 14.7): the space file as the map
reads it, in both formats. `src/lib/spacefile.test.ts` holds home's writer to the
Turtle one (the same draft values give the same statements). When the map's
reading changes, copy the new files and move this pin.

`handles.ttl` is copied from the same folder at commit `d5569bb` (maps_of_making #77, mom-home #39): every kind
of contact handle home writes, two of one kind, blank and named contact points. `src/lib/contacts.test.ts` holds
home's reader to it with the same handles the map's test expects (`tests/test_space_turtle.py`
`test_every_handle_home_writes_reaches_the_card`). Change it there first, then copy it here and move this pin.
