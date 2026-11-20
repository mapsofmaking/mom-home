/**
 * The other way from `spaceapi.ts` (#73): a space or network file someone already has, read by the map
 * (`POST /api/read-url`, maps_of_making #84: the browser can't fetch another origin) and turned into tile A's
 * draft. The coordinator then reviews every beat as when typing.
 *
 * Nothing is dropped silently (the repo's throw-not-truncate rule, here as a list): `notCarried` names what the
 * file holds and the draft can't, the map's `unmapped` first, then home's own: a contact other than email and
 * Matrix, a time zone, a country that isn't two letters, a network the map wouldn't read, an address a network
 * doesn't have. Tile A shows the list.
 *
 * The pin is the file's: its coordinates, and the town as the place, so the form doesn't ask the geocoder again
 * unless the street or town is changed. A country that isn't an ISO code is left empty: the form asks for it.
 * The address string ("<street>, <postcode> <city>, <CC>" as the map writes it, or any order a person wrote) is
 * split best-effort; the pin doesn't depend on it.
 */
import type { Draft } from "../workbench/previews";
import { areasCountry, cleanAreas, cleanFidelity, draftLists, matrixRoom, memberIri, plainIri } from "./spacefile";

/** The map's record (maps_of_making `infra/link_handler/read_record.py`). */
export interface ReadRecord {
  name: string | null;
  address: string | null;
  country_code: string | null;
  timezone: string | null;
  logo: string | null;
  url: string | null;
  description: string | null;
  opening_hours: string | null;
  geolocationFidelity: string | null;
  lat: number | null;
  lon: number | null;
  contact: Record<string, unknown>;
  memberOf: string[];
  sdgs: number[];
  knowsAbout: string[];
  areaServed: { code: string; name: string }[];
  kind: "space" | "network";
  unmapped: string[];
}

export interface ReadUrlAnswer {
  validation: { error?: string; reachable?: boolean; schema_valid?: boolean };
  record: ReadRecord | null;
}

/** What a field may hold: the same caps as typing (forwarded.ts), so an import is no longer than a person could type. */
const CAP = { name: 200, street: 300, city: 200, postcode: 30, description: 2000, email: 300, matrix: 300, url: 500, hours: 500 };

const text = (v: unknown, cap: number): string => (typeof v === "string" ? v.trim().slice(0, cap) : "");
const POSTCODE = /^(?=.*\d)[A-Z0-9][A-Z0-9 -]{2,8}$/i;

/** "Rue du Canal 12, 1000 Bruxelles, BE" → street, postcode, city. Best-effort; one part alone is the town. */
export function splitAddress(address: string): { street: string; postcode: string; city: string } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) parts.pop(); // the country, read apart
  let postcode = "";
  let city = "";
  // "1000 Bruxelles" (or "Bruxelles 1000"): the postcode and the town in one part.
  for (let i = parts.length - 1; i > 0 && !city; i--) {
    const m = /^(\d[\dA-Z -]{2,7}?)\s+(\D.*)$/i.exec(parts[i]) ?? /^(\D.*?)\s+(\d[\dA-Z-]{2,7})$/i.exec(parts[i]);
    if (!m) continue;
    [postcode, city] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    parts.splice(i, 1);
  }
  // A postcode on its own ("…, Gent, 9031"): taken out, the town is the part before it.
  if (!city) {
    const at = parts.findIndex((p, i) => i > 0 && POSTCODE.test(p));
    if (at > 0) postcode = parts.splice(at, 1)[0];
    city = parts.length > 1 ? parts.pop()! : (parts.pop() ?? "");
  }
  return { street: parts.join(", "), postcode, city };
}

