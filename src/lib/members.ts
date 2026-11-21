/**
 * A network's members on the map (#74): the spaces that name it with `mom:memberOf`, as the map counts them,
 * read through home's `/api/` proxy (`GET /api/network-members`, map #95). Read only: nothing is written, and a
 * member is "declared" here until the network accepts its join (membership chip, later).
 *
 * The invitation for each one is text to copy (decided 2026-11-20: MoM sends nothing, no mailto). A member still
 * on a file also gets a link to home with `?from=<its file>`, which opens tile A filled in from it (#73).
 */
import { HOME_URL } from "../config";
import { PublishError } from "./publish";
import { mapLink } from "./onmap";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Member {
  /** The map's id: its card is `mapLink(id)`. */
  id: string;
  name: string;
  /** The address the map reads the member from. */
  endpoint: string;
  /** A Turtle file (a pod's space.ttl) or still a JSON file. */
  onPod: boolean;
  /** What the map shows on the card: `[{type, value}]`, email and matrix first. */
  contact: { type: string; value: string }[];
}

const FIRST = ["email", "matrix"];
const rank = (type: string) => (FIRST.includes(type) ? FIRST.indexOf(type) : FIRST.length);

/** The network's members, or [] when the map doesn't count it as a network yet (404). */
export async function readMembers(networkFile: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<Member[]> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/network-members?url=${encodeURIComponent(networkFile)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PublishError("unreachable", `The map did not answer: ${(err as Error).message}`);
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new PublishError("map-down", `The map's members answered ${res.status}.`, res.status);
  let body: { members?: unknown };
  try {
    body = await res.json();
  } catch {
    throw new PublishError("map-down", "The map's members answered something that isn't JSON.", res.status);
  }
  if (!Array.isArray(body.members)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return body.members.flatMap((m: Record<string, unknown>): Member[] => {
    const id = str(m?.id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return [];
    const contact = (Array.isArray(m.contact) ? m.contact : [])
      .map((c: Record<string, unknown>) => ({ type: str(c?.type), value: str(c?.value).trim() }))
      .filter((c) => c.type && c.value)
      .sort((a, b) => rank(a.type) - rank(b.type));
    const endpoint = str(m.endpoint_url);
    return [{ id, name: str(m.name) || id, endpoint, onPod: str(m.media_type) === "text/turtle", contact }];
  });
}

/** The card of a member on the map. */
export const memberCard = (m: Member) => mapLink(m.id);

/** Home opened on a member's file: tile A reads it (#73). Only for a member still on a file, and only a web address. */
export function claimLink(m: Member): string | null {
  if (m.onPod || !/^https?:\/\/\S+$/i.test(m.endpoint) || m.endpoint.length > 2000) return null;
  return `${HOME_URL}?from=${encodeURIComponent(m.endpoint)}`;
}
