import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { parseTree, type ContactType } from "../tree/parse";
import { checkHandle, readContacts } from "./contacts";
import { pod, URL_ } from "./fakepod";
import { readSpaceFile } from "./hours";
import { saveProfile } from "./profile";
import type { PublishError } from "./publish";

const DEF = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8")).profile;
const T = (key: string) => DEF.contactTypes.find((t) => t.key === key) as ContactType;
const S = "https://schema.org/";

const FILE = (contacts = "") => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space ; schema:name "Weld Done" ;
  schema:address [ schema:addressLocality "Brussels" ; schema:addressCountry "BE" ] ;
  schema:geo [ schema:latitude 50.8 ; schema:longitude 4.3 ]${contacts} .
`;
const MATRIX = ` ;\n  schema:contactPoint [ a schema:ContactPoint ; schema:contactType "Matrix" ; schema:url <https://matrix.to/#/%23welddone:matrix.org> ]`;

const read = async (p: ReturnType<typeof pod>) => readContacts(await readSpaceFile(URL_, p.fetchImpl), DEF.contactTypes);
const urls = (text: string) => new Parser({ baseIRI: URL_ }).parse(text).filter((q) => q.predicate.value === S + "url").map((q) => q.object.value);
const save = (p: ReturnType<typeof pod>, handles: { type: string; value: string }[]) => saveProfile(URL_, DEF, { handles }, p.fetchImpl);

describe("contact handles: one or many (14.6 S4, #39)", () => {
  it("reads each kind from its place: email and phone as statements, the rest as contact points", async () => {
    const c = await read(pod(FILE(` ;\n  schema:email "a@b.example", "c@d.example" ;\n  schema:telephone "+32 2 000 00 00"${MATRIX} ;
  schema:contactPoint [ schema:contactType "Telegram" ; schema:url <https://t.me/welddone> ]`)));
    expect(c.handles.map((h) => [h.type, h.value])).toEqual([
      ["email", "a@b.example"], ["email", "c@d.example"], ["phone", "+32 2 000 00 00"], ["matrix", "#welddone:matrix.org"], ["telegram", "@welddone"],
    ]);
    expect(c.others).toEqual([]);
  });

  it("a contact point it doesn't fully understand is listed, and left alone on save", async () => {
    const odd = ` ;\n  schema:contactPoint [ schema:contactType "Fax" ; schema:url <https://fax.example/1> ] ;
  schema:contactPoint [ schema:contactType "Discord" ; schema:url <https://discord.gg/x> ; schema:availableLanguage "nl" ]`;
    const p = pod(FILE(odd));
    const c = await read(p);
    expect(c.handles).toEqual([]);
    expect(c.others).toEqual(["Fax: https://fax.example/1", "Discord: https://discord.gg/x"]);
    await save(p, [{ type: "signal", value: "https://signal.group/#abc" }]);
    expect(urls(p.text())).toEqual(expect.arrayContaining(["https://fax.example/1", "https://discord.gg/x", "https://signal.group/#abc"]));
  });

  it("adds several, of one kind or many, as named contact points", async () => {
    const p = pod(FILE());
    await save(p, [
      { type: "discord", value: "https://discord.gg/one" }, { type: "discord", value: "https://discord.gg/two" },
      { type: "telegram", value: "@welddone" }, { type: "phone", value: "+32 2 111 11 11" }, { type: "email", value: "hi@w.example" },
    ]);
    const c = await read(p);
    expect(c.handles.map((h) => [h.type, h.value]).sort()).toEqual([
      ["discord", "https://discord.gg/one"], ["discord", "https://discord.gg/two"], ["email", "hi@w.example"],
      ["phone", "+32 2 111 11 11"], ["telegram", "@welddone"],
    ]);
    expect(c.handles.filter((h) => h.node).every((h) => h.node!.termType === "NamedNode")).toBe(true);
    expect(urls(p.text())).toContain("https://t.me/welddone");
  });

  it("takes one away and keeps the others as they were, blank nodes and all", async () => {
    const p = pod(FILE(`${MATRIX} ;\n  schema:email "a@b.example"`));
    await save(p, [{ type: "matrix", value: "#welddone:matrix.org" }]);
    const c = await read(p);
    expect(c.handles.map((h) => h.type)).toEqual(["matrix"]);
    expect(c.handles[0].node!.termType).toBe("BlankNode");
    await save(p, []);
    expect((await read(p)).handles).toEqual([]);
    expect(p.text()).not.toContain("ContactPoint");
  });

  it("changing one is taking the old away and adding the new, in one patch", async () => {
    const p = pod(FILE(MATRIX));
    await save(p, [{ type: "matrix", value: "#other:matrix.org" }]);
    expect(p.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(urls(p.text())).toEqual(["https://matrix.to/#/%23other:matrix.org"]);
  });

  it("a link held as text is mended by saving it", async () => {
    const p = pod(FILE(` ;\n  schema:contactPoint [ schema:contactType "Discord" ; schema:url "https://discord.gg/x" ]`));
    expect((await read(p)).handles[0].literal).toBe(true);
    const r = await save(p, [{ type: "discord", value: "https://discord.gg/x" }]);
    expect(r.status).toBe("saved");
    expect((await read(p)).handles[0].literal).toBe(false);
  });

  it("the same handles: nothing written", async () => {
    const p = pod(FILE(MATRIX));
    const r = await save(p, [{ type: "matrix", value: "#welddone:matrix.org" }]);
    expect(r.status).toBe("same");
  });

  it("a handle this file can't carry is refused, nothing written", async () => {
    const p = pod(FILE());
    const err = await save(p, [{ type: "telegram", value: "not a handle!" }]).catch((e) => e);
    expect((err as PublishError).code).toBe("incomplete");
    expect(p.calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });
});

describe("checking a handle", () => {
  it("each kind: fine, a mend that loses nothing, or a problem", () => {
    expect(checkHandle(T("email"), "mailto:a@b.example")).toEqual({ type: "fix", why: "prefix", fixed: "a@b.example" });
    expect(checkHandle(T("phone"), "+32 2 123 45 67")).toBeNull();
    expect(checkHandle(T("phone"), "02 123 45 67")).toEqual({ type: "problem", why: "phone" });
    expect(checkHandle(T("matrix"), "welddone:matrix.org")).toEqual({ type: "fix", why: "room", fixed: "#welddone:matrix.org" });
    expect(checkHandle(T("telegram"), "welddone")).toEqual({ type: "fix", why: "handle", fixed: "@welddone" });
    expect(checkHandle(T("telegram"), "https://t.me/welddone")).toBeNull();
    expect(checkHandle(T("discord"), "discord.gg/abc")).toEqual({ type: "fix", why: "scheme", fixed: "https://discord.gg/abc" });
    expect(checkHandle(T("link"), "nonsense")).toEqual({ type: "problem", why: "address" });
    expect(checkHandle(T("signal"), " https://signal.group/#x")).toEqual({ type: "fix", why: "spaces", fixed: "https://signal.group/#x" });
  });
});
