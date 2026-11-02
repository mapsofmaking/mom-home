/**
 * A tile's own words, read from the tree (14.2 AC8, 14.3 AC8). A word missing
 * from the tree shows as nothing and says so in the console, once: there is no
 * copy of the words in code to fall back on (the voice test checks the tree
 * has them all). `{name}` in a line is filled from `vars`.
 */
import type { Tile } from "../tree/parse";

export function tileUi<K extends string>(
  tile: Pick<Tile, "ui"> | undefined,
  which: string
): (name: K, vars?: Record<string, string>) => string {
  const warned = new Set<string>();
  return (name, vars = {}) => {
    const line = tile?.ui[name];
    if (line === undefined) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`onboarding.ttl: ${which} has no onb:${name}.`);
      }
      return "";
    }
    return line.replace(/\{(\w+)\}/g, (all, v: string) => vars[v] ?? all);
  };
}
