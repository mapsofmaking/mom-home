import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));

const {
  aclTarget,
  aclUrlFromLink,
  isValidWebId,
  parseAcl,
  serializeAcl,
  getAccess,
  setAgentAccess,
  setAccess,
  setPublicAccess,
  removeOwnRules,
  presetOf,
  checkRawAcl,
  saveRawAcl,
} = await import("./acl");

const OWNER = "https://pod.example/alice/profile/card#me";
const AGENT = "https://pod.example/hyperscope/agents/agent#me";
const FOLDER = "https://pod.example/alice/output/";
const FOLDER_ACL = FOLDER + ".acl";
const FILE = "https://pod.example/alice/notes/report.md";
const FILE_ACL = FILE + ".acl";

function response(status: number, body = "", headers: Record<string, string> = {}): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("aclUrlFromLink", () => {
  it("finds rel=acl among other links and resolves it", () => {
    const link = '<http://www.w3.org/ns/ldp#Container>; rel="type", <.acl>; rel="acl"';
    expect(aclUrlFromLink(link, FOLDER)).toBe(FOLDER_ACL);
  });
  it("does not mistake rel=type for rel=acl", () => {
    expect(aclUrlFromLink('<http://www.w3.org/ns/ldp#Resource>; rel="type"', FOLDER)).toBeNull();
  });
});

describe("aclTarget — rule 1: a file is never ./", () => {
  it("names a container ./", () => {
    expect(aclTarget(FOLDER, FOLDER_ACL)).toBe("./");
  });
  it("names a file ./<name>, because ./ from <file>.acl is the parent folder", () => {
    expect(aclTarget(FILE, FILE_ACL)).toBe("./report.md");
  });
  it("falls back to absolute when the ACL lives elsewhere", () => {
    expect(aclTarget(FILE, "https://pod.example/acls/x.acl")).toBe(FILE);
  });
});

describe("isValidWebId — rule 4", () => {
  it("accepts a plain WebID", () => {
    expect(isValidWebId(AGENT)).toBe(true);
  });
  it.each([
    "https://evil.example/x> ; acl:mode acl:Control . <#y",
    "https://a.example/ b",
    'https://a.example/"',
    "javascript:alert(1)",
    "",
  ])("rejects %j rather than sanitizing it", (value) => {
    expect(isValidWebId(value)).toBe(false);
  });
});

describe("serializeAcl → parseAcl", () => {
  it("round-trips a container grant, with acl:default so it inherits", () => {
    const turtle = serializeAcl(FOLDER, FOLDER_ACL, OWNER, {
      agents: [{ webId: AGENT, modes: ["read"] }],
      public: [],
      authenticated: [],
    });
    expect(turtle).toContain("acl:default <./>");
    const rules = parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER);
    expect(rules.agents).toEqual([{ webId: AGENT, modes: ["read"] }]);
    expect(rules.unknown).toEqual([]);
    expect(rules.folderOnly).toEqual([]);
  });

  it("round-trips a file grant, targeting the file and not its folder", () => {
    const turtle = serializeAcl(FILE, FILE_ACL, OWNER, {
      agents: [{ webId: AGENT, modes: ["read"] }],
      public: ["read"],
      authenticated: [],
    });
    expect(turtle).not.toContain("acl:default");
    expect(turtle).toContain("acl:accessTo <./report.md>");
    const rules = parseAcl(turtle, FILE_ACL, FILE, OWNER);
    expect(rules.agents).toEqual([{ webId: AGENT, modes: ["read"] }]);
    expect(rules.public).toEqual(["read"]);
  });

  it("rule 2: always emits the owner with Read, Write and Control", () => {
    const turtle = serializeAcl(FOLDER, FOLDER_ACL, OWNER, { agents: [], public: [], authenticated: [] });
    expect(turtle).toMatch(/<#owner>[\s\S]*acl:agent <https:\/\/pod\.example\/alice\/profile\/card#me>[\s\S]*acl:mode acl:Read, acl:Write, acl:Control/);
  });

  it("round-trips the inbox shape: signed-in agents may append", () => {
    const turtle = serializeAcl(FOLDER, FOLDER_ACL, OWNER, { agents: [], public: [], authenticated: ["append"] });
    expect(parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER).authenticated).toEqual(["append"]);
  });

  it("refuses to write an invalid WebID", () => {
    expect(() =>
      serializeAcl(FOLDER, FOLDER_ACL, OWNER, {
        agents: [{ webId: "https://x.example/> . <#evil", modes: ["control"] }],
        public: [],
        authenticated: [],
      })
    ).toThrow(/Not a valid WebID/);
  });
});

