import { describe, expect, it } from "vitest";
import { claimLink, readMembers, type Member } from "./members";

const NET = "https://zz-net.pod.example/space.ttl";
const answer = (status: number, body: unknown) => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
};

describe("a network's members on the map (#74)", () => {
  it("asks the map by the network's own file, through home's /api/ proxy", async () => {
    const map = answer(200, { id: "network_zz-net", members: [] });
    expect(await readMembers(NET, map.fetchImpl)).toEqual([]);
    expect(map.calls).toEqual([`/api/network-members?url=${encodeURIComponent(NET)}`]);
  });

  it("keeps what the map says of each one: its card, its file, a pod or not, email and matrix first", async () => {
    const map = answer(200, {
      members: [
        { id: "ingegno", name: "Ingegno", endpoint_url: "https://gitlab.example/ingegno.json", media_type: "application/json",
          contact: [{ type: "facebook", value: "https://fb.example/i" }, { type: "matrix", value: "#i:matrix.org" }, { type: "email", value: "hello@ingegno.example" }, { type: "phone", value: "  " }] },
        { id: "weld-done", name: "", endpoint_url: "https://weld-done.pod.example/space.ttl", media_type: "text/turtle", contact: [] },
        { id: "../bad", name: "Bad id" },
      ],
    });
    expect(await readMembers(NET, map.fetchImpl)).toEqual([
      { id: "ingegno", name: "Ingegno", endpoint: "https://gitlab.example/ingegno.json", onPod: false,
        contact: [{ type: "email", value: "hello@ingegno.example" }, { type: "matrix", value: "#i:matrix.org" }, { type: "facebook", value: "https://fb.example/i" }] },
      { id: "weld-done", name: "weld-done", endpoint: "https://weld-done.pod.example/space.ttl", onPod: true, contact: [] },
    ]);
  });

  it("a network the map doesn't know is no members; a map that fails says so", async () => {
    expect(await readMembers(NET, answer(404, { detail: { error: "not_a_network" } }).fetchImpl)).toEqual([]);
    await expect(readMembers(NET, answer(502, "").fetchImpl)).rejects.toMatchObject({ code: "map-down", status: 502 });
    await expect(readMembers(NET, answer(200, "<html>").fetchImpl)).rejects.toMatchObject({ code: "map-down" });
    await expect(readMembers(NET, async () => { throw new TypeError("offline"); })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("a claim link only for a member still on a file, to home with ?from=", () => {
    const file: Member = { id: "ingegno", name: "Ingegno", endpoint: "https://gitlab.example/ingegno.json", onPod: false, contact: [] };
    expect(claimLink(file)).toBe("https://home.mapsofmaking.org/?from=https%3A%2F%2Fgitlab.example%2Fingegno.json");
    expect(claimLink({ ...file, onPod: true })).toBeNull();
    expect(claimLink({ ...file, endpoint: "javascript:alert(1)" })).toBeNull();
  });
});
