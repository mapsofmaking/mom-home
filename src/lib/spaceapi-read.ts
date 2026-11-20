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
import { areasCountry, cleanAreas, cleanFidelity, cleanTopics, draftLists, matrixRoom, memberIri, plainIri } from "./spacefile";

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
const CAP = { name: 200, street: 300, city: 200, postcode: 30, description: 5000, email: 300, matrix: 300, url: 500, hours: 500 };

const POSTCODE = /^(?=.*\d)[A-Z0-9][A-Z0-9 -]{2,8}$/i;

/** "Rue du Canal 12, 1000 Bruxelles, BE" → street, postcode, city. Best-effort; one part alone is the town. */
export function splitAddress(address: string): { street: string; postcode: string; city: string } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) parts.pop(); // the country, read apart
  let postcode = "";
  let city = "";
  // "1000 Bruxelles" (or "Bruxelles 1000"): the postcode and the town in one part.
  for (let i = parts.length - 1; i > 0 && !city; i--) {
    // The town part has no digit and three letters at least, so "IL 62701" or "London SW1A 1AA" are not read as one.
    const m = /^(\d[\dA-Z -]{2,7}?)\s+([^\d]*[A-Za-z]{3,}[^\d]*)$/.exec(parts[i]) ?? /^([^\d]*[A-Za-z]{3,}[^\d]*?)\s+(\d[\dA-Z-]{2,7})$/.exec(parts[i]);
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
  /** Text a person reads: cut at the cap, and the cut said. */
  const setText = (key: keyof Draft, value: unknown, cap: number, label: string = key) => {
    if (typeof value !== "string" || !value.trim()) return;
    const full = value.trim();
    if (full.length > cap) leave(`${label} (cut at ${cap} characters)`);
    (draft as Record<string, string>)[key] = full.slice(0, cap);
  };
  /** An address or a handle: never cut (a cut one is a broken one); too long or not valid, it is left out and named. */
  const setWhole = (key: keyof Draft, value: unknown, cap: number, label: string, valid: (v: string) => boolean) => {
    if (typeof value !== "string" || !value.trim()) return;
    const full = value.trim();
    if (full.length <= cap && valid(full)) (draft as Record<string, string>)[key] = full;
    else leave(label, full);
  };
  const network = record.kind === "network";
  if (network) draft.kind = "network";
  setText("name", record.name, CAP.name);
  setText("description", record.description, CAP.description);
  setText("hours", record.opening_hours, CAP.hours, "opening_hours");

  const rawCountry = typeof record.country_code === "string" ? record.country_code.trim() : "";
  const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : "";
  if (rawCountry && !country) leave("country_code", rawCountry);
  const hasLat = typeof record.lat === "number";
  const hasLon = typeof record.lon === "number";
  const coords = hasLat && hasLon && Math.abs(record.lat!) <= 90 && Math.abs(record.lon!) <= 180;
  if ((hasLat || hasLon) && !coords) leave("lat/lon", `${record.lat}, ${record.lon}`);

  if (network) {
    const raw = Array.isArray(record.areaServed) ? record.areaServed : [];
    const areas = cleanAreas(raw);
    if (areas.length) draft.areaServed = areas;
    for (const a of raw) {
      const code = typeof a?.code === "string" ? a.code.trim().toUpperCase() : "";
      if (!areas.some((x) => x.code === code)) leave("areaServed", code || JSON.stringify(a).slice(0, 80));
    }
    const shared = areasCountry(areas);
    if (shared) draft.country = shared;
    if (country && country !== shared) leave("country_code", country);
    const fidelity = cleanFidelity(record.geolocationFidelity ?? undefined);
    if (fidelity) draft.fidelity = fidelity;
    else if (record.geolocationFidelity) leave("geolocationFidelity", record.geolocationFidelity);
    if (record.address) leave("address", record.address);
  } else {
    const address = typeof record.address === "string" ? record.address.trim() : "";
    const { street, postcode, city } = splitAddress(address);
    setText("street", street, CAP.street, "address");
    setText("postcode", postcode, CAP.postcode, "address");
    setText("city", city, CAP.city, "address");
    if (country) draft.country = country;
    if (record.areaServed?.length) leave("areaServed");
    if (record.geolocationFidelity) leave("geolocationFidelity", record.geolocationFidelity);
    // The file's pin, named by its town: the form keeps it until the street or town is changed.
    if (coords && draft.city) {
      draft.place = draft.city;
      draft.pinFrom = "file";
    }
  }
  if (coords) {
    draft.lat = String(record.lat);
    draft.lon = String(record.lon);
  }
  if (record.timezone) leave("timezone", record.timezone);

  setWhole("website", record.url, CAP.url, "url", (v) => plainIri(v) !== null);
  setWhole("logo", record.logo, CAP.url, "logo", (v) => plainIri(v) !== null);

  const contact = record.contact && typeof record.contact === "object" ? record.contact : {};
  for (const [key, value] of Object.entries(contact)) {
    if (key === "email" && typeof value === "string") setWhole("email", value, CAP.email, "contact.email", (v) => /^[^\s@]+@[^\s@]+$/.test(v));
    else if (key === "matrix" && typeof value === "string") setWhole("matrix", value, CAP.matrix, "contact.matrix", (v) => matrixRoom(v) !== null);
    else leave(`contact.${key}`);
  }

  // The lists: what the draft keeps, and each value it doesn't, named.
  const lists = draftLists(record);
  Object.assign(draft, lists);
  for (const m of Array.isArray(record.memberOf) ? record.memberOf : []) {
    const iri = memberIri(m);
    if (!iri || !lists.memberOf?.includes(iri)) leave("memberOf", String(m));
  }
  for (const s of Array.isArray(record.sdgs) ? record.sdgs : []) if (!lists.sdgs?.includes(s)) leave("sdgs", String(s));
  for (const t of Array.isArray(record.knowsAbout) ? record.knowsAbout : []) {
    const clean = cleanTopics([t])[0];
    if (!clean || !lists.knowsAbout?.includes(clean)) leave("knowsAbout", String(t));
    else if (clean !== String(t).trim()) leave(`knowsAbout (cut at 200 characters)`);
  }
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
