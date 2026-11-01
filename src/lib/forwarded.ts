/**
 * A draft forwarded from the old genjson wizard (Story 14.8 AC2).
 *
 * localStorage is per origin, so home cannot read what genjson saved. For a
 * transition period genjson.mapsofmaking.org serves one small page that puts
 * the draft in the URL fragment (never sent to a server):
 * `https://home.mapsofmaking.org/#from-genjson=<base64url(JSON)>`.
 *
 * The fragment is untrusted input: only known keys, only text, cut to a
 * length. The pin (lat, lon, postcode, country) is left out on purpose: the geocoder
 * works it out again from street and city, and gives the place name the form shows.
 */
import type { Draft } from "../workbench/previews";

export const FRAGMENT_KEY = "from-genjson";

/** genjson's field → home's field, with the longest text each may hold. */
const MAP: Record<string, [keyof Draft, number]> = {
  space: ["name", 200],
  address: ["street", 300],
  city: ["city", 200],
  description: ["description", 2000],
  contact_email: ["email", 300],
  contact_matrix: ["matrix", 300],
  url: ["website", 500],
  logo: ["logo", 500],
};

function decode(b64url: string): unknown {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** What the fragment carries as a home draft, or null when it carries none (absent, malformed, empty). */
export function readForwarded(hash: string): Draft | null {
  const m = new RegExp(`^#?${FRAGMENT_KEY}=([A-Za-z0-9_-]+)$`).exec(hash);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = decode(m[1]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [from, [to, max]] of Object.entries(MAP)) {
    const v = (raw as Record<string, unknown>)[from];
    if (typeof v !== "string") continue;
    const text = v.trim().slice(0, max);
    if (text) out[to] = text;
  }
  return Object.keys(out).length ? (out as Draft) : null;
}

/** True when the hash is a forwarded draft, well formed or not: it is cleared from the address either way. */
export const hasForwarded = (hash: string): boolean => hash.replace(/^#/, "").startsWith(`${FRAGMENT_KEY}=`);
