import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ authFetch: vi.fn() }));
import { PublishError, spaceFileUrl, writeSpaceFile } from "./publish";
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
