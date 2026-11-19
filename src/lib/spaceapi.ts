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
 */
import type { Draft } from "../workbench/previews";
import { matrixRoom, plainIri, requiredParts, type SpaceFile } from "./spacefile";

export interface SpaceApi {
  json: string;
  /** Draft fields left out of the file because their value was not a web address (or a room). */
  dropped: SpaceFile["dropped"];
}

export function spaceApiJson(draft: Draft): SpaceApi {
  const { name, town, country, lat, lon } = requiredParts(draft);
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

  // "<street>, <postcode> <city>, <CC>"; without a street "<postcode> <city>, <CC>" (the order the map reads).
  const street = (draft.street ?? "").trim();
  const locality = [(draft.postcode ?? "").trim(), town].filter(Boolean).join(" ");
  out.location = {
    address: [street, locality, country].filter(Boolean).join(", "),
    country_code: country,
    lat: Number(lat),
    lon: Number(lon),
  };

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
  if (Object.keys(contact).length) out.contact = contact;

  const hours = (draft.hours ?? "").trim();
  if (hours) out.opening_hours = hours;

  out.state = { open: null };
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
