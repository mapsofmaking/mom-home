/**
 * Tile C's tool (Story 14.6 S4, #39): every field the tree lists for the space's file, in the card's order, drawn from the tree's
 * registry (`onb:ProfileField`), a Finder over them, the card as it would read, and one Save that writes
 * every change in one patch (lib/profile.ts) and has the map read it.
 *
 * Fields are data: a new `onb:ProfileField` appears here with no code. Kinds are code (text, email, url,
 * image, place, contacts). Nothing is written on load: a value that can be mended without loss is offered
 * ("Fix it"), one that can't is flagged; both wait for the person.
 *
 * The tool owns its own state and DOM (`mountTool`); the page hands it what to read, save, find and ask of the map.
 */
import type { Tile, ProfileField, Section } from "../tree/parse";
import { check, checkPlace, changes, placeLine, type Edit, type Issue, type Profile, type ProfileDef, type SaveResult, type Why } from "../lib/profile";
import { checkHandle, type Handle } from "../lib/contacts";
import type { MapReread, Pin } from "../lib/onmap";
import { PublishError } from "../lib/publish";
import type { Place } from "../lib/move";
import { esc } from "./html";
import { contactPicto } from "./contacticons";
import { livePopup } from "./popup";
import { miniMapSlot, mountMiniMaps } from "./minimap";
import { highlightTurtle } from "./turtle";
import { logoWords } from "./logo";
import { LOGO_TYPES, type LogoResult } from "../lib/logo";
import { tileUi } from "./tilewords";
import { hoursWords, marker } from "./hours";
import { moveWords } from "./move";
import { findPlace, meterInto, shortPlace, timing } from "./where";

export const PROFILE_UI_KEYS = ["uiProfileTitle", "uiProfileLead", "uiProfileLoading", "uiProfileLoadFailed", "uiProfileFind", "uiProfileFindPlaceholder", "uiProfileFindCount", "uiProfileFindNone", "uiProfileEmpty", "uiProfileCard", "uiProfileNotSaved", "uiProfileSaved", "uiProfileSave", "uiProfileNothing", "uiProfileChangeOne", "uiProfileChangeMany", "uiProfilePinMoves", "uiProfileStreet", "uiProfileCity", "uiProfileAddHandle", "uiProfileRemoveHandle", "uiProfileHandleKind", "uiProfileHandleValue", "uiProfileFix", "uiProfileFixing", "uiProfileNeedsFix", "uiProfileWhySpaces", "uiProfileWhyCase", "uiProfileWhyAsText", "uiProfileWhyScheme", "uiProfileWhyPrefix", "uiProfileWhyRoom", "uiProfileWhyHandle", "uiProfileWhyEmpty", "uiProfileWhyEmail", "uiProfileWhyPhone", "uiProfileWhyAddress", "uiProfileWhyCity", "uiProfileWhyCountry", "uiProfileWhyPin", "uiProfileAddressProblem", "uiProfileOthers", "uiProfileOthersHint", "uiProfileUnconfirmed", "uiProfileSame", "uiProfileDone", "uiProfileMany", "uiProfileChangedSince"] as const;
export type ProfileUiKey = (typeof PROFILE_UI_KEYS)[number];
export const profileWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<ProfileUiKey>(tile, "tile C (profile)");

const WHY: Record<Why, ProfileUiKey> = {
  spaces: "uiProfileWhySpaces", case: "uiProfileWhyCase", "as-text": "uiProfileWhyAsText", scheme: "uiProfileWhyScheme",
  prefix: "uiProfileWhyPrefix", room: "uiProfileWhyRoom", handle: "uiProfileWhyHandle", empty: "uiProfileWhyEmpty",
  email: "uiProfileWhyEmail", phone: "uiProfileWhyPhone", address: "uiProfileWhyAddress", city: "uiProfileWhyCity",
  country: "uiProfileWhyCountry", pin: "uiProfileWhyPin",
};

/** A row the Finder can offer: a field, with what it says now. */
export interface FindRow {
  key: string;
  label: string;
  section: string;
  value: string;
}

export interface FindGroup {
  section: string;
  rows: FindRow[];
}

/** Rows whose label or value holds every word typed (case and accents aside), grouped by section in the tree's order. */
export function finderResults(query: string, rows: readonly FindRow[], sections: readonly Section[]): FindGroup[] {
  const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = rows.filter((r) => {
    const hay = fold(`${r.label} ${r.value}`);
    return words.every((w) => hay.includes(w));
  });
  return sections
    .map((s) => ({ section: s.id, rows: hit.filter((r) => r.section === s.id) }))
    .filter((g) => g.rows.length);
}

