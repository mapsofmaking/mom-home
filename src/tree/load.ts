/**
 * Fetches and parses the tree at load. Every failure comes back as a
 * TreeError, so the shell has one case to turn into an error screen with a
 * way forward (AC2: never a blank map).
 */
import { TREE_URL } from "../config";
import { parseTree, TreeError, type Tree } from "./parse";

export async function loadTree(url: string = TREE_URL, fetchFn: typeof fetch = fetch): Promise<Tree> {
  let response: Response;
  try {
    response = await fetchFn(url, { cache: "no-cache" });
  } catch (e) {
    throw new TreeError(`Could not reach ${url}: ${(e as Error).message}`);
  }
  if (!response.ok) throw new TreeError(`${url} answered ${response.status}.`);
  return parseTree(await response.text());
}
