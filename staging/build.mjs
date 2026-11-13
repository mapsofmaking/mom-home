#!/usr/bin/env node
/**
 * Builds what test.mapsofmaking.org serves: staging/site/ as it is, plus the dry run made from
 * staging/dry-run.html. Out: dist-staging/ (or the folder given). Kept out of the app's own build:
 * vite never reads staging/, and nothing here ends up on home.mapsofmaking.org.
 *
 * dry-run.html is also the source of a claude.ai artifact, so it carries a copy of the tree and
 * loads its fonts and N3 from CDNs. The hosted page drops both:
 *   - the tree is the app's own public/onboarding.ttl, read at build time, so it never lags;
 *   - fonts and N3 come from this host (the gateway's policy allows no other).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** Which commit the tree comes from: the image's build arg, CI's, else the checkout's, else "local". */
function commit() {
  if (process.env.TREE_REV) return process.env.TREE_REV.slice(0, 7);
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

export function hostPage(source, tree, rev) {
  let s = source;
  const cut = (re, what) => {
    if (!re.test(s)) throw new Error("dry-run.html: not found: " + what);
    s = s.replace(re, "");
  };
  const title = (s.match(/<title>(.*?)<\/title>/) || [])[1];
  cut(/<title>.*?<\/title>\n/, "title");
  cut(/<meta name="claude:viewport-fit-sides"[^>]*>\n/, "claude meta");
  cut(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n/, "preconnect 1");
  cut(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n/, "preconnect 2");
  cut(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, "google fonts");
  const n3 = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/n3@[^"]*"><\/script>/;
  if (!n3.test(s)) throw new Error("dry-run.html: not found: the n3 script tag");
  s = s.replace(n3, '<script src="n3.min.js"></script>');

  // The tree: the app's own, not the copy kept for the artifact.
  const open = '<script type="text/turtle" id="tree">\n';
  const a = s.indexOf(open);
  if (a < 0) throw new Error("dry-run.html: not found: the tree's script tag");
  const b = s.indexOf("</script>", a);
  if (tree.includes("</script")) throw new Error("onboarding.ttl contains </script, which would end the tag");
  s = s.slice(0, a + open.length) + tree.replace(/\s*$/, "\n") + s.slice(b);
  const label = /(The tree this page runs on: mom-home public\/onboarding\.ttl), as of [0-9a-z]+/;
  if (!label.test(s)) throw new Error("dry-run.html: not found: the tree's label");
  s = s.replace(label, `$1, as of ${rev}`);

  const st0 = s.indexOf("<style>"), st1 = s.indexOf("</style>") + 8;
  const style = s.slice(st0, st1);
  s = s.slice(0, st0) + s.slice(st1);
  const face = (fam, file, w = 400, st = "normal") =>
    `@font-face{font-family:"${fam}";src:url("fonts/${file}.woff2") format("woff2");font-weight:${w};font-style:${st};font-display:swap}`;
  const fonts = [
    face("Newsreader", "newsreader-400"), face("Newsreader", "newsreader-400-italic", 400, "italic"),
    face("Special Elite", "special-elite-400"), face("Caveat", "caveat-700", 700),
    face("Inter Tight", "inter-tight-400"), face("Inter Tight", "inter-tight-600", 600),
    face("JetBrains Mono", "jetbrains-mono-500", 500), face("Commit Mono", "commit-mono-400"), face("Commit Mono", "commit-mono-700", 700),
  ].join("\n");
  if (/https?:\/\/(fonts\.g|cdn\.)/.test(s + style)) throw new Error("dry-run.html: a third-party URL is left");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
${fonts}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{margin:0}
img{max-width:100%}
</style>
${style}
</head>
<body>
${s.trim()}
</body>
</html>
`;
}

export function build(out = join(root, "dist-staging")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(here, "site"), out, { recursive: true });
  const page = hostPage(
    readFileSync(join(here, "dry-run.html"), "utf8"),
    readFileSync(join(root, "public/onboarding.ttl"), "utf8"),
    commit(),
  );
  writeFileSync(join(out, "dry-run/index.html"), page);
  // N3 from the app's own dependency: one version for the app and the dry run.
  cpSync(join(root, "node_modules/n3/browser/n3.min.js"), join(out, "dry-run/n3.min.js"));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log("staging:", out, statSync(join(out, "dry-run/index.html")).size, "bytes for the dry run");
}