/** The draft a record makes, and what it holds that the draft can't (`notCarried`, also kept on the draft). */
export function draftFromRecord(record: ReadRecord): { draft: Draft; notCarried: string[] } {
  const draft: Draft = {};
  const notCarried = [...(Array.isArray(record.unmapped) ? record.unmapped.filter((k) => typeof k === "string") : [])];
  const leave = (key: string, value?: unknown) => {
    const shown = typeof value === "string" || typeof value === "number" ? `${key}: ${String(value).slice(0, 80)}` : key;
    if (!notCarried.includes(shown)) notCarried.push(shown);
  };
  const set = (key: keyof Draft, value: string) => {
    if (value) (draft as Record<string, string>)[key] = value;
  };
  const network = record.kind === "network";
  if (network) draft.kind = "network";
  set("name", text(record.name, CAP.name));
  set("description", text(record.description, CAP.description));
  set("hours", text(record.opening_hours, CAP.hours));

  const country = text(record.country_code, 2).length === 2 && /^[A-Za-z]{2}$/.test(String(record.country_code).trim()) ? String(record.country_code).trim().toUpperCase() : "";
  if (record.country_code && !country) leave("country_code", record.country_code);
  const coords = typeof record.lat === "number" && typeof record.lon === "number" && Math.abs(record.lat) <= 90 && Math.abs(record.lon) <= 180;

  if (network) {
    const areas = cleanAreas(record.areaServed);
    if (areas.length) draft.areaServed = areas;
    const shared = areasCountry(areas);
    if (shared) draft.country = shared;
    const fidelity = cleanFidelity(record.geolocationFidelity ?? undefined);
    if (fidelity) draft.fidelity = fidelity;
    if (record.address) leave("address", record.address);
  } else {
    const { street, postcode, city } = splitAddress(text(record.address, 600));
    set("street", text(street, CAP.street));
    set("postcode", text(postcode, CAP.postcode));
    set("city", text(city, CAP.city));
    set("country", country);
    if (record.areaServed?.length) leave("areaServed");
    if (record.geolocationFidelity) leave("geolocationFidelity", record.geolocationFidelity);
    // The file's pin, named by its town: the form keeps it until the street or town is changed.
    if (coords && draft.city) draft.place = draft.city;
  }
  if (coords) {
    draft.lat = String(record.lat);
    draft.lon = String(record.lon);
  }
  if (record.timezone) leave("timezone", record.timezone);

  for (const key of ["url", "logo"] as const) {
    const value = text(record[key], CAP.url);
    if (!value) continue;
    if (plainIri(value)) set(key === "url" ? "website" : "logo", value);
    else leave(key, value);
  }

  const contact = record.contact && typeof record.contact === "object" ? record.contact : {};
  for (const [key, value] of Object.entries(contact)) {
    if (key === "email" && typeof value === "string" && text(value, CAP.email)) set("email", text(value, CAP.email));
    else if (key === "matrix" && typeof value === "string" && matrixRoom(value)) set("matrix", text(value, CAP.matrix));
    else leave(`contact.${key}`);
  }

  for (const m of Array.isArray(record.memberOf) ? record.memberOf : []) if (!memberIri(m)) leave("memberOf", String(m));
  Object.assign(draft, draftLists(record));
  if (notCarried.length) draft.notCarried = notCarried;
  return { draft, notCarried };
}

export type ReadOutcome = { draft: Draft; notCarried: string[] } | { problem: "rate" | "unavailable" } | { problem: "unread"; error: string };

/** Asks the map to read `url` (same origin: the gateway sends /api/ to the map). Writes nothing anywhere. */
export async function readSpaceFile(url: string, fetcher: typeof fetch = fetch): Promise<ReadOutcome> {
  let res: Response;
  try {
    res = await fetcher("/api/read-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  } catch {
    return { problem: "unavailable" };
  }
  if (res.status === 429) return { problem: "rate" };
  if (!res.ok) return { problem: "unavailable" };
  let answer: ReadUrlAnswer;
  try {
    answer = (await res.json()) as ReadUrlAnswer;
  } catch {
    return { problem: "unavailable" };
  }
  if (!answer?.record) return { problem: "unread", error: String(answer?.validation?.error ?? "").slice(0, 300) };
  return draftFromRecord(answer.record);
}
