import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ authFetch: vi.fn() }));
import { authFetch } from "./auth";
import { makeSpacePublic, PublishError, readSpaceFile, spaceFileUrl, writeSpaceFile } from "./publish";
import { spaceFile } from "./spacefile";

const POD = "https://weld-done.pod.example/";
const draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8371", lon: "4.3458", description: "Metal shop." };
const mine = spaceFile(draft).turtle;

let calls: { method: string; url: string; init: RequestInit }[];
/** What the pod holds, and how it answers a PUT. */
let held: string | null;
let putStatus: number | null;

const pod: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push({ method, url, init: init ?? {} });
  if (method === "PUT") {
    if (putStatus) return new Response("", { status: putStatus });
    if (held !== null && (init?.headers as Record<string, string>)["If-None-Match"] === "*") return new Response("exists", { status: 412 });
    held = String(init?.body);
    return new Response("", { status: 201 });
  }
  return held === null ? new Response("", { status: 404 }) : new Response(held, { status: 200 });
};

beforeEach(() => {
  calls = [];
  held = null;
  putStatus = null;
});

describe("writeSpaceFile (14.4 AC2, AC5)", () => {
  it("writes space.ttl at the pod root, create-only, as Turtle, and reads it back", async () => {
    const r = await writeSpaceFile(POD, draft, pod);
    expect(r).toEqual({ url: POD + "space.ttl", status: "written", dropped: [] });
    expect(calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    const put = calls[0].init;
    expect((put.headers as Record<string, string>)["Content-Type"]).toBe("text/turtle");
    expect((put.headers as Record<string, string>)["If-None-Match"]).toBe("*");
    expect(put.body).toBe(mine);
    expect(held).toBe(mine);
  });

  it("finds the root whether or not it ends with a slash", () => {
    expect(spaceFileUrl("https://a.example")).toBe("https://a.example/space.ttl");
    expect(spaceFileUrl("https://a.example/")).toBe("https://a.example/space.ttl");
  });

  it("a second press with the file already there says the same: nothing is written again", async () => {
    await writeSpaceFile(POD, draft, pod);
    calls = [];
    const r = await writeSpaceFile(POD, draft, pod);
    expect(r.status).toBe("already-there");
    expect(held).toBe(mine);
  });

  it("never overwrites a file that says something else (the coordinator's own edit, tile C)", async () => {
    held = mine.replace("Metal shop.", "Edited by hand, later.");
    const r = await writeSpaceFile(POD, draft, pod);
    expect(r.status).toBe("kept-existing");
    expect(held).toContain("Edited by hand");
  });

  it("a draft that is not enough writes nothing and says what is missing", async () => {
    const err = await writeSpaceFile(POD, { name: "x" }, pod).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err).toMatchObject({ code: "incomplete", missing: ["town", "country", "pin"] });
    expect(calls).toEqual([]);
  });

  it("tells a session that ended from a refusal and from a pod that does not answer", async () => {
    for (const status of [401, 403]) {
      putStatus = status;
      await expect(writeSpaceFile(POD, draft, pod)).rejects.toMatchObject({ code: "expired", status });
    }
    putStatus = 500;
    await expect(writeSpaceFile(POD, draft, pod)).rejects.toMatchObject({ code: "refused", status: 500 });
    putStatus = null;
    const down: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(writeSpaceFile(POD, draft, down)).rejects.toMatchObject({ code: "unreachable" });
  });

  it("an expired session on the read of a file already there is 'expired', not 'missing'", async () => {
    const f: typeof fetch = async (_input, init) =>
      init?.method === "PUT" ? new Response("", { status: 412 }) : new Response("", { status: 401 });
    await expect(writeSpaceFile(POD, draft, f)).rejects.toMatchObject({ code: "expired" });
  });

  it("a pod that took the write but holds something else is 'unreadable'", async () => {
    const f: typeof fetch = async (_input, init) =>
      init?.method === "PUT" ? new Response("", { status: 201 }) : new Response("<> a <#x> .", { status: 200 });
    await expect(writeSpaceFile(POD, draft, f)).rejects.toMatchObject({ code: "unreadable" });
  });

  it("times out every request", async () => {
    await writeSpaceFile(POD, draft, pod);
    for (const c of calls) expect(c.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports what was left out of the file", async () => {
    const r = await writeSpaceFile(POD, { ...draft, website: "javascript:alert(1)" }, pod);
    expect(r.dropped).toEqual(["website"]);
    expect(held).not.toContain("javascript");
  });
});

describe("readSpaceFile (#11)", () => {
  const answer = (status: number, body = ""): typeof fetch => async () => new Response(body, { status });

  it("reads the space at the pod root back into a draft", async () => {
    held = mine;
    const r = await readSpaceFile(POD, pod);
    expect(r).toEqual({ url: POD + "space.ttl", space: POD + "space.ttl#space", draft });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("is null when there is no file yet", async () => {
    expect(await readSpaceFile(POD, pod)).toBeNull();
  });

  it("says the session ended on 401 and 403, never that the file is missing", async () => {
    for (const status of [401, 403]) {
      await expect(readSpaceFile(POD, answer(status))).rejects.toMatchObject({ code: "expired", status });
    }
  });

  it("says unreadable for a file that holds no space or isn't Turtle", async () => {
    await expect(readSpaceFile(POD, answer(200, '<#x> <https://schema.org/name> "x" .'))).rejects.toMatchObject({ code: "unreadable" });
    await expect(readSpaceFile(POD, answer(200, "<html> nope"))).rejects.toBeInstanceOf(PublishError);
  });

  it("is unreachable when the pod doesn't answer", async () => {
    await expect(readSpaceFile(POD, async () => { throw new TypeError("network"); })).rejects.toMatchObject({ code: "unreachable" });
  });
});

describe("makeSpacePublic (14.4 S2, #12; kit ADR 003)", () => {
  const FILE = POD + "space.ttl";
  const ACL = FILE + ".acl";
  const OWNER = POD + "profile/card#me";
  const PUBLIC_READ = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./space.ttl>; acl:mode acl:Read, acl:Write, acl:Control.
<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./space.ttl>; acl:mode acl:Read.\n`;

  /** The pod's rules for the file: null = no own .acl (inherited). */
  let acl: string | null;
  let headStatus: number;
  let writes: { url: string; headers: Record<string, string>; body: string }[];
  const anonOk: typeof fetch = async () => new Response(mine, { status: 200 });

  beforeEach(() => {
    acl = null;
    headStatus = 200;
    writes = [];
    vi.mocked(authFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "HEAD") return new Response(null, { status: headStatus, headers: { Link: '<space.ttl.acl>; rel="acl"' } });
      if (url === ACL && method === "GET") return acl === null ? new Response("", { status: 404 }) : new Response(acl, { status: 200, headers: { ETag: '"v1"' } });
      if (url === ACL && method === "PUT") {
        const headers = init!.headers as Record<string, string>;
        if (headers["If-None-Match"] === "*" && acl !== null) return new Response("", { status: 412 });
        writes.push({ url, headers, body: String(init!.body) });
        acl = String(init!.body);
        return new Response("", { status: 201 });
      }
      return new Response("", { status: 500 });
    });
  });

  it("gives the file its own rules: the owner keeps Read, Write, Control; anyone may Read that one file", async () => {
    expect(await makeSpacePublic(FILE, OWNER, anonOk)).toEqual({ status: "made-public" });
    expect(writes).toHaveLength(1);
    const { headers, body } = writes[0];
    expect(headers["If-None-Match"]).toBe("*"); // never clobbers rules written meanwhile
    expect(body).toContain(`acl:agent <${OWNER}>`);
    expect(body).toContain("acl:mode acl:Read, acl:Write, acl:Control");
    expect(body).toContain("acl:agentClass foaf:Agent");
    // Rule 1: the target is the file, never "./" (the folder: the whole pod root).
    expect(body).toContain("acl:accessTo <./space.ttl>");
    expect(body).not.toMatch(/accessTo <\.\/>/);
    expect(body).not.toContain("acl:default");
  });

  it("writes nothing when anyone can already read it (a retry resumes)", async () => {
    acl = PUBLIC_READ;
    expect(await makeSpacePublic(FILE, OWNER, anonOk)).toEqual({ status: "already-public" });
    expect(writes).toHaveLength(0);
  });

  it("keeps a grant already there, with If-Match on the version it read", async () => {
    acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./space.ttl>; acl:mode acl:Read, acl:Write, acl:Control.
<#friend> a acl:Authorization; acl:agent <https://friend.example/card#me>; acl:accessTo <./space.ttl>; acl:mode acl:Read, acl:Write.\n`;
    await makeSpacePublic(FILE, OWNER, anonOk);
    expect(writes[0].headers["If-Match"]).toBe('"v1"');
    expect(writes[0].body).toContain("acl:agent <https://friend.example/card#me>");
    expect(writes[0].body).toContain("acl:agentClass foaf:Agent");
  });

  it("refuses rules it does not understand, and writes nothing (rule 3)", async () => {
    acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#group> a acl:Authorization; acl:agentGroup <https://pod.example/group#us>; acl:accessTo <./space.ttl>; acl:mode acl:Read.\n`;
    await expect(makeSpacePublic(FILE, OWNER, anonOk)).rejects.toMatchObject({ code: "rules-unknown" });
    expect(writes).toHaveLength(0);
  });

  it("refuses an owner WebID that could break out of the Turtle (rule 4)", async () => {
    await expect(makeSpacePublic(FILE, "https://evil.example/card#me> ; acl:mode acl:Control", anonOk)).rejects.toBeInstanceOf(PublishError);
    expect(writes).toHaveLength(0);
  });

  it("says the session ended on 401/403, never that the file is missing", async () => {
    headStatus = 401;
    await expect(makeSpacePublic(FILE, OWNER, anonOk)).rejects.toMatchObject({ code: "expired", status: 401 });
  });

  it("proves it with a read that carries no credentials, and fails when that read is refused", async () => {
    const seen: RequestInit[] = [];
    const anon: typeof fetch = async (_u, init) => {
      seen.push(init!);
      return new Response("", { status: 401 });
    };
    await expect(makeSpacePublic(FILE, OWNER, anon)).rejects.toMatchObject({ code: "not-public", status: 401 });
    expect(seen[0].credentials).toBe("omit");
  });
});