describe("parseAcl — what a folder passes on", () => {
  it("counts only grants with acl:default: a CSS pod root's public Read stays on the root", () => {
    const root = "https://pod.example/neil/";
    const turtle = `@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:mode acl:Read.
<#owner> a acl:Authorization; acl:agent <${root}profile/card#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.
<#agent> a acl:Authorization; acl:agent <https://pod.example/a#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.`;
    const rules = parseAcl(turtle, root + ".acl", root, root + "profile/card#me");
    expect(rules.public).toEqual(["read"]);
    expect(rules.inherits).toEqual({ agents: [{ webId: "https://pod.example/a#me", modes: ["read"] }], public: [], authenticated: [] });
  });
});

describe("parseAcl — rule 3: what it does not understand, it reports", () => {
  const prefix = "@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n";

  it("reports a group grant as unknown", () => {
    const turtle = prefix + `<#g> a acl:Authorization; acl:agentGroup <https://x.example/g#team>;
      acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.`;
    expect(parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER).unknown).toEqual([FOLDER_ACL + "#g"]);
  });

  it("reports an origin restriction as unknown", () => {
    const turtle = prefix + `<#o> a acl:Authorization; acl:agent <${AGENT}>; acl:origin <https://app.example>;
      acl:accessTo <./>; acl:mode acl:Read.`;
    expect(parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER).unknown).toHaveLength(1);
  });

  it("reports a grant on some other resource as unknown", () => {
    const turtle = prefix + `<#x> a acl:Authorization; acl:agent <${AGENT}>;
      acl:accessTo <../elsewhere/>; acl:mode acl:Read.`;
    expect(parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER).unknown).toHaveLength(1);
  });

  it("does not merge adjacent authorizations with no blank line between them", () => {
    // The old regex parser split on blank lines, and read a public Read-only
    // grant packed against the owner block as Read+Write+Control.
    const turtle = prefix +
      `<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.\n` +
      `<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.`;
    const rules = parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER);
    expect(rules.public).toEqual(["read"]);
    expect(rules.agents).toEqual([]);
  });

  it("flags a container grant without acl:default — the universalAccess bug", () => {
    const turtle = prefix + `<#a> a acl:Authorization; acl:agent <${AGENT}>; acl:accessTo <./>; acl:mode acl:Read.`;
    const rules = parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER);
    expect(rules.folderOnly).toEqual([FOLDER_ACL + "#a"]);
    expect(rules.agents).toEqual([{ webId: AGENT, modes: ["read"] }]);
  });

  it("understands full IRIs as well as prefixed names", () => {
    const turtle = `<#a> a <http://www.w3.org/ns/auth/acl#Authorization>;
      <http://www.w3.org/ns/auth/acl#agent> <${AGENT}>;
      <http://www.w3.org/ns/auth/acl#accessTo> <${FOLDER}>;
      <http://www.w3.org/ns/auth/acl#default> <${FOLDER}>;
      <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read>.`;
    expect(parseAcl(turtle, FOLDER_ACL, FOLDER, OWNER).agents).toEqual([{ webId: AGENT, modes: ["read"] }]);
  });
});