/** The text with the typed words marked, safe to put in the page. */
export function mark(text: string, query: string): string {
  const words = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return esc(text);
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

export interface ToolDeps {
  def: ProfileDef;
  sections: readonly Section[];
  /** The tree's tile that holds the tool's words (tile C), and tile A's "Working out where that is." line for the bar. */
  tile: Pick<Tile, "ui">;
  working: string;
  /** The file as the pod holds it now. */
  load: () => Promise<{ profile: Profile; etag: string | null; text?: string }>;
  /** The logo: a file uploaded next to the space file (lib/logo.ts), its own write, as before. `current`: schema:logo now. */
  uploadLogo?: (file: File, current: string | null) => Promise<LogoResult>;
  save: (edit: Edit) => Promise<SaveResult>;
  find?: typeof findPlace;
  mapRead?: (says: string | ((pin: Pin) => boolean)) => Promise<MapReread>;
  /** The file was written: the page keeps its own copy (the draft) in step. */
  onSaved?: (result: SaveResult) => void;
  /** A logo was uploaded: its address, for the page's draft. */
  onLogo?: (url: string) => void;
}

type Status = "loading" | "failed" | "ready" | "finding" | "writing" | "done";

interface State {
  /** The file's ETag when this screen read it: a save is refused if the file has moved on. */
  etag: string | null;
  /** The file's text as last read, for the source beside the card; and what the last save changed in it. */
  text: string;
  changed: RegExp | null;
  /** What the file said then: only what differs from it is sent. */
  base: { values: Record<string, string>; handles: string; };
  /** Fixes the person tapped on a value that reads the same either way (a web address held as text): saved only for those. */
  mended: Set<string>;
  mendedHandles: boolean;
  status: Status;
  profile: Profile | null;
  /** Simple fields' text as typed. */
  values: Record<string, string>;
  street: string;
  city: string;
  handles: Handle[];
  query: string;
  pick: number;
  /** Place found by the geocoder while saving. */
  found: string;
  missed: boolean;
  message: string;
  map: "idle" | "working" | "done" | "late" | "failed";
}

export interface ToolHandle {
  destroy(): void;
}

const fieldInput = (key: string) => `tool-f-${key}`;

export function mountTool(box: HTMLElement, deps: ToolDeps): ToolHandle {
  const ui = profileWords(deps.tile);
  const move = moveWords(deps.tile);
  const map = hoursWords(deps.tile);
  const logoUi = logoWords(deps.tile);
  const fields = [...deps.def.fields].sort((a, b) => a.prio - b.prio);
  const sections = [...deps.sections].sort((a, b) => a.prio - b.prio);
  const types = [...deps.def.contactTypes].sort((a, b) => a.prio - b.prio);
  const life = new AbortController();
  let saving = false;
  let stopMeter = () => {};
  const s: State = {
    etag: null, text: "", changed: null, base: { values: {}, handles: "[]" }, mended: new Set(), mendedHandles: false,
    status: "loading", profile: null, values: {}, street: "", city: "", handles: [], query: "", pick: 0,
    found: "", missed: false, message: "", map: "idle",
  };

  const simple = (f: ProfileField) => f.kind === "text" || f.kind === "email" || f.kind === "url" || f.kind === "image";
  const fromFile = (profile: Profile) => {
    s.profile = profile;
    s.values = Object.fromEntries(fields.filter(simple).map((f) => [f.key, profile.values.get(f.key)?.text ?? ""]));
    s.street = profile.place?.street ?? "";
    s.city = profile.place?.city ?? "";
    s.handles = (profile.contacts?.handles ?? []).map((h) => ({ type: h.type, value: h.value }));
    s.base = { values: { ...s.values }, handles: handlesKey(s.handles) };
    s.mended = new Set();
    s.mendedHandles = false;
  };
  /** The file read again after a write of its own (the logo): what the person typed elsewhere is kept. */
  const rebase = (profile: Profile, etag: string | null, text: string | undefined, except: string) => {
    const keep = fields.filter((f) => simple(f) && f.key !== except && s.values[f.key] !== s.base.values[f.key]).map((f) => [f.key, s.values[f.key]] as const);
    const handles = handlesKey(s.handles) !== s.base.handles ? s.handles : null;
    const place = placeChanged() ? { street: s.street, city: s.city } : null;
    fromFile(profile);
    s.etag = etag;
    if (text !== undefined) s.text = text;
    for (const [k, v] of keep) s.values[k] = v;
    if (handles) s.handles = handles;
    if (place) Object.assign(s, place);
  };
  const handlesKey = (list: readonly Handle[]) => JSON.stringify(list.filter((h) => h.value.trim()).map((h) => [h.type, h.value.trim()]));

  /** What is typed, as an edit. The address is the file's own place with the typed street and city until the geocoder places it. */
  const placeChanged = () => !!s.profile?.place && (s.street.trim() !== s.profile.place.street.trim() || s.city.trim() !== s.profile.place.city.trim());
  /** A field with several values in the file is shown and left alone: this page changes one value, never collapses them. */
  const many = (f: ProfileField) => !!s.profile?.values.get(f.key)?.many;
  /** Only what the person changed (or mended) is sent: the rest stays as the file has it now, whoever wrote it. */
  const edit = (): Edit => {
    const values: Record<string, string> = {};
    for (const f of fields) {
      if (!simple(f) || many(f)) continue;
      if (s.values[f.key] !== s.base.values[f.key] || s.mended.has(f.key)) values[f.key] = s.values[f.key];
    }
    return {
      baseEtag: s.etag,
      values,
      ...(s.mendedHandles || handlesKey(s.handles) !== s.base.handles ? { handles: s.handles } : {}),
      ...(placeChanged() && s.profile?.place ? { place: { ...s.profile.place, street: s.street.trim(), city: s.city.trim() } } : {}),
    };
  };
  const pending = () => {
    if (!s.profile) return [];
    try {
      return changes(deps.def, s.profile, edit());
    } catch {
      return []; // a value the file can't carry: flagged on its field; nothing to save yet
    }
  };

  /** What a field says now, for the Finder and the card. */
  const valueOf = (f: ProfileField): string => {
    if (simple(f)) return s.values[f.key] ?? "";
    if (f.kind === "place") return [s.street, s.city].filter(Boolean).join(", ");
    if (f.kind === "contacts") return s.handles.filter((h) => h.value.trim()).map((h) => h.value).join(" ");
    return "";
  };

  const issueOf = (f: ProfileField): Issue | null => {
    if (!s.profile || !simple(f)) return null;
    const file = s.profile.values.get(f.key);
    const text = s.values[f.key] ?? "";
    return check(f.kind, text, { required: f.required, literal: !!file?.literal && text === file.text });
  };

  /** Something typed that can't be written as it is: Save waits until the person has mended or changed it. */
  const blocked = (): boolean =>
    fields.some((f) => issueOf(f)?.type === "problem") ||
    s.handles.some((h) => {
      const t = types.find((x) => x.key === h.type);
      return !!t && !!h.value.trim() && checkHandle(t, h.value)?.type === "problem";
    });

  const issueHtml = (key: string, issue: Issue | null, was: string, attr: string): string => {
    if (!issue) return "";
    if (issue.type === "problem") return `<p class="wb-aside wb-issue problem" data-issue="${esc(key)}">${esc(ui(WHY[issue.why]))}</p>`;
    return `<p class="wb-aside wb-issue fix" data-issue="${esc(key)}"><strong>${esc(ui("uiProfileNeedsFix"))}</strong> ${esc(ui(WHY[issue.why]))}
      ${esc(ui("uiProfileFixing", { was, fixed: issue.fixed }))}
      <button type="button" class="inline-link" ${attr}>${esc(ui("uiProfileFix"))}</button></p>`;
  };

  const fieldHtml = (f: ProfileField): string => {
    const id = fieldInput(f.key);
    const label = `<label class="wb-field-label" for="${id}">${esc(f.label)}</label>`;
    const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : "";
    const busy = s.status !== "ready" && s.status !== "done" ? " disabled" : "";
    if (f.kind === "place") {
      const bad = s.profile?.placeProblem;
      return `<div class="wb-tool-field" data-field="${esc(f.key)}">
        <p class="wb-field-label">${esc(f.label)}</p>${hint}
        ${bad ? `<p class="wb-aside wb-issue problem">${esc(ui("uiProfileAddressProblem"))}</p>` : `
        <label class="wb-field" for="${id}">${esc(ui("uiProfileStreet"))}<input id="${id}" name="street" type="text" autocomplete="street-address" value="${esc(s.street)}"${busy} /></label>
        <label class="wb-field" for="${id}-city">${esc(ui("uiProfileCity"))}<input id="${id}-city" name="city" type="text" autocomplete="address-level2" value="${esc(s.city)}"${busy} /></label>
        <p class="wb-pin" id="tool-pin"></p>`}
      </div>`;
    }
    if (f.kind === "contacts") {
      const rows = s.handles
        .map((h, i) => {
          const t = types.find((x) => x.key === h.type);
          const opts = types.map((x) => `<option value="${esc(x.key)}"${x.key === h.type ? " selected" : ""}>${esc(x.label)}</option>`).join("");
          const issue = t && h.value.trim() ? checkHandle(t, h.value) : null;
          return `<div class="wb-handle" data-handle="${i}">
            <span class="sp-channel on" aria-hidden="true">${contactPicto(h.type)}</span>
            <select aria-label="${esc(ui("uiProfileHandleKind"))}" data-handle-type="${i}"${busy}>${opts}</select>
            <input type="text" aria-label="${esc(ui("uiProfileHandleValue"))}" data-handle-value="${i}" value="${esc(h.value)}" placeholder="${esc(t?.placeholder ?? "")}"${busy} />
            <button type="button" class="inline-link" data-handle-remove="${i}"${busy}>${esc(ui("uiProfileRemoveHandle"))}</button>
          </div>${issueHtml(`handle-${i}`, issue, h.value, `data-handle-fix="${i}"`)}`;
        })
        .join("");
      const others = s.profile?.contacts?.others ?? [];
      return `<div class="wb-tool-field" data-field="${esc(f.key)}">
        <p class="wb-field-label">${esc(f.label)}</p>${hint}
        ${rows}
        <button type="button" class="btn btn-ghost" data-handle-add${busy}>${esc(ui("uiProfileAddHandle"))}</button>
        ${others.length ? `<ul class="wb-aside">${others.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      </div>`;
    }
    const value = s.values[f.key] ?? "";
    const type = f.kind === "email" ? "email" : f.kind === "url" || f.kind === "image" ? "url" : "text";
    const several = many(f) ? `<p class="wb-aside">${esc(ui("uiProfileMany"))}</p>` : "";
    const upload = f.kind === "image" && deps.uploadLogo
      ? `<div class="wb-form-actions"><button type="button" class="btn" data-upload="${esc(f.key)}"${busy}>${esc(logoUi("uiLogoUpload"))}</button>
          <input type="file" data-upload-file="${esc(f.key)}" accept="${LOGO_TYPES.join(",")}" hidden /><span class="hint">${esc(logoUi("uiLogoHint"))}</span></div>`
      : "";
    const control = upload + `<input id="${id}" name="${esc(f.key)}" type="${type}" value="${esc(value)}" placeholder="${esc(f.placeholder ?? "")}"${f.hint ? ` aria-describedby="${id}-hint"` : ""}${busy}${many(f) ? " readonly" : ""} />`;
    return `<div class="wb-tool-field" data-field="${esc(f.key)}">${label}${hint}${control}${several}${issueHtml(f.key, issueOf(f), value, `data-fix="${esc(f.key)}"`)}</div>`;
  };

  const sectionHtml = (sec: Section): string => {
    const own = fields.filter((f) => f.section === sec.id);
    return own.length ? `<section class="wb-tool-section" data-section="${esc(sec.id)}"><h3 class="wb-tool-heading">${esc(sec.label)}</h3>${own.map(fieldHtml).join("")}</section>` : "";
  };

  const foundHtml = (): string => {
    const rows: FindRow[] = fields.map((f) => ({ key: f.key, label: f.label, section: f.section, value: valueOf(f) }));
    const groups = finderResults(s.query, rows, sections);
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    const flat = groups.flatMap((g) => g.rows);
    return !s.query.trim()
      ? ""
      : total
        ? `<div class="fd-meta"><span>${esc(ui("uiProfileFindCount", { n: String(total) }))}</span></div>` +
          groups
            .map((g) => `<p class="fd-head">${esc(sections.find((x) => x.id === g.section)?.label ?? g.section)}<span class="n">${g.rows.length}</span></p>` +
              g.rows.map((r) => `<button type="button" class="fd-row${flat.indexOf(r) === s.pick ? " on" : ""}" data-goto="${esc(r.key)}"><b>${mark(r.label, s.query)}</b><span>${r.value ? mark(r.value, s.query) : `<em>${esc(ui("uiProfileEmpty"))}</em>`}</span></button>`).join(""))
            .join("")
        : `<p class="wb-aside">${esc(ui("uiProfileFindNone"))}</p>`;
  };

  const finderHtml = (): string => {
    return `<div class="wb-tool-find" role="search">
      <div class="fd-bar"><span class="g" aria-hidden="true">⌕</span>
        <input id="tool-find" type="search" autocomplete="off" aria-label="${esc(ui("uiProfileFind"))}" placeholder="${esc(ui("uiProfileFindPlaceholder"))}" value="${esc(s.query)}" />
        ${s.query ? `<button type="button" class="x" data-find-clear aria-label="Clear">✕</button>` : `<span class="key" aria-hidden="true">/</span>`}</div>
      <div id="tool-found" aria-live="polite">${foundHtml()}</div></div>`;
  };

  /** The pin as the map would draw it from what is typed: the popup over the small map. */
  const popupHtml = (): string => {
    const p = s.profile?.place;
    const city = s.city.trim();
    return livePopup({
      id: "", name: s.values.name?.trim() || "—", lat: p?.lat ?? 0, lon: p?.lon ?? 0, city, country: p?.country ?? "", hours: "",
      address: [city, p?.country].filter(Boolean).join(", "), logo: s.values.logo?.trim() ?? "",
    });
  };

  /** What the map's profile shows under the popup, in its order (web/app.js Quick facts). */
  const factsHtml = (): string => {
    const handles = s.handles.filter((h) => h.value.trim());
    const dash = `<em class="pv-empty">—</em>`;
    const row = (k: string, v: string | undefined) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : dash}</dd>`;
    return `<span class="wb-aside">${esc(map("uiCardFacts"))}</span>
      <dl class="pv-facts">
        ${row("Description", s.values.description?.trim())}${row("Website", s.values.website?.trim())}${row("Hours", s.values.hours?.trim())}${row("Next event", "")}
        <dt>Contact</dt><dd>${handles.length ? `<span class="sp-channels">${handles.map((h) => `<span class="sp-channel on" title="${esc(h.value)}">${contactPicto(h.type)}</span>`).join("")}</span>` : dash}</dd>
      </dl>`;
  };

  /** The file as the pod holds it, the last save's lines marked: the source to cross-check the card against. */
  const fileHtml = (): string =>
    !s.text
      ? ""
      : `<div class="wb-tool-file">
          <p class="wf-label">${esc(map("uiFileLabel"))}</p>
          <div class="sp-terminal-wrap">
            <div class="sp-terminal-head"><span>Turtle · space.ttl</span><span>${esc(map("uiFileFrom"))}</span></div>
            <pre class="turtle sp-terminal-body wb-file" tabindex="0" aria-label="${esc(map("uiFileLabel"))}">${highlightTurtle(s.text, s.changed ?? undefined)}</pre>
          </div>
        </div>`;

  const stepsHtml = (): string => {
    if (s.status === "ready" && !s.message) return "";
    const step = (m: "done" | "working" | "failed" | "idle", name: string, detail = "") =>
      `<li class="sp-unlock-step">${marker(m)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""}</span></li>`;
    const list: string[] = [];
    const placed = !!s.found;
    if (s.status === "finding") list.push(step("working", move("uiMoveFinding")));
    if (placed) list.push(step("done", move("uiMoveFound", { place: s.found }), s.missed ? move("uiMoveStreetMissed", { city: s.city }) : ""));
    if (s.status === "writing") list.push(step("working", move("uiMoveWriting")));
    if (s.status === "done") {
      list.push(step("done", move("uiMoveWritten")));
      if (s.map === "working") list.push(step("working", map("uiStepMapReading"), map("uiStepMapReadingWhy")));
      if (s.map === "done") list.push(step("done", map("uiStepMapRead")));
      if (s.map === "late") list.push(step("done", map("uiStepMapRead"), map("uiStepMapLate")));
      if (s.map === "failed") list.push(step("failed", map("uiStepMapReading"), map("uiMapDidntRead")));
    }
    return `${list.length ? `<ol class="wb-steps" id="tool-steps">${list.join("")}</ol>` : ""}${s.message ? `<p class="wb-aside" id="tool-message" tabindex="-1">${esc(s.message)}</p>` : ""}`;
  };

  /** The chip, the summary, Save and the steps: what follows each keystroke. */
  const liveHtml = (): string => {
    const list = pending();
    const busy = s.status === "finding" || s.status === "writing" || blocked();
    const labels = list.map((c) => fields.find((f) => f.key === c.key)?.label ?? c.key);
    const summary = !list.length
      ? ui("uiProfileNothing")
      : `${list.length === 1 ? ui("uiProfileChangeOne") : ui("uiProfileChangeMany", { n: String(list.length) })}: ${labels.join(", ")}.${list.some((c) => fields.find((f) => f.key === c.key)?.kind === "place") ? ` ${ui("uiProfilePinMoves")}` : ""}`;
    return `<p class="wb-aside" id="tool-summary">${esc(summary)}</p>
      <div class="wb-form-actions"><button type="button" class="btn btn-primary" id="tool-save"${list.length && !busy ? "" : " disabled"}>${esc(ui("uiProfileSave"))}</button></div>
      <div id="tool-progress">${stepsHtml()}</div>`;
  };
  const chipHtml = () => esc(pending().length ? ui("uiProfileNotSaved") : ui("uiProfileSaved"));

  const sideHtml = (): string => {
    const p = s.profile?.place;
    return `<div class="wb-flow-card wb-tool-card">
        <p class="wf-label">${esc(map("uiCardLabel"))} <span class="status-label" id="tool-chip">${chipHtml()}</span></p>
        <div class="wb-frame" id="tool-frame">${p ? miniMapSlot(p.lat, p.lon) : ""}${popupHtml()}</div>
        <div class="wb-facts-box" id="tool-facts">${factsHtml()}</div>
      </div>`;
  };

  const bodyHtml = (): string => {
    if (s.status === "loading") return `<p class="wb-aside">${esc(ui("uiProfileLoading"))}</p>`;
    if (s.status === "failed") return `<p class="wb-aside problem">${esc(ui("uiProfileLoadFailed"))}</p>`;
    const others = s.profile?.others ?? [];
    return `${finderHtml()}
      <div class="wb-tool-grid">
        <form class="wb-form wb-tool-form" id="tool-form" novalidate onsubmit="return false">${sections.map(sectionHtml).join("")}
          ${others.length ? `<section class="wb-tool-section"><h3 class="wb-tool-heading">${esc(ui("uiProfileOthers"))}</h3><p class="wb-aside">${esc(ui("uiProfileOthersHint"))}</p><ul class="wb-aside">${others.map((o) => `<li>${esc(o.split(/[/#]/).pop() ?? o)}</li>`).join("")}</ul></section>` : ""}
        </form>
        <div class="wb-tool-right">
          <div class="wb-tool-flow">${fileHtml()}${s.text ? `<span class="wb-tool-arrow" aria-hidden="true">→</span>` : ""}
            <aside class="wb-tool-side" id="tool-side" aria-label="${esc(ui("uiProfileCard"))}">${sideHtml()}<div id="tool-live">${liveHtml()}</div></aside></div>
        </div>
      </div>`;
  };

  /** Redraws everything, keeping the focused control and its caret. */
  const paint = () => {
    const a = document.activeElement as HTMLInputElement | null;
    const keep = a && box.contains(a) ? { sel: a.id ? `#${CSS.escape(a.id)}` : a.getAttribute("data-handle-value") ? `[data-handle-value="${a.getAttribute("data-handle-value")}"]` : "", at: a.selectionStart } : null;
    box.innerHTML = `<h2 class="wb-step-title" tabindex="-1">${esc(ui("uiProfileTitle"))}</h2><p class="wb-lead">${esc(ui("uiProfileLead"))}</p><div class="wb-tool" data-status="${s.status}">${bodyHtml()}</div>`;
    if (keep?.sel) {
      const el = box.querySelector<HTMLInputElement>(keep.sel);
      el?.focus();
      if (el && keep.at !== null && keep.at !== undefined && el.setSelectionRange && el.type !== "search" && el.type !== "email" && el.type !== "url") el.setSelectionRange(keep.at, keep.at);
    }
    void mountMiniMaps(box);
  };
  /** Typing: only the card, the summary and Save follow, so the field being typed in is never replaced. */
  const paintSide = () => {
    // The small map stays: only what is drawn over and under it follows.
    const set = (id: string, html: string) => {
      const el = box.querySelector<HTMLElement>(`#${id}`);
      if (el) el.innerHTML = html;
    };
    box.querySelector("#tool-frame > .wb-popup")?.insertAdjacentHTML("afterend", popupHtml());
    box.querySelector("#tool-frame > .wb-popup")?.remove();
    set("tool-facts", factsHtml());
    set("tool-live", liveHtml());
    set("tool-chip", chipHtml());
  };
  const paintIssue = (key: string, html: string) => {
    box.querySelector(`[data-issue="${CSS.escape(key)}"]`)?.remove();
    if (!html) return;
    const host = key.startsWith("handle-") ? box.querySelector(`[data-handle="${key.slice(7)}"]`) : box.querySelector(`[data-field="${CSS.escape(key)}"]`);
    if (!host) return;
    if (key.startsWith("handle-")) host.insertAdjacentHTML("afterend", html);
    else host.insertAdjacentHTML("beforeend", html);
  };

  const pinLineTo = (text: string, tone: "" | "working" | "ok" | "error") => {
    const el = box.querySelector<HTMLElement>("#tool-pin");
    if (!el) return;
    el.className = `wb-pin${tone ? ` ${tone}` : ""}`;
    el.textContent = "";
    if (text) {
      const line = document.createElement("span");
      line.className = "wb-pin-line";
      line.textContent = text;
      el.append(line);
    }
  };

  const errorLine = (err: unknown): string => {
    const code = err instanceof PublishError ? err.code : "refused";
    if (code === "incomplete") return (err as Error).message;
    const keys = {
      expired: "uiMoveExpired", "no-control": "uiMoveNoAccess", conflict: "uiMoveConflict", gone: "uiMoveGone",
      unreachable: "uiMoveUnreachable", unreadable: "uiMoveUnreadable",
    } as const;
    if (code === "unconfirmed") return ui("uiProfileUnconfirmed");
    return move(keys[code as keyof typeof keys] ?? "uiMoveRefused");
  };

  /** The lines a save changed, for the source: each field's predicate; the address with its pin; the handles. */
  const marks = (keys: readonly string[]): RegExp | null => {
    const parts: string[] = [];
    for (const k of keys) {
      const f = fields.find((x) => x.key === k);
      if (!f) continue;
      if (f.kind === "place") parts.push("streetAddress", "postalCode", "addressLocality", "addressCountry", "latitude", "longitude");
      else if (f.kind === "contacts") parts.push("contactPoint", "contactType", "email", "telephone");
      else if (f.property) parts.push(f.property.split(/[/#]/).pop()!);
    }
    return parts.length ? new RegExp(`\\b(${[...new Set(parts)].join("|")})\\b`) : null;
  };

  /** A logo file, uploaded next to the space file and pointed at (its own write, lib/logo.ts); then the file is read again. */
  const upload = async (key: string, file: File) => {
    if (saving || !deps.uploadLogo) return;
    saving = true;
    s.message = "";
    s.found = "";
    s.map = "idle";
    s.status = "writing";
    paint();
    try {
      const current = s.profile?.values.get(key)?.text || null;
      const result = await deps.uploadLogo(file, current);
      deps.onLogo?.(result.url);
      const fresh = await deps.load();
      rebase(fresh.profile, fresh.etag, fresh.text, key);
      s.changed = marks([key]);
      s.status = "done";
      s.message = logoUi(result.status === "saved" ? "uiLogoSaved" : "uiLogoReplaced");
      s.map = deps.mapRead ? "working" : "idle";
      paint();
      box.querySelector<HTMLElement>("#tool-message")?.focus();
      if (s.map === "working") void readByMap();
    } catch (err) {
      s.status = "ready";
      const code = err instanceof PublishError ? err.code : "refused";
      const keys = {
        "too-large": "uiLogoTooLarge", "not-image": "uiLogoNotImage", taken: "uiLogoTaken", "not-public": "uiLogoNotPublic",
        expired: "uiLogoExpired", "no-control": "uiLogoNoAccess", conflict: "uiLogoConflict", unreachable: "uiLogoUnreachable",
        unconfirmed: "uiLogoUnconfirmed",
      } as const;
      s.message = logoUi(keys[code as keyof typeof keys] ?? "uiLogoRefused");
      console.warn("The logo was not saved:", err);
      if (!life.signal.aborted) {
        paint();
        box.querySelector<HTMLElement>("#tool-message")?.focus();
      }
    } finally {
      saving = false;
    }
  };

  const save = async () => {
    if (saving || !s.profile) return;
    const list = pending();
    if (!list.length) return;
    saving = true;
    s.message = "";
    s.found = "";
    s.map = "idle";
    let next: Edit = edit();
    try {
      if (placeChanged()) {
        const street = s.street.trim();
        const city = s.city.trim();
        if (!city) throw new PublishError("incomplete", ui("uiProfileWhyCity"));
        s.status = "finding";
        paint();
        stopMeter = meterInto((text, tone) => pinLineTo(text, tone), deps.working);
        const started = Date.now();
        const found = await (deps.find ?? findPlace)(street, city);
        await new Promise((r) => setTimeout(r, Math.max(0, timing.minWait - (Date.now() - started))));
        stopMeter();
        const country = typeof found === "object" ? (found.answer.country_code ?? "").toUpperCase() : "";
        if (typeof found !== "object" || !/^[A-Z]{2}$/.test(country)) {
          s.status = "ready";
          s.message = move(found === "rate" ? "uiMoveRate" : found === "unavailable" ? "uiMoveUnavailable" : "uiMoveNoPlace");
          paint();
          pinLineTo(s.message, "error");
          return;
        }
        const { answer, missed } = found;
        const place: Place = { street, postcode: answer.postcode ?? "", city, country, lat: answer.lat, lon: answer.lon };
        const problem = checkPlace(place);
        if (problem?.type === "problem") throw new PublishError("incomplete", ui(WHY[problem.why]));
        s.found = shortPlace(answer.display_name) || city;
        s.missed = missed;
        next = { ...next, place };
        pinLineTo(`${s.found}`, "ok");
      }
      s.status = "writing";
      paint();
      const result = await deps.save(next);
      s.status = "done";
      fromFile(result.profile);
      s.etag = result.etag;
      s.text = result.text;
      s.changed = marks(result.changes.map((c) => c.key));
      s.message = result.status === "same" ? ui("uiProfileSame") : ui("uiProfileDone");
      s.map = result.status === "same" || !deps.mapRead ? "idle" : "working";
      deps.onSaved?.(result);
      paint();
      box.querySelector<HTMLElement>("#tool-message")?.focus();
      if (s.map === "working") void readByMap(next.place);
    } catch (err) {
      stopMeter();
      s.status = "ready";
      s.message = errorLine(err);
      // The file moved on since this screen read it: it is read again, so the next Save works from what is there.
      // What was typed is dropped, never written over what another writer put there.
      if (err instanceof PublishError && err.code === "conflict") {
        try {
          const fresh = await deps.load();
          fromFile(fresh.profile);
          s.etag = fresh.etag;
          s.text = fresh.text ?? s.text;
          s.message = ui("uiProfileChangedSince");
        } catch (again) {
          console.warn("The profile was not read again:", again);
        }
      }
      console.warn("The profile was not saved:", err);
      if (!life.signal.aborted) {
        paint();
        box.querySelector<HTMLElement>("#tool-message")?.focus();
      }
    } finally {
      saving = false;
    }
  };

  const readByMap = async (place?: Place) => {
    let read: MapReread | null = null;
    try {
      read = await deps.mapRead!(place ? (pin) => Math.abs(pin.lat - place.lat) < 1e-5 && Math.abs(pin.lon - place.lon) < 1e-5 : () => true);
    } catch (err) {
      console.warn("The map didn't read the profile:", err);
    }
    if (life.signal.aborted || saving) return;
    s.map = read ? (read.caughtUp ? "done" : "late") : "failed";
    // Typing since is kept: only the steps tick.
    const progress = box.querySelector("#tool-progress");
    if (progress) progress.innerHTML = stepsHtml();
  };

  // ---- events ----
  const typedField = (el: HTMLInputElement) => {
    const key = el.name;
    if (el.closest("[data-field]") && fields.find((f) => f.key === el.closest("[data-field]")!.getAttribute("data-field"))?.kind === "place") {
      if (el.name === "street") s.street = el.value;
      else s.city = el.value;
      if (s.status === "done") { s.status = "ready"; s.message = ""; }
      paintSide();
      return;
    }
    s.values[key] = el.value;
    if (s.status === "done") { s.status = "ready"; s.message = ""; }
    const f = fields.find((x) => x.key === key);
    if (f) paintIssue(key, issueHtml(key, issueOf(f), el.value, `data-fix="${esc(key)}"`));
    paintSide();
  };

  const handleIssue = (i: number) => {
    const h = s.handles[i];
    const t = types.find((x) => x.key === h?.type);
    paintIssue(`handle-${i}`, t && h.value.trim() ? issueHtml(`handle-${i}`, checkHandle(t, h.value), h.value, `data-handle-fix="${i}"`) : "");
  };

  box.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === "tool-find") {
      s.query = el.value;
      s.pick = 0;
      const found = box.querySelector("#tool-found");
      if (found) found.innerHTML = foundHtml();
      return;
    }
    const hv = el.getAttribute?.("data-handle-value");
    if (hv !== null && hv !== undefined) {
      s.handles[Number(hv)].value = el.value;
      handleIssue(Number(hv));
      paintSide();
      return;
    }
    if (el.closest?.("#tool-form") && el.tagName === "INPUT") typedField(el);
  }, { signal: life.signal });

  box.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    const up = el.getAttribute?.("data-upload-file");
    if (up) {
      const file = (el as unknown as HTMLInputElement).files?.[0];
      if (file) void upload(up, file);
      return;
    }
    const ht = el.getAttribute?.("data-handle-type");
    if (ht !== null && ht !== undefined) {
      s.handles[Number(ht)].type = el.value;
      paint();
      box.querySelector<HTMLInputElement>(`[data-handle-value="${ht}"]`)?.focus();
    }
  }, { signal: life.signal });

  const go = (key: string) => {
    const f = fields.find((x) => x.key === key);
    const target = box.querySelector<HTMLElement>(f?.kind === "contacts" ? `[data-field="${CSS.escape(key)}"] input, [data-field="${CSS.escape(key)}"] button` : f?.kind === "place" ? `#${fieldInput(key)}` : `#${fieldInput(key)}`);
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  };

  box.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    if (t.id === "tool-save") void save();
    else if (t.dataset.upload) box.querySelector<HTMLInputElement>(`[data-upload-file="${CSS.escape(t.dataset.upload)}"]`)?.click();
    else if (t.dataset.goto) go(t.dataset.goto);
    else if (t.hasAttribute("data-find-clear")) {
      s.query = "";
      paint();
      box.querySelector<HTMLInputElement>("#tool-find")?.focus();
    } else if (t.hasAttribute("data-handle-add")) {
      s.handles.push({ type: types[0]?.key ?? "email", value: "" });
      paint();
      box.querySelector<HTMLInputElement>(`[data-handle-value="${s.handles.length - 1}"]`)?.focus();
    } else if (t.dataset.handleRemove !== undefined) {
      s.handles.splice(Number(t.dataset.handleRemove), 1);
      paint();
    } else if (t.dataset.handleFix !== undefined) {
      const i = Number(t.dataset.handleFix);
      const ty = types.find((x) => x.key === s.handles[i]?.type);
      const issue = ty ? checkHandle(ty, s.handles[i].value) : null;
      if (issue?.type === "fix") {
        s.handles[i].value = issue.fixed;
        s.mendedHandles = true;
      }
      paint();
    } else if (t.dataset.fix !== undefined) {
      const f = fields.find((x) => x.key === t.dataset.fix);
      const issue = f ? issueOf(f) : null;
      if (f && issue?.type === "fix") {
        s.values[f.key] = issue.fixed;
        s.mended.add(f.key);
      }
      paint();
    }
  }, { signal: life.signal });

  box.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    if (el.id === "tool-find") {
      const rows = [...box.querySelectorAll<HTMLElement>("[data-goto]")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!rows.length) return;
        s.pick = (s.pick + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows.forEach((r, i) => r.classList.toggle("on", i === s.pick));
        rows[s.pick].scrollIntoView?.({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[s.pick];
        if (row?.dataset.goto) go(row.dataset.goto);
      } else if (e.key === "Escape") {
        e.preventDefault();
        s.query = "";
        paint();
        box.querySelector<HTMLInputElement>("#tool-find")?.focus();
      }
      return;
    }
    // "/" from anywhere that isn't a text control: the Finder.
    if (e.key === "/" && !(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      box.querySelector<HTMLInputElement>("#tool-find")?.focus();
    }
  }, { signal: life.signal });

  // ---- start ----
  paint();
  void deps.load().then(
    ({ profile, etag, text }) => {
      if (life.signal.aborted) return;
      fromFile(profile);
      s.etag = etag;
      s.text = text ?? "";
      s.status = "ready";
      paint();
    },
    (err) => {
      if (life.signal.aborted) return;
      console.warn("The profile was not read:", err);
      s.status = "failed";
      paint();
    }
  );

  return {
    destroy() {
      life.abort();
      stopMeter();
    },
  };
}

export { placeLine };
