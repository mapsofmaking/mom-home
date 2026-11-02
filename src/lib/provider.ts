/**
 * What the pod server says it offers (solid-kit ADR 010): its descriptor at
 * `/.well-known/css/provider.json`. Tile B reads one thing from it, whether the
 * server takes new accounts (`register`, point 9), before it shows a field.
 *
 * Three answers, because they send the coordinator three ways:
 * - `open`: the descriptor lists `register`. The pod door can be offered.
 * - `closed`: the server answered and does not list it, or has no descriptor at
 *   all (stock CSS has none: "nothing beyond Solid"). Say so, offer the other way.
 * - `down`: no answer, or one that is not a descriptor. Not the same as closed:
 *   the person can try again, and must not be told the server refuses them.
 *
 * Read-only and anonymous: no cookies, no token. The descriptor grants nothing.
 */
import { DEFAULT_IDENTIFIER } from "../config";

export type Offers = "open" | "closed" | "down";

export const DESCRIPTOR_PATH = "/.well-known/css/provider.json";

export async function readOffers(
  server: string = DEFAULT_IDENTIFIER,
  fetchImpl: typeof fetch = fetch
): Promise<Offers> {
  let res: Response;
  try {
    res = await fetchImpl(new URL(DESCRIPTOR_PATH, server), {
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    return "down";
  }
  // No descriptor on a server that answers: it offers nothing beyond Solid.
  if (res.status === 404) return "closed";
  if (!res.ok) return "down";
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return "down";
  }
  const capabilities = (body as { capabilities?: Record<string, unknown> } | null)?.capabilities;
  if (!capabilities || typeof capabilities !== "object") return "down";
  const register = capabilities.register as { path?: unknown } | undefined;
  // An entry with no path to the account API is not an offer we can use.
  return register && typeof register.path === "string" && register.path.startsWith("/") ? "open" : "closed";
}
