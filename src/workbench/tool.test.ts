import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTree } from "../tree/parse";
import { pod, URL_ } from "../lib/fakepod";
import { loadProfile, saveProfile } from "../lib/profile";
import { finderResults, mark, mountTool, type ToolDeps, type ToolHandle } from "./tool";
import { timing } from "./where";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const tile = tree.tiles.find((t) => t.act === "hours")!;
const DEF = tree.profile;

const FILE = (name = "Weld Done") => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space, schema:Place ;
  schema:name "${name}" ;
  schema:openingHours "Mo 9-17" ;
  schema:email "hello@welddone.example" ;
  schema:address [ a schema:PostalAddress ; schema:streetAddress "Rue Haute 12" ; schema:postalCode "1000" ; schema:addressLocality "Brussels" ; schema:addressCountry "BE" ] ;
  schema:geo [ a schema:GeoCoordinates ; schema:latitude 50.8381 ; schema:longitude 4.3487 ] .
`;

let box: HTMLElement;
let tool: ToolHandle | null = null;
beforeEach(() => {
  timing.minWait = 0;
  timing.tick = 0;
  document.body.innerHTML = `<div id="box"></div>`;
  box = document.getElementById("box")!;
});
afterEach(() => tool?.destroy());

const settle = () => new Promise((r) => setTimeout(r, 0));
const open = async (p: ReturnType<typeof pod>, extra: Partial<ToolDeps> = {}) => {
  const deps: ToolDeps = {
    def: DEF, sections: DEF.sections, tile, working: "Working out where that is.",
    load: () => loadProfile(URL_, DEF, p.fetchImpl),
    save: (edit) => saveProfile(URL_, DEF, edit, p.fetchImpl),
    ...extra,
  };
  tool = mountTool(box, deps);
  await settle();
  await settle();
};
const type = (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const input = (name: string) => box.querySelector<HTMLInputElement>(`#tool-form [name="${name}"]`)!;
const save = () => box.querySelector<HTMLButtonElement>("#tool-save")!;
const writes = (p: ReturnType<typeof pod>) => p.calls.filter((c) => c.method !== "GET");

describe("the Finder (14.6 S4, #39)", () => {
  const rows = [
    { key: "name", label: "Name", section: "basics", value: "Weld Done" },
    { key: "website", label: "Website", section: "contact", value: "https://welddone.example/" },
    { key: "hours", label: "Opening hours", section: "times", value: "Mo 9-17" },
  ];
  it("matches the label or what it says, every word, accents aside, grouped in the tree's order", () => {
    expect(finderResults("weld", rows, DEF.sections).flatMap((g) => g.rows.map((r) => r.key))).toEqual(["name", "website"]);
    expect(finderResults("OPENING mo", rows, DEF.sections)[0].rows[0].key).toBe("hours");
    expect(finderResults("   ", rows, DEF.sections)).toEqual([]);
    expect(finderResults("é", [{ ...rows[0], value: "Café" }], DEF.sections)).toHaveLength(1);
  });
  it("marks what was typed and escapes the rest", () => {
    expect(mark("a<b>c", "b")).toBe("a&lt;<mark>b</mark>&gt;c");
    expect(mark("x", "(")).toBe("x");
  });
});

