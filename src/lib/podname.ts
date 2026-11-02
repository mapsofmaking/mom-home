/**
 * A pod's address, as the coordinator types it (Story 14.3 AC2).
 *
 * The pod server decides what is allowed (solid-css-overlay PodNameGuard: a DNS
 * label, 63 characters at most, some names reserved) and its answer wins. This
 * checks the same label rule early, for the person's sake, so a bad address
 * shows on its own field before the passphrase is typed. Whether a name is
 * TAKEN cannot be checked: 14.0 found no way to ask without creating anything,
 * so "taken" only ever comes from the server, after "Create it".
 */
import { DEFAULT_IDENTIFIER } from "../config";
import { slugify } from "./pod";

export type NameProblem = "empty" | "format" | "long";

/** Same rule as the server's guard: one DNS label, no leading or trailing dash. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const MAX_NAME = 63;

export function podNameProblem(name: string): NameProblem | null {
  if (!name) return "empty";
  if (name.length > MAX_NAME) return "long";
  return LABEL.test(name) ? null : "format";
}

/**
 * The address suggested from the space's name: accents folded, lower case,
 * dashes between words. Empty when the name has nothing usable (never "item":
 * that would suggest a real-looking address nobody chose), and cut to the
 * limit without leaving a dash at the end.
 */
export function suggestPodName(spaceName: string | undefined): string {
  return slugify(spaceName ?? "", "").slice(0, MAX_NAME).replace(/-+$/, "");
}

/**
 * Where the pod will live: the name is a subdomain of the server's host
 * (descriptor `podNames: "subdomain"`; Maps of Making's layout).
 */
export function podAddress(name: string, server: string = DEFAULT_IDENTIFIER): string {
  const url = new URL(server);
  return `${url.protocol}//${name}.${url.host}`;
}
