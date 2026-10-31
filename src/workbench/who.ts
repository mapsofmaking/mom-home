/**
 * "Signed in as <name>" (Story 14.1 AC1b): the name the profile gives, or a
 * short form of the WebID when it gives none (a fresh pod's profile has no
 * name). The space's own name, from its card, replaces this once the card is
 * read from the pod (14.6).
 */
import { getSolidDataset, getThing } from "@inrupt/solid-client";
import { authFetch } from "../lib/auth";
import { shortWebId } from "../lib/identity";
import { readLiteral } from "../lib/literal";

const NAMES = [
  "http://schema.org/name",
  "https://schema.org/name",
  "http://xmlns.com/foaf/0.1/name",
  "http://www.w3.org/2006/vcard/ns#fn",
];

/** `https://atelier.pod.mapsofmaking.org/profile/card#me` → "atelier": the pod's own label. */
export function fallbackName(webId: string): string {
  const short = shortWebId(webId);
  try {
    const host = new URL(webId).host;
    if (short === host) return host.split(".")[0];
  } catch {
    // not a URL: shortWebId already returned it as is
  }
  return short;
}

export async function displayName(webId: string, fetchFn: typeof fetch = authFetch): Promise<string> {
  try {
    const profile = await getSolidDataset(webId.split("#")[0], { fetch: fetchFn });
    const me = getThing(profile, webId);
    if (me) {
      for (const p of NAMES) {
        const name = readLiteral(me, p, ["en"]);
        if (name?.trim()) return name.trim();
      }
    }
  } catch {
    // An unreadable profile costs the name, not the page.
  }
  return fallbackName(webId);
}