describe("the tool screen", () => {
  it("draws every field of the tree, from the file, and writes nothing on load", async () => {
    const p = pod(FILE());
    await open(p);
    expect(input("name").value).toBe("Weld Done");
    expect(input("hours").value).toBe("Mo 9-17");
    expect(input("street").value).toBe("Rue Haute 12");
    expect(input("city").value).toBe("Brussels");
    expect(box.querySelectorAll("[data-handle]")).toHaveLength(1);
    expect(save().disabled).toBe(true);
    expect(writes(p)).toEqual([]);
  });

  it("a typed value reaches the card and turns Save on, with what will change", async () => {
    const p = pod(FILE());
    await open(p);
    type(input("name"), "Weld Done Too");
    expect(box.querySelector(".sp-name")!.textContent).toBe("Weld Done Too");
    expect(save().disabled).toBe(false);
    expect(box.querySelector("#tool-summary")!.textContent).toMatch(/1 change: Space name\./);
    type(input("name"), "Weld Done");
    expect(save().disabled).toBe(true);
  });

  it("Save writes the change in one patch, reads it back, and the map reads it", async () => {
    const p = pod(FILE());
    const mapRead = vi.fn(async () => ({ onMap: {} as never, caughtUp: true }));
    const onSaved = vi.fn();
    await open(p, { mapRead, onSaved });
    type(input("name"), "Weld Done Too");
    save().click();
    await settle();
    await settle();
    expect(writes(p)).toHaveLength(1);
    expect(p.text()).toContain("Weld Done Too");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(mapRead).toHaveBeenCalledOnce();
    expect(box.querySelector("#tool-message")!.textContent).toMatch(/Written/);
    expect(box.querySelectorAll("#tool-steps li").length).toBeGreaterThanOrEqual(2);
    expect(save().disabled).toBe(true);
  });

  it("offers a lossless fix on tap and writes nothing until Save", async () => {
    const p = pod(FILE("  Weld Done "));
    await open(p);
    expect(box.querySelector('[data-issue="name"]')!.textContent).toMatch(/Needs a fix/);
    expect(writes(p)).toEqual([]);
    box.querySelector<HTMLButtonElement>("[data-fix=name]")!.click();
    expect(input("name").value).toBe("Weld Done");
    expect(box.querySelector('[data-issue="name"]')).toBeNull();
    expect(writes(p)).toEqual([]);
    save().click();
    await settle();
    await settle();
    expect(p.text()).toContain('"Weld Done"');
  });

  it("a problem with no safe fix is flagged, and a required field can't be saved empty", async () => {
    const p = pod(FILE());
    await open(p);
    type(input("name"), "");
    expect(box.querySelector('[data-issue="name"]')!.textContent).toMatch(/empty/);
    type(input("website"), "not a url at all");
    expect(box.querySelector('[data-issue="website"]')!.textContent).toMatch(/web address/);
    expect(save().disabled).toBe(true); // nothing is written while something typed is flagged
  });

  it("adds a contact handle with a picto, mends it on tap, and saves it", async () => {
    const p = pod(FILE());
    await open(p);
    box.querySelector<HTMLButtonElement>("[data-handle-add]")!.click();
    const sel = box.querySelector<HTMLSelectElement>('[data-handle-type="1"]')!;
    sel.value = "telegram";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    type(box.querySelector<HTMLInputElement>('[data-handle-value="1"]')!, "weld_done");
    expect(box.querySelector('[data-issue="handle-1"]')!.textContent).toMatch(/@weld_done/);
    box.querySelector<HTMLButtonElement>("[data-handle-fix='1']")!.click();
    expect(box.querySelector<HTMLInputElement>('[data-handle-value="1"]')!.value).toBe("@weld_done");
    expect(box.querySelectorAll(".sp-channels svg").length).toBe(2);
    save().click();
    await settle();
    await settle();
    expect(p.text()).toContain("https://t.me/weld_done");
  });

  it("removes a handle", async () => {
    const p = pod(FILE());
    await open(p);
    box.querySelector<HTMLButtonElement>("[data-handle-remove='0']")!.click();
    expect(save().disabled).toBe(false);
    save().click();
    await settle();
    await settle();
    expect(p.text()).not.toContain("hello@welddone.example");
  });

  it("a new address is placed by the geocoder first, then written with the pin", async () => {
    const p = pod(FILE());
    const find = vi.fn(async () => ({ answer: { lat: 51.05, lon: 3.72, postcode: "9000", country_code: "be", display_name: "Gent, Oost-Vlaanderen" }, missed: false }) as never);
    await open(p, { find });
    type(input("street"), "Korenmarkt 1");
    type(input("city"), "Gent");
    expect(box.querySelector("#tool-summary")!.textContent).toMatch(/pin moves/);
    save().click();
    await settle();
    await settle();
    await settle();
    expect(find).toHaveBeenCalledWith("Korenmarkt 1", "Gent");
    expect(p.text()).toContain("51.05");
    expect(p.text()).toContain("Korenmarkt 1");
  });

  it("an address the geocoder can't place writes nothing and keeps what was typed", async () => {
    const p = pod(FILE());
    await open(p, { find: async () => "none" });
    type(input("city"), "Nowhereville");
    save().click();
    await settle();
    await settle();
    expect(writes(p)).toEqual([]);
    expect(input("city").value).toBe("Nowhereville");
    expect(box.querySelector("#tool-message")!.textContent).toMatch(/can't place/);
  });

  it("a file that changed since the screen read it is never overwritten: it is read again, and the typing is dropped", async () => {
    const p = pod(FILE());
    await open(p);
    type(input("name"), "Mine");
    p.edit(FILE("Someone else").replace('schema:email "hello@welddone.example"', 'schema:email "hello@welddone.example", "new@welddone.example"'));
    save().click();
    await settle();
    await settle();
    await settle();
    expect(writes(p)).toEqual([]);
    expect(p.text()).toContain("Someone else");
    expect(p.text()).toContain("new@welddone.example");
    expect(input("name").value).toBe("Someone else"); // read again
    expect(box.querySelectorAll("[data-handle]")).toHaveLength(2);
    expect(box.querySelector("#tool-message")!.textContent).toMatch(/changed since/);
  });

  it("only what was changed is sent: another writer's later edit to a field left alone survives", async () => {
    const p = pod(FILE());
    await open(p);
    type(input("name"), "Weld Done Too");
    // The file is unchanged where it matters to the screen, but the ETag moved: the save is refused, not merged blindly.
    p.edit(FILE());
    save().click();
    await settle();
    await settle();
    expect(writes(p)).toEqual([]);
  });

  it("a field with several values is shown read-only and never collapsed by another change", async () => {
    const p = pod(FILE().replace('schema:openingHours "Mo 9-17"', 'schema:openingHours "Mo 9-17", "Sa 10-14"'));
    await open(p);
    expect(input("hours").readOnly).toBe(true);
    type(input("name"), "Weld Done Too");
    save().click();
    await settle();
    await settle();
    expect(p.text()).toContain("Mo 9-17");
    expect(p.text()).toContain("Sa 10-14");
    expect(p.text()).toContain("Weld Done Too");
  });

  it("a web address held as text is mended only when the person taps Fix it", async () => {
    const p = pod(FILE().replace("schema:openingHours", 'schema:url "https://welddone.example/" ;\n  schema:openingHours'));
    await open(p);
    type(input("name"), "Weld Done Too");
    save().click();
    await settle();
    await settle();
    expect(p.text()).toMatch(/schema:url|url> "https:\/\/welddone\.example\/"/); // still text
    expect(p.text()).toContain('"https://welddone.example/"');
    box.querySelector<HTMLButtonElement>("[data-fix=website]")!.click();
    expect(save().disabled).toBe(false);
    save().click();
    await settle();
    await settle();
    expect(p.text()).toContain("<https://welddone.example/>");
  });

  it("the form is locked while a write is in flight", async () => {
    const p = pod(FILE());
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await open(p, { save: async (e) => { await gate; return saveProfile(URL_, DEF, e, p.fetchImpl); } });
    type(input("name"), "Weld Done Too");
    save().click();
    await settle();
    expect(input("name").disabled).toBe(true);
    release();
    await settle();
    await settle();
    expect(input("name").disabled).toBe(false);
  });

  it("the Finder lists fields by label or value; Enter goes to the field; Esc clears", async () => {
    const p = pod(FILE());
    await open(p);
    const find = box.querySelector<HTMLInputElement>("#tool-find")!;
    type(find, "hours");
    const rows = box.querySelectorAll("[data-goto]");
    expect(rows.length).toBeGreaterThan(0);
    expect(box.querySelector("[data-goto].on")).not.toBeNull();
    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(input("hours"));
    box.querySelector<HTMLInputElement>("#tool-find")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.querySelectorAll("[data-goto]")).toHaveLength(0);
    type(box.querySelector<HTMLInputElement>("#tool-find")!, "zzzz");
    expect(box.querySelector("#tool-found")!.textContent).toMatch(/Nothing in your file/);
  });

  it("a file that can't be read says so and offers nothing to change", async () => {
    const p = pod(FILE());
    await open(p, { load: async () => { throw new Error("gone"); } });
    expect(box.textContent).toMatch(/couldn't be read/);
    expect(box.querySelector("#tool-save")).toBeNull();
  });
});
