/**
 * The space file for someone who looks after it themselves: SpaceAPI JSON (tile B's self-host door, 14.5),
 * converted from the same draft `spaceFile` writes as Turtle for the pod. The fields and their mapping are
 * maps_of_making `docs/reference/space-file.md` (the SpaceAPI JSON column); `test/fixtures/atelier-du-canal.json`
 * holds this writer to the map's reading.
 *
 * Same rules as the Turtle: the same three required parts (`requiredParts` throws `SpaceFileError`), and a web
 * address that isn't plain http(s) is left out and reported in `dropped`, never written as typed. Deterministic:
 * the same draft gives the same text, in the fixture's key order, pretty-printed.
 *
 * SpaceAPI's `contact` takes one of each of `email`, `phone`, `matrix`; the draft holds an email and a room.
 *
 * A network (2026-11-19) has no `location.address`: its `location` is the country its areas share (when they
 * share one) and the pin at their centre, and a `mom` block says the kind, the areas and the pin's fidelity.
 * `test/fixtures/maakbib.json` holds it.
 */
import type { Draft } from "../workbench/previews";
import { cleanContacts, draftLists, isNetwork, matrixRoom, networkParts, plainIri, requiredParts, type SpaceFile } from "./spacefile";

export interface SpaceApi {
  json: string;
  /** Draft fields left out of the file because their value was not a web address (or a room). */
  dropped: SpaceFile["dropped"];
}

/** SpaceAPI v15's contact keys that hold a link or a handle home can give back as a link. */
const SPACEAPI_CONTACT_KEYS = new Set(["twitter", "mastodon", "facebook", "identica", "foursquare"]);

export function spaceApiJson(draft: Draft): SpaceApi {
  const network = isNetwork(draft) ? networkParts(draft) : null;
  const space = network ? null : requiredParts(draft);
  const { name, lat, lon } = network ?? space!;
  const dropped: SpaceApi["dropped"] = [];
  const out: Record<string, unknown> = { api_compatibility: ["15"], space: name };

  // logo and url come before the location, as SpaceAPI lists them; a bad address is dropped like the Turtle's.
  const web: Partial<Record<"logo" | "website", string>> = {};
  for (const key of ["logo", "website"] as const) {
    if (!(draft[key] ?? "").trim()) continue;
    const value = plainIri(draft[key]);
    if (value) web[key] = value;
    else dropped.push(key);
  }
  if (web.logo) out.logo = web.logo;
  if (web.website) out.url = web.website;

  if (space) {
    // "<street>, <postcode> <city>, <CC>"; without a street "<postcode> <city>, <CC>" (the order the map reads).
    const { town, country } = space;
    const street = (draft.street ?? "").trim();
    const locality = [(draft.postcode ?? "").trim(), town].filter(Boolean).join(" ");
    out.location = {
      address: [street, locality, country].filter(Boolean).join(", "),
      country_code: country,
      lat: Number(lat),
      lon: Number(lon),
    };
  } else {
    // A network: no address; the country its areas share, when they share one.
    out.location = { ...(network!.country ? { country_code: network!.country } : {}), lat: Number(lat), lon: Number(lon) };
  }

  const description = (draft.description ?? "").trim();
  if (description) out.description = description;

  const contact: Record<string, string> = {};
  const email = (draft.email ?? "").trim();
  if (email) contact.email = email;
  if ((draft.matrix ?? "").trim()) {
    const room = matrixRoom(draft.matrix);
    if (room) contact.matrix = room;
    else dropped.push("matrix");
  }
  // The other handles (#73): a phone under SpaceAPI's own key; a link under the key it was imported from when
  // SpaceAPI has one (facebook, twitter, mastodon), else as an extension (`ext_signal`, `ext_link`). One per key.
  for (const h of cleanContacts(draft.contacts)) {
    const key = h.type === "phone" ? "phone" : h.key && SPACEAPI_CONTACT_KEYS.has(h.key) ? h.key : `ext_${h.type}`;
    if (!(key in contact)) contact[key] = h.value;
  }
  if (Object.keys(contact).length) out.contact = contact;

  const hours = (draft.hours ?? "").trim();
  if (hours) out.opening_hours = hours;

  // What an import brought (#73): topics at the top (where the map reads `knowsAbout`), networks and goals in `mom`.
  const lists = draftLists(draft);
  if (lists.knowsAbout) out.knowsAbout = lists.knowsAbout;

  out.state = { open: null };
  // Each area as `{code, name}`, in that order; a name not known (read from a #67 file) is left out, as in the Turtle.
  const areas = network?.areas.map((a) => (a.name ? { code: a.code, name: a.name } : { code: a.code }));
  const mom: Record<string, unknown> = network ? { kind: "network", areaServed: areas, geolocationFidelity: network.fidelity } : {};
  if (lists.memberOf) mom.memberOf = lists.memberOf;
  if (lists.sdgs) mom.sdgs = lists.sdgs;
  if (Object.keys(mom).length) out.mom = mom;
  return { json: JSON.stringify(out, null, 2) + "\n", dropped };
}

/** The name the downloaded file gets: the space's name as a slug, ".json". */
export function spaceApiFilename(draft: Draft): string {
  const slug = (draft.name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "space"}.json`;
}
