/**
 * Tile C's tool (Story 14.6 S4, #39): every field the tree lists for the space's file, drawn from the tree's
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
import { tileUi } from "./tilewords";
import { hoursWords, marker } from "./hours";
import { moveWords } from "./move";
import { findPlace, meterInto, shortPlace, timing } from "./where";

export const PROFILE_UI_KEYS = ["uiProfileTitle", "uiProfileLead", "uiProfileLoading", "uiProfileLoadFailed", "uiProfileFind", "uiProfileFindPlaceholder", "uiProfileFindCount", "uiProfileFindNone", "uiProfileEmpty", "uiProfileCard", "uiProfileNotSaved", "uiProfileSaved", "uiProfileSave", "uiProfileNothing", "uiProfileChangeOne", "uiProfileChangeMany", "uiProfilePinMoves", "uiProfileStreet", "uiProfileCity", "uiProfileAddHandle", "uiProfileRemoveHandle", "uiProfileHandleKind", "uiProfileHandleValue", "uiProfileFix", "uiProfileFixing", "uiProfileNeedsFix", "uiProfileWhySpaces", "uiProfileWhyCase", "uiProfileWhyAsText", "uiProfileWhyScheme", "uiProfileWhyPrefix", "uiProfileWhyRoom", "uiProfileWhyHandle", "uiProfileWhyEmpty", "uiProfileWhyEmail", "uiProfileWhyPhone", "uiProfileWhyAddress", "uiProfileWhyCity", "uiProfileWhyCountry", "uiProfileWhyPin", "uiProfileAddressProblem", "uiProfileOthers", "uiProfileOthersHint", "uiProfileUnconfirmed", "uiProfileSame", "uiProfileDone", "uiProfileMany"] as const;
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
  load: () => Promise<{ profile: Profile }>;
  save: (edit: Edit) => Promise<SaveResult>;
  find?: typeof findPlace;
  mapRead?: (says: string | ((pin: Pin) => boolean)) => Promise<MapReread>;
  /** The file was written: the page keeps its own copy (the draft) in step. */
  onSaved?: (result: SaveResult) => void;
}

type Status = "loading" | "failed" | "ready" | "finding" | "writing" | "done";

interface State {
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
  const fields = [...deps.def.fields].sort((a, b) => a.prio - b.prio);
  const sections = [...deps.sections].sort((a, b) => a.prio - b.prio);
  const types = [...deps.def.contactTypes].sort((a, b) => a.prio - b.prio);
  const life = new AbortController();
  let saving = false;
  let stopMeter = () => {};
  const s: State = {
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
  };

  /** What is typed, as an edit. The address is the file's own place with the typed street and city until the geocoder places it. */
  const placeChanged = () => !!s.profile?.place && (s.street.trim() !== s.profile.place.street || s.city.trim() !== s.profile.place.city);
  const edit = (): Edit => ({
    values: s.values,
    handles: s.handles,
    ...(placeChanged() && s.profile?.place ? { place: { ...s.profile.place, street: s.street.trim(), city: s.city.trim() } } : {}),
  });
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
    const many = s.profile?.values.get(f.key)?.many ? `<p class="wb-aside">${esc(ui("uiProfileMany"))}</p>` : "";
    const control = `<input id="${id}" name="${esc(f.key)}" type="${type}" value="${esc(value)}" placeholder="${esc(f.placeholder ?? "")}"${f.hint ? ` aria-describedby="${id}-hint"` : ""}${busy} />`;
    return `<div class="wb-tool-field" data-field="${esc(f.key)}">${label}${hint}${control}${many}${issueHtml(f.key, issueOf(f), value, `data-fix="${esc(f.key)}"`)}</div>`;
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

  const cardHtml = (): string => {
    const name = s.values.name?.trim();
    const place = [s.city.trim()].filter(Boolean).join("");
    const handles = s.handles.filter((h) => h.value.trim());
    const desc = s.values.description?.trim();
    const site = s.values.website?.trim();
    const hours = s.values.hours?.trim();
    const dash = `<em class="pv-empty">—</em>`;
    return `<div class="wb-popup">
      <div class="sp-hero"><span class="sp-name hand">${esc(name || "—")}</span><span class="sp-address">${esc(place)}</span></div>
      <dl class="pv-facts">
        <dt>Description</dt><dd>${desc ? esc(desc) : dash}</dd>
        <dt>Website</dt><dd>${site ? esc(site) : dash}</dd>
        <dt>Hours</dt><dd>${hours ? esc(hours) : dash}</dd>
        <dt>Contact</dt><dd>${handles.length ? `<span class="sp-channels">${handles.map((h) => `<span class="sp-channel on" title="${esc(h.value)}">${contactPicto(h.type)}</span>`).join("")}</span>` : dash}</dd>
      </dl></div>`;
  };

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

  const sideHtml = (): string => {
    const list = pending();
    const busy = s.status === "finding" || s.status === "writing" || blocked();
    const labels = list.map((c) => fields.find((f) => f.key === c.key)?.label ?? c.key);
    const summary = !list.length
      ? ui("uiProfileNothing")
      : `${list.length === 1 ? ui("uiProfileChangeOne") : ui("uiProfileChangeMany", { n: String(list.length) })}: ${labels.join(", ")}.${list.some((c) => fields.find((f) => f.key === c.key)?.kind === "place") ? ` ${ui("uiProfilePinMoves")}` : ""}`;
    return `<p class="wf-label">${esc(ui("uiProfileCard"))} <span class="status-label">${esc(list.length ? ui("uiProfileNotSaved") : ui("uiProfileSaved"))}</span></p>
      ${cardHtml()}
      <p class="wb-aside" id="tool-summary">${esc(summary)}</p>
      <div class="wb-form-actions"><button type="button" class="btn btn-primary" id="tool-save"${list.length && !busy ? "" : " disabled"}>${esc(ui("uiProfileSave"))}</button></div>
      <div id="tool-progress">${stepsHtml()}</div>`;
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
        <aside class="wb-tool-side" id="tool-side" aria-label="${esc(ui("uiProfileCard"))}">${sideHtml()}</aside>
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
  };
  /** Typing: only the card, the summary and Save follow, so the field being typed in is never replaced. */
  const paintSide = () => {
    const side = box.querySelector<HTMLElement>("#tool-side");
    if (side) side.innerHTML = sideHtml();
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
      paintSide();
      const result = await deps.save(next);
      s.status = "done";
      fromFile(result.profile);
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
      if (issue?.type === "fix") s.handles[i].value = issue.fixed;
      paint();
    } else if (t.dataset.fix !== undefined) {
      const f = fields.find((x) => x.key === t.dataset.fix);
      const issue = f ? issueOf(f) : null;
      if (f && issue?.type === "fix") s.values[f.key] = issue.fixed;
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
    ({ profile }) => {
      if (life.signal.aborted) return;
      fromFile(profile);
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
