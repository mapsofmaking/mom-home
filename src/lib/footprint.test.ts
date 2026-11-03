import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FOOTPRINT } from "./footprint";

const SRC = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.includes(".test.") ? [join(dir, e.name)] : []
  );

/** A request that changes something, or a call to a helper that writes (kit ACL and conditional writes). */
const WRITE =
  /method:\s*["'`](put|patch|delete|post)["'`]|(?<![\w.])(writeIfMatch|updateDocument|createOnly|createIfMissing|patchInsertOnly|setAccess|setPublicAccess|setAgentAccess|setAuthenticatedAccess|removeOwnRules|saveRawAcl)\(/g;

/**
 * Every place the code writes, counted per file. A new one fails here on purpose: say in lib/footprint.ts
 * what it leaves on the pod (or that it leaves nothing), then update this count.
 */
const WRITE_SITES: Record<string, number> = {
  "lib/acl.ts": 7, // kit WAC helpers: the space's rules (space-acl)
  "lib/conditional.ts": 2, // kit conditional write: used by the settings file and the index entries
  "lib/hours.ts": 1, // space-file: changeStatement, one statement (hours, logo)
  "lib/logo.ts": 1, // logo-file (its rules through publish.ts makePublic, schema:logo through hours.ts)
  "lib/onmap.ts": 1, // map-registration
  "lib/publish.ts": 3, // space-file, space-acl
  "lib/register.ts": 4, // account
  "lib/typeindex.ts": 8, // indexes, profile-links, public/private-index-entry
  "settings/home.ts": 3, // settings-file, readme-section
  "workbench/where.ts": 1, // the geocoder: leaves nothing anywhere
};

describe("what home leaves on a pod (lib/footprint.ts, #48)", () => {
  it("knows every place the code writes", () => {
    const found: Record<string, number> = {};
    for (const file of files(SRC)) {
      let n = 0;
      // Comments don't write: block comments, and line comments not inside a URL.
      const code = readFileSync(file, "utf8").replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      for (const line of code.split("\n")) {
        // A helper's own definition is not a write; the first call after it on the same line is.
        const at = line.match(/\bfunction\s+\w+\(/);
        n += [...(at ? line.slice(at.index! + at[0].length) : line).matchAll(new RegExp(WRITE.source, "gi"))].length;
      }
      if (n) found[relative(SRC, file)] = n;
    }
    expect(found, "a write changed: say what it leaves in lib/footprint.ts, then update WRITE_SITES").toEqual(WRITE_SITES);
  });

  it("names writers that exist", () => {
    for (const m of FOOTPRINT)
      for (const at of m.writtenBy) {
        const [file, fn] = at.split(":");
        expect(readFileSync(join(SRC, file), "utf8"), at).toMatch(new RegExp(`function ${fn}\\(`));
      }
  });

  it("has one entry per id, and every one is in docs/reference/pod-footprint.md", () => {
    const ids = FOOTPRINT.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const doc = readFileSync(join(SRC, "../docs/reference/pod-footprint.md"), "utf8");
    for (const id of ids) expect(doc, id).toContain(`\`${id}\``);
  });
});
