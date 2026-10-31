/**
 * What each tile would give, keyed by the tree's `onb:preview` (Story 14.1
 * AC6). Concept screens as data (kit ux-principles.md): one function per
 * kind, built only from what the coordinator typed, so a preview never shows
 * a name or a reader that isn't real (design system: Workbench, Honesty
 * rules). Nothing typed yet, it says so in place: "Your space".
 *
 * Copy reference: the dry run's PREVIEWS ("Maps of Making Dry Run").
 */
import { esc } from "./html";

/** What the coordinator has typed so far. Signed out it lives in memory (AC4). */
export interface Draft {
  name?: string;
  address?: string;
  description?: string;
  email?: string;
  hours?: string;
  network?: string;
  event?: { title: string; date: string };
}

/** "Rue du Canal 12, 1070 Anderlecht" → "Anderlecht": the last part, postcode dropped. */
export function locality(address: string | undefined): string {
  const last = String(address ?? "").split(",").pop()!.trim();
  return last.replace(/^[A-Z]{0,2}-?\d{4,5}\s+/, "") || last;
}

const name = (d: Draft) => esc(d.name || "Your space");
const network = (d: Draft) => esc(d.network || "your network");
const dash = `<em class="pv-empty">—</em>`;

const facts = (rows: [string, string | undefined][]) =>
  `<dl class="pv-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : dash}</dd>`).join("")}</dl>`;

const PREVIEWS: Record<string, (d: Draft) => string> = {
  mapcard: (d) => `
    <div class="wb-frame">
      <div class="wb-popup">
        <div class="sp-hero"><span class="sp-name hand">${name(d)}</span>
          <span class="sp-address">${esc(locality(d.address)) || "Where you are"}</span></div>
        <div class="wb-popup-foot">Open on mapsofmaking.org ↗</div>
      </div>
    </div>
    ${facts([["Description", d.description], ["Hours", d.hours], ["Next event", d.event && `${d.event.title} · ${d.event.date}`]])}`,
  kept: (d) => `
    <div class="pv">
      <p class="pv-title">${name(d)}</p>
      <p class="pv-meta">On the map, read from your own file. Anyone looking in ${esc(locality(d.address)) || "your town"} finds you.</p>
    </div>`,
  readers: (d) => `
    <div class="pv">
      <p class="pv-title">Who reads your file</p>
      ${facts([["The map", "mapsofmaking.org"], ["Hours", d.hours]])}
      <p class="pv-meta">One edit, read by each of them. Nothing is copied.</p>
    </div>`,
  network: (d) => `
    <div class="pv">
      <p class="pv-title">${name(d)}</p>
      <p><span class="pv-chip declared">${network(d)}</span></p>
      <p class="pv-meta">Declared by ${name(d)}. ${esc(d.network || "Your network")} hasn't recognised it yet.</p>
    </div>`,
  assistant: (d) => `
    <div class="pv">
      <p class="pv-q">Can a beginner just turn up?</p>
      <p class="pv-a">${esc(d.description || `${d.name || "Your space"} doesn't say yet.`)}</p>
      <p class="pv-log">What was read: space.ttl, and nothing else</p>
    </div>`,
  ohm: (d) => `
    <div class="pv">
      <p class="pv-meta">Also listed on</p>
      <p class="pv-title">Open Hardware Manager</p>
      <p class="pv-meta">${name(d)}${d.address ? ` · ${esc(locality(d.address))}` : ""}. It reads the same index as the map.</p>
    </div>`,
  peers: (d) => `
    <div class="pv">
      <p class="pv-title">${esc(d.network || "Your network")}</p>
      <p class="pv-meta">Members both sides recognise</p>
      <p><span class="pv-chip">${name(d)}</span> <span class="pv-meta">and the other members, from their own files</span></p>
    </div>`,
  agenda: (d) => `
    <div class="pv">
      <p class="pv-title">${esc(d.network || "Your network")} · agenda</p>
      <p class="pv-meta">${d.event ? `${esc(d.event.date)} · ${esc(d.event.title)} at ${name(d)}` : `Your events, beside your peers'.`}</p>
    </div>`,
  handover: (d) => `
    <div class="pv">
      <p class="pv-title">Account</p>
      <p class="pv-meta">The space's mailbox. The next coordinator resets the passphrase from it; ${name(d)}, its file and its memberships stay put.</p>
    </div>`,
};

export function hasPreview(kind: string | null): kind is string {
  return kind !== null && Object.hasOwn(PREVIEWS, kind);
}

/** A preview, always framed and labelled: it never passes for the real thing (AC6). */
export function renderPreview(kind: string, draft: Draft): string {
  return `
    <section class="wb-preview" aria-label="Preview">
      <p class="wb-frame-label"><span>What you'd get</span><span>Preview · nothing is published</span></p>
      ${PREVIEWS[kind](draft)}
    </section>`;
}
