/**
 * Markdown from a pod, shown as HTML. Anyone who can write a file can put
 * anything in it, so marked's output (which it never sanitizes) always goes
 * through DOMPurify before it reaches the page.
 *
 * Links and images keep only http(s), mailto and relative addresses; every
 * link opens in a new tab without handing it this page (`noopener`).
 *
 * A YAML header (`---` … `---` on the first lines, what the collective's
 * procedures ask a contribution to start with) is shown as a list of fields,
 * not as Markdown: rendered as Markdown it becomes a rule, a paragraph and a
 * list. Only `key: value` and `- item` lines are read; the rest is shown as
 * written. Values go through the same sanitizing as the body.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

const SAFE_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let hooked = false;

export function renderMarkdown(source: string): string {
  if (!hooked) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  const { fields, body } = splitFrontMatter(source);
  const html = (fields ? frontMatterHtml(fields) : "") + marked.parse(body, { async: false, gfm: true });
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

type Fields = [string, string[]][];

/** The leading `---` block, as fields in order; `null` when there is none or it is not simple YAML. */
export function splitFrontMatter(source: string): { fields: Fields | null; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { fields: null, body: source };
  const fields: Fields = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    const pair = /^([A-Za-z0-9_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (item && fields.length) fields[fields.length - 1][1].push(unquote(item[1]));
    else if (pair) fields.push([pair[1], inlineList(pair[2])]);
    else return { fields: null, body: source }; // not the simple kind: shown as written
  }
  return { fields, body: source.slice(match[0].length) };
}

/** `[a, b]` as two values, a quoted string without its quotes, empty as nothing. */
function inlineList(value: string): string[] {
  const v = value.trim();
  if (!v) return [];
  const list = /^\[(.*)\]$/.exec(v);
  return list ? list[1].split(",").map((x) => unquote(x)).filter(Boolean) : [unquote(v)];
}

function unquote(value: string): string {
  const v = value.trim();
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

function frontMatterHtml(fields: Fields): string {
  const rows = fields
    .map(([key, values]) => {
      const dd = values.length ? values.map((v) => `<dd>${marked.parseInline(v, { async: false, gfm: true })}</dd>`).join("") : "<dd></dd>";
      return `<div><dt>${escapeHtml(key)}</dt>${dd}</div>`;
    })
    .join("");
  return `<dl class="front-matter">${rows}</dl>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
