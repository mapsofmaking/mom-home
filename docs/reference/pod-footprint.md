# What home leaves on a pod

Everything home writes, on a coordinator's pod and elsewhere. The source is
[`src/lib/footprint.ts`](../../src/lib/footprint.ts): home's section of
`settings/README.md` on the pod is written from it, and
`src/lib/footprint.test.ts` fails when the code gains a write this list hasn't
been told about, or when an id below is missing.

How an app declares this on the pod for other apps to read is decided in
[solid-kit#22](https://github.com/nicolasdb/solid-kit/issues/22); until then
the README section is the declaration. Removing it all is
[solid-backoffice#16](https://github.com/nicolasdb/solid-backoffice/issues/16).

| id | Kind | Where | What |
|---|---|---|---|
| `space-file` | own | `space.ttl` | the space's file; tile A writes it, tile C changes one statement, or the address and the pin together when the space moves |
| `space-acl` | own | the rules of `space.ttl` | anyone may read that one file |
| `logo-file` | own | `logo` and its rules | the logo, readable by anyone; one address whatever its type |
| `settings-file` | own | `settings/mom-home.ttl` | the fold, the tutorials seen |
| `readme-section` | entry | `settings/README.md` | home's section, between its markers; the whole file if home made it |
| `public-index-entry` | entry | `settings/publicTypeIndex.ttl#mom-space` | where the space file is |
| `private-index-entry` | entry | `settings/privateTypeIndex.ttl#mom-home-settings` | where the settings file is |
| `indexes` | plumbing | `settings/publicTypeIndex.ttl`, `privateTypeIndex.ttl`, `prefs.ttl` | made only if the pod had none |
| `profile-links` | plumbing | the profile | `solid:publicTypeIndex`, `pim:preferencesFile`, added only if missing |
| `account` | outside | the pod server | the account and pod, when made in home (tile B) |
| `map-registration` | outside | the map | the file's address, and the map's copy of it |

## Kinds

- **own**: home's file. Removing it removes nothing of anyone else's.
- **entry**: home's part of a file other apps share. Only that part is home's.
- **plumbing**: standard Solid files and links home made only because the pod
  lacked them (pods older than solid-css-overlay 7.3.0-1). They are the pod's:
  leaving home never removes them.
- **outside**: not on the pod. Leaving the map is
  [maps_of_making#73](https://github.com/mapsofmaking/maps_of_making/issues/73);
  deleting the account, [solid-css-overlay#17](https://github.com/nicolasdb/solid-css-overlay/issues/17).

## The README rule

`settings/README.md` is shared. Home writes the whole file only when there is
none, or when it still says exactly what home's first version said. Otherwise
it changes only the text between `<!-- mom-home: start -->` and
`<!-- mom-home: end -->`, or adds that section at the end if it isn't there.
Every write is conditional (`If-None-Match: *` or `If-Match`), and markers it
can't make sense of leave the file alone. A marker counts only alone on its
line and outside a code fence. Only a `text/markdown` or `text/plain` README
under 256 KB is touched, and it keeps its type; line endings are written back
as LF. Brought up to date after home
registers the space, after it first writes its settings, and at sign-in when
the space is on the pod.
