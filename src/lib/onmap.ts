/**
 * Step 3 of "Put it on the map" (Story 14.4 AC4, #13): the space file's address
 * goes to the map's own register endpoint, through home's `/api/` proxy (same
 * origin, the gateway forwards it to the map), and the pin is then read back from
 * the map: the coordinator sees where the map put them, never a drawing of where
 * home thinks they are.
 *
 * The map registers at once but redraws in the background, so the pin can lag a
 * few seconds behind the answer: it is asked for again, briefly, and a pin that
 * hasn't come yet is not a failure (the space is registered; the map shows it soon).
 *
 * Registering twice is harmless: the map recognises the address it already holds
 * (`register-url` dedups by endpoint), so a retry never makes a second space.
 */
import { PublishError } from "./publish";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Registering fetches and checks the file from the map's side: slower than a pod write. */
export const REGISTER_TIMEOUT_MS = 45_000;
/** How long the pin is waited for, and how often it is asked. */
export const PIN_WAIT_MS = 30_000;
export const PIN_EVERY_MS = 2_000;

export interface Pin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
}

export interface OnMap {
  /** The map's id for the space: `?space=<id>` opens it. */
  id: string;
  /** The map's own link to the space, focused on its pin with its card open. */
  link: string;
  /** The pin as the map draws it; null when the map hasn't redrawn yet. */
  pin: Pin | null;
}

const MAP = "https://mapsofmaking.org/";
export const mapLink = (id: string) => `${MAP}?space=${encodeURIComponent(id)}`;

async function ask(fetchImpl: Fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(ms) });
  } catch (err) {
    throw new PublishError("unreachable", `The map did not answer: ${(err as Error).message}`);
  }
}

/** The map's id from its answer: `urn:mak:space/<id>`. */
export function idFromSpaceUri(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const id = /^urn:mak:space\/([A-Za-z0-9_-]{1,64})$/.exec(uri)?.[1];
  return id ?? null;
}

/** Registers the file's address on the map. Throws `map-refused` (the map read the file and said no) or `map-down`. */
export async function registerOnMap(fileUrl: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<string> {
  const res = await ask(
    fetchImpl,
    "/api/register-url",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: fileUrl }) },
    REGISTER_TIMEOUT_MS
  );
  if (res.status === 422) {
    throw new PublishError("map-refused", `The map read the file and did not take it (422): ${await res.text().catch(() => "")}`, 422);
  }
  if (!res.ok) throw new PublishError("map-down", `The map's register answered ${res.status}.`, res.status);
  let body: { space_uri?: unknown };
  try {
    body = await res.json();
  } catch {
    throw new PublishError("map-down", "The map's register answered something that isn't JSON.", res.status);
  }
  const id = idFromSpaceUri(body.space_uri);
  if (!id) throw new PublishError("map-down", `The map's register gave no space id (${String(body.space_uri)}).`, res.status);
  return id;
}

/** The pin as the map draws it, or null while the map hasn't redrawn. */
export async function readPin(id: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<Pin | null> {
  const res = await ask(fetchImpl, `/api/space/${encodeURIComponent(id)}/pin`, { headers: { Accept: "application/json" } }, 10_000);
  if (res.status === 404) return null;
  if (!res.ok) throw new PublishError("map-down", `The map's pin answered ${res.status}.`, res.status);
  const p = (await res.json()) as Partial<Pin>;
  if (typeof p.lat !== "number" || typeof p.lon !== "number") return null;
  return { id, name: p.name ?? "", lat: p.lat, lon: p.lon, city: p.city ?? "", country: p.country ?? "" };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Registers, then waits briefly for the pin. A pin that is late is not a failure. */
export async function putOnMap(
  fileUrl: string,
  fetchImpl: Fetch = (u, i) => fetch(u, i),
  wait = { total: PIN_WAIT_MS, every: PIN_EVERY_MS }
): Promise<OnMap> {
  const id = await registerOnMap(fileUrl, fetchImpl);
  const until = Date.now() + wait.total;
  let pin: Pin | null = null;
  for (;;) {
    try {
      pin = await readPin(id, fetchImpl);
    } catch {
      pin = null; // the registration stands; a pin that can't be read now shows on the map later
    }
    if (pin || Date.now() + wait.every > until) break;
    await pause(wait.every);
  }
  return { id, link: mapLink(id), pin };
}

/** The map's id for a space file's address, or null when the map doesn't hold it (#14: tile B done from the pod). */
export async function lookupOnMap(fileUrl: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<string | null> {
  const res = await ask(fetchImpl, `/api/space-by-endpoint?url=${encodeURIComponent(fileUrl)}`, { headers: { Accept: "application/json" } }, 10_000);
  if (res.status === 404) return null;
  if (!res.ok) throw new PublishError("map-down", `The map's lookup answered ${res.status}.`, res.status);
  const { id } = (await res.json()) as { id?: unknown };
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/**
 * Where a space stands on the map, read at sign-in: registered (the map holds the
 * file's address) and readable by anyone. Both, or null. The pin comes along when
 * the map has drawn it. Failures count as "not yet": tile B stays open, never wrong.
 */
export async function readPublished(
  fileUrl: string,
  publiclyReadable: () => Promise<boolean>,
  fetchImpl: Fetch = (u, i) => fetch(u, i)
): Promise<OnMap | null> {
  const [id, open] = await Promise.all([lookupOnMap(fileUrl, fetchImpl).catch(() => null), publiclyReadable().catch(() => false)]);
  if (!id || !open) return null;
  const pin = await readPin(id, fetchImpl).catch(() => null);
  return { id, link: mapLink(id), pin };
}
