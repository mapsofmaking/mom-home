/**
 * Turtle, coloured the way the map's card colours it (maps_of_making web/app.js
 * `turtleHighlight`, Story 14.7), with the design system's source classes
 * (`pre.turtle`: k keys and the name in a prefixed name, s strings, n IRIs and
 * numbers, c prefixes, comments, @prefix, language tags, blank-node labels).
 *
 * The file is someone's own data: every token is escaped, never parsed into the
 * page as HTML. Lines are kept one per span so a changed line can be marked.
 */
import { esc } from "./html";

const TOKENS =
  /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(<[^<>\s]*>)|(#[^\n]*)|(@prefix\b|@base\b|\bPREFIX\b|\bBASE\b|@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*|_:[\w.-]+)|((?:[A-Za-z][\w.-]*)?:[\w.%-]*|(?<![\w:])a(?![\w:]))|([-+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** One line of Turtle as coloured, escaped HTML. */
export function highlightTurtleLine(line: string): string {
  let out = "";
  let last = 0;
  const span = (cls: string, text: string) => (text ? `<span class="${cls}">${esc(text)}</span>` : "");
  for (const m of line.matchAll(new RegExp(TOKENS.source, "g"))) {
    if (m[0] === "") continue;
    const at = m.index ?? 0;
    if (at > last) out += esc(line.slice(last, at));
    const colon = m[5] ? m[0].indexOf(":") : -1;
    if (colon >= 0) {
      // `schema:name`: the prefix recedes, the name carries the colour (like a JSON key).
      out += span("c", m[0].slice(0, colon + 1)) + span("k", m[0].slice(colon + 1));
    } else {
      out += span(m[1] ? "s" : m[2] ? "n" : m[3] || m[4] ? "c" : m[5] ? "k" : "n", m[0]);
    }
    last = at + m[0].length;
  }
  return out + esc(line.slice(last));
}

/** The whole file, one `.line` span per line; lines matching `changed` are marked `.chg`. */
export function highlightTurtle(text: string, changed?: RegExp): string {
  return text
    .replace(/\s+$/, "")
    .split("\n")
    .map((l) => `<span class="line${changed?.test(l) ? " chg" : ""}">${highlightTurtleLine(l) || " "}</span>`)
    .join("");
}
