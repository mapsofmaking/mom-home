/** Escapes text for innerHTML. Pure, so the renderers can be tested without a DOM. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/** One of Bernard's lines, from the tree. He opens with an em-dash (design system: Workbench, Type). */
export function bernard(line: string | undefined): string {
  return line ? `<p class="bernard-voice">— ${esc(line)}</p>` : "";
}
