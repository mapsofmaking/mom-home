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

Both `atelier-du-canal` files were checked again against maps_of_making `c349f22` (`mom-vps`): unchanged since
`12bb32a`, and `handles.ttl` too. `src/lib/spaceapi.test.ts` holds home's SpaceAPI writer to the JSON one.

`maakbib.ttl` and `maakbib.json` are copied from the same folder at commit `51ba3ad` (`mom-vps`, the merge of
maps_of_making #79, "networks-area"): a network as the map reads it, in both formats (it serves an area, has no
address, sits at the area's centre with its fidelity). `src/lib/spacefile.test.ts` holds home's Turtle writer
and reader to the `.ttl`, `src/lib/spaceapi.test.ts` the SpaceAPI writer to the `.json`: the Turtle read back
into a draft writes the same statements and the same JSON.

Both `maakbib` files then changed in step with the map (Nicolas, 2026-11-19): an area served is a node with its
code and its name (`schema:areaServed [ a schema:AdministrativeArea ; schema:identifier "BE-VLG" ; schema:name
"Flanders" ]`; in the JSON `{"code": "BE-VLG", "name": "Flanders"}`), since a network anywhere searches its area
by name. Only that line changed in each. The map's fixtures change to the same in its area-search PR: move the
pin to that commit once it is merged.