describe("getAccess / setAgentAccess against a stubbed server", () => {
  beforeEach(() => mockFetch.mockReset());

  it("treats a missing .acl as inherited, not as no access", async () => {
    mockFetch
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(404));
    const access = await getAccess(FOLDER, OWNER);
    expect(access.inherited).toBe(true);
    expect(access.aclUrl).toBe(FOLDER_ACL);
  });

  it("creates a new .acl with If-None-Match, so it cannot clobber one written meanwhile", async () => {
    mockFetch
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(201));
    await setAgentAccess(FOLDER, OWNER, AGENT, ["read"]);
    const [url, init] = mockFetch.mock.calls[2];
    expect(url).toBe(FOLDER_ACL);
    expect(init.method).toBe("PUT");
    expect(init.headers["If-None-Match"]).toBe("*");
    expect(init.body).toContain(`acl:agent <${AGENT}>`);
    expect(init.body).toContain(`acl:agent <${OWNER}>`);
  });

  it("updates an existing .acl with If-Match and keeps the other grants", async () => {
    const existing = serializeAcl(FOLDER, FOLDER_ACL, OWNER, {
      agents: [{ webId: "https://pod.example/bob/profile/card#me", modes: ["read", "write"] }],
      public: [],
      authenticated: [],
    });
    mockFetch
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(200, existing, { etag: '"v1"' }))
      .mockResolvedValueOnce(response(205));
    await setAgentAccess(FOLDER, OWNER, AGENT, ["read"]);
    const init = mockFetch.mock.calls[2][1];
    expect(init.headers["If-Match"]).toBe('"v1"');
    expect(init.body).toContain("bob/profile/card#me");
    expect(init.body).toContain(AGENT);
  });

  it("refuses to rewrite an .acl holding a grant it does not understand", async () => {
    const turtle = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
      <#g> a acl:Authorization; acl:agentGroup <https://x.example/g#team>; acl:accessTo <./>; acl:mode acl:Read.`;
    mockFetch
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(200, turtle, { etag: '"v1"' }));
    await expect(setAgentAccess(FOLDER, OWNER, AGENT, ["read"])).rejects.toThrow(/nothing was changed/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("re-reads and retries once when the .acl moved underneath (412)", async () => {
    const v1 = serializeAcl(FOLDER, FOLDER_ACL, OWNER, { agents: [], public: [], authenticated: [] });
    mockFetch
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(200, v1, { etag: '"v1"' }))
      .mockResolvedValueOnce(response(412))
      .mockResolvedValueOnce(response(200, "", { link: '<.acl>; rel="acl"' }))
      .mockResolvedValueOnce(response(200, v1, { etag: '"v2"' }))
      .mockResolvedValueOnce(response(205));
    await setAgentAccess(FOLDER, OWNER, AGENT, ["read"]);
    expect(mockFetch.mock.calls[5][1].headers["If-Match"]).toBe('"v2"');
  });
});

describe("the permissions panel's writes (C2)", () => {
  beforeEach(() => mockFetch.mockReset());
  const head = (extra = "") => response(200, "", { link: `<.acl>; rel="acl"${extra}` });
  const v1 = serializeAcl(FOLDER, FOLDER_ACL, OWNER, { agents: [{ webId: AGENT, modes: ["read"] }], public: [], authenticated: [] });

  it("names presets, and anything else is Custom", () => {
    expect(presetOf(["read"])).toBe("read");
    expect(presetOf(["write", "read", "append"])).toBe("edit");
    expect(presetOf(["read", "append"])).toBeNull();
    expect(presetOf(["read", "write", "append", "control"])).toBeNull();
  });

  it("writes the whole state the panel shows, conditional on the ETag it read", async () => {
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(200, v1, { etag: '"v1"' })).mockResolvedValueOnce(response(205));
    await setAccess(FOLDER, OWNER, { agents: [{ webId: AGENT, modes: ["write", "read", "append"] }], public: ["read"], authenticated: [] }, '"v1"');
    const init = mockFetch.mock.calls[2][1];
    expect(init.headers["If-Match"]).toBe('"v1"');
    expect(init.body).toContain("acl:mode acl:Read, acl:Append, acl:Write.");
    expect(init.body).toContain("acl:agentClass foaf:Agent");
    expect(init.body).not.toMatch(new RegExp(`<${AGENT}>[^.]*acl:Control`));
  });

  it("writes nothing when the rules changed after the screen read them", async () => {
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(200, v1, { etag: '"v2"' }));
    await expect(setAccess(FOLDER, OWNER, { agents: [], public: [], authenticated: [] }, '"v1"')).rejects.toMatchObject({ code: "conflict" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives an inherited item rules of its own only if nobody did meanwhile", async () => {
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(201));
    await setAccess(FOLDER, OWNER, { agents: [], public: ["read"], authenticated: [] }, null);
    expect(mockFetch.mock.calls[2][1].headers["If-None-Match"]).toBe("*");

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(200, v1, { etag: '"v1"' }));
    await expect(setAccess(FOLDER, OWNER, { agents: [], public: [], authenticated: [] }, null)).rejects.toMatchObject({ code: "conflict" });
  });

  it("sets public Read and keeps the named grants", async () => {
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(200, v1, { etag: '"v1"' })).mockResolvedValueOnce(response(205));
    await setPublicAccess(FOLDER, OWNER, ["read"]);
    const body = mockFetch.mock.calls[2][1].body;
    expect(body).toContain("acl:agentClass foaf:Agent");
    expect(body).toContain(AGENT);
  });

  it("restores from parent with If-Match, never on a pod root", async () => {
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(205));
    await removeOwnRules(FOLDER, '"v1"');
    expect(mockFetch.mock.calls[1]).toEqual([FOLDER_ACL, { method: "DELETE", headers: { "If-Match": '"v1"' } }]);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(head(', <http://www.w3.org/ns/pim/space#Storage>; rel="type"'));
    await expect(removeOwnRules("https://pod.example/alice/", '"r"')).rejects.toThrow(/root/);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(412));
    await expect(removeOwnRules(FOLDER, '"old"')).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("the technical rules, edited by hand (C6)", () => {
  beforeEach(() => mockFetch.mockReset());
  const own = serializeAcl(FOLDER, FOLDER_ACL, OWNER, { agents: [{ webId: AGENT, modes: ["read", "append"] }], public: [], authenticated: [] });

  it("accepts rules that parse and keep the owner's Control", () => {
    const check = checkRawAcl(own, FOLDER, FOLDER_ACL, OWNER);
    expect(check).toMatchObject({ parseError: null, ownerKeepsControl: true });
    expect(check.rules!.agents).toEqual([{ webId: AGENT, modes: ["read", "append"] }]);
  });

  it("says why text is not Turtle", () => {
    expect(checkRawAcl("<#a> a acl:Authorization", FOLDER, FOLDER_ACL, OWNER).parseError).toBeTruthy();
  });

  it("notices the owner losing Control, or losing it over what is inside a folder", () => {
    expect(checkRawAcl(own.replace("acl:Read, acl:Write, acl:Control", "acl:Read, acl:Write"), FOLDER, FOLDER_ACL, OWNER).ownerKeepsControl).toBe(false);
    const noDefault = own.replace(/<#owner>[\s\S]*?acl:mode[^.]*\./, `<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./>; acl:mode acl:Read, acl:Write, acl:Control.`);
    expect(checkRawAcl(noDefault, FOLDER, FOLDER_ACL, OWNER).ownerKeepsControl).toBe(false);
    // A file has no acl:default.
    const file = serializeAcl(FILE, FILE_ACL, OWNER, { agents: [], public: [], authenticated: [] });
    expect(checkRawAcl(file, FILE, FILE_ACL, OWNER).ownerKeepsControl).toBe(true);
  });

  it("saves with If-Match, and nothing that fails a check or changed meanwhile", async () => {
    const head = () => response(200, "", { link: '<.acl>; rel="acl"' });
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(205));
    await saveRawAcl(FOLDER, OWNER, own, '"v1"');
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: own, headers: { "If-Match": '"v1"' } });

    mockFetch.mockReset();
    mockFetch.mockResolvedValue(head());
    await expect(saveRawAcl(FOLDER, OWNER, "not turtle <", '"v1"')).rejects.toThrow(/not valid Turtle/);
    await expect(saveRawAcl(FOLDER, OWNER, own.replace(", acl:Control", ""), '"v1"')).rejects.toThrow(/lock yourself out/);
    expect(mockFetch.mock.calls.every(([, init]) => init.method === "HEAD")).toBe(true);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(head()).mockResolvedValueOnce(response(412));
    await expect(saveRawAcl(FOLDER, OWNER, own, '"old"')).rejects.toMatchObject({ code: "conflict" });
  });
});
