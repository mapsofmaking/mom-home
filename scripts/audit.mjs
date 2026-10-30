#!/usr/bin/env node
/**
 * Checks the parts of the design rules that a machine can actually decide.
 *
 * The rest of the UX principles are judgment and live in docs/manual-tests.md.
 * What is here is what would otherwise be a comment nobody re-checks:
 *
 *   1. every text token clears WCAG AA 4.5:1 on the surfaces it sits on, in
 *      light and dark — and AAA 7:1 in the high-contrast theme, whose borders
 *      and lines must also reach 3:1;
 *   2. every color token defined for light is also defined for dark and for
 *      high contrast — a token defined in one mode only renders one theme's
 *      text on the other theme's ground — and light stays the default: no
 *      prefers-color-scheme: dark block (ADR 008). theme.css has no
 *      prefers-contrast copy of the contrast theme either: the first-paint
 *      script resolves "same as this device" (src/ui/theme.ts). A skin may
 *      still carry one; if it does, it must be complete and agree;
 *   3. :focus-visible and prefers-reduced-motion exist at all.
 *
 * No dependencies: it reads the CSS as text on purpose, so it cannot drift
 * from what actually ships the way a duplicated token table would.
 *
 * `npm run audit -- --skin <file.css>` runs checks 1 and 2 on an identity-page
 * skin instead (solid-css-overlay's skins/, an instance's overlay/), plus the skin's own slot,
 * --border-control, which outlines inputs and must reach 3:1 (WCAG 1.4.11)
 * on the surfaces a control sits on, in every theme.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skinArg = process.argv.indexOf("--skin");
const skinPath = skinArg === -1 ? null : process.argv[skinArg + 1];
if (skinArg !== -1 && !skinPath) {
  console.error("usage: npm run audit -- --skin <skin.css>");
  process.exit(2);
}
const themeCss = readFileSync(join(root, "src/styles/theme.css"), "utf8");
const coreCss = readFileSync(join(root, "src/styles/core.css"), "utf8");
const patternsCss = readFileSync(join(root, "src/styles/patterns.css"), "utf8");
const patternsTs = readFileSync(join(root, "src/ui/patterns.ts"), "utf8");
const uxTs = readFileSync(join(root, "src/ui/ux.ts"), "utf8");

const failures = [];
const notes = [];

function report() {
  for (const note of notes) console.log(note);
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    for (const f of failures) console.error(`  FAIL  ${f}`);
    process.exit(1);
  }
  console.log(`\naudit: ${notes.length} checks passed.`);
  process.exit(0);
}

/* ── parsing ──────────────────────────────────────────────────────────────── */

/** Body of the first block whose selector line matches `pattern`. */
function blockAfter(css, pattern) {
  const start = css.search(pattern);
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

/** Every block whose selector line matches `pattern` (a global regex), concatenated. */
function blocksAll(css, pattern) {
  const out = [];
  for (const m of css.matchAll(pattern)) {
    const body = blockAfter(css.slice(m.index), pattern.source.startsWith("^") ? new RegExp(pattern.source, "m") : pattern);
    if (body) out.push(body);
  }
  return out.join("\n");
}

/** `--name: value;` pairs in a block, comments stripped. */
function tokensIn(block) {
  const out = {};
  if (!block) return out;
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/* ── color maths ──────────────────────────────────────────────────────────── */

function parseColor(value) {
  // #abc is #aabbcc: expand it, or a short hex is skipped without a word.
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) value = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i
  );
  if (rgba) {
    return {
      r: +rgba[1],
      g: +rgba[2],
      b: +rgba[3],
      a: rgba[4] === undefined ? 1 : +rgba[4],
    };
  }
  return null;
}

/** Composites a possibly-translucent color over an opaque backdrop. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fgValue, bgValue) {
  if (!fgValue || !bgValue) return null; // a missing token is reported by the completeness check
  const bg = parseColor(bgValue);
  const fgRaw = parseColor(fgValue);
  if (!bg || !fgRaw) return null;
  const fg = over(fgRaw, bg);
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_TOKENS = ["--text-primary", "--text-secondary", "--text-tertiary"];
const SURFACES = ["--surface", "--surface-elevated", "--surface-recessed"];
const MIN = 4.5;
const MIN_AAA = 7;
const MIN_LINE = 3;

function checkContrast(label, tokens, min = MIN) {
  for (const text of TEXT_TOKENS) {
    for (const surface of SURFACES) {
      if (!tokens[text] || !tokens[surface]) continue;
      const ratio = contrast(tokens[text], tokens[surface]);
      if (ratio === null) {
        notes.push(`${label}: could not compute ${text} on ${surface}`);
        continue;
      }
      const line = `${label}: ${text} on ${surface} = ${ratio.toFixed(2)}:1`;
      if (ratio < min) failures.push(`${line} — below ${min}:1`);
      else notes.push(`  ok  ${line}`);
    }
  }

  // Accent carries button labels, so its contrast against its own text matters.
  if (tokens["--accent"] && tokens["--accent-contrast"]) {
    const ratio = contrast(tokens["--accent-contrast"], tokens["--accent"]);
    const line = `${label}: --accent-contrast on --accent = ${ratio.toFixed(2)}:1`;
    if (ratio < min) failures.push(`${line} — below ${min}:1`);
    else notes.push(`  ok  ${line}`);
  }
}

/* ── 1 and 2, for one stylesheet: contrast and slot completeness ─────────── */

const isColor = (v) => /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v);

/** Checks 1 and 2 on the token blocks of `css` (theme.css, or a skin). */
function auditTokens(css, file, opts = {}) {
  // Every bare :root block: a skin may keep its fonts in one and its colours in another.
  const light = tokensIn(blocksAll(css, /^:root\s*\{/gm));
  const darkAttr = tokensIn(blockAfter(css, /:root\[data-theme="dark"\]\s*\{/));
  const contrastAttr = tokensIn(
    blockAfter(css, /:root\[data-theme="contrast"\]\s*\{/)
  );
  const contrastMedia = tokensIn(
    blockAfter(css, /:root:not\(\[data-theme\]\)\s*\{/)
  );

  if (!Object.keys(light).length) failures.push("Could not parse the :root token block.");
  if (!Object.keys(darkAttr).length)
    failures.push('Could not parse the :root[data-theme="dark"] block.');
  if (!Object.keys(contrastAttr).length)
    failures.push('Could not parse the :root[data-theme="contrast"] block.');
  const hasContrastMedia = /@media\s*\(prefers-contrast:\s*more\)/.test(css);
  if (hasContrastMedia && !opts.skin) {
    failures.push(
      `${file} has a prefers-contrast: more block — the first-paint script resolves ` +
        `"same as this device" to [data-theme="contrast"], so each theme's values live once (ADR 008).`
    );
  } else if (hasContrastMedia && !Object.keys(contrastMedia).length) {
    failures.push("Could not parse the prefers-contrast: more block.");
  }

  /* ── 1. contrast ──────────────────────────────────────────────────────────── */

  checkContrast("light", light);
  checkContrast("dark ", { ...light, ...darkAttr });
  checkContrast("contrast", { ...light, ...contrastAttr }, MIN_AAA);

  // High contrast is the theme for people who cannot find a faint outline, so
  // its lines carry meaning: every border, and the status colors as text.
  const hc = { ...light, ...contrastAttr };
  for (const [token, min] of [
    ["--border", MIN_LINE],
    ["--border-subtle", MIN_LINE],
    ["--accent-line", MIN_LINE],
    ["--warn-line", MIN_LINE],
    ["--accent", MIN_AAA],
    ["--warn", MIN_AAA],
    ["--danger", MIN_AAA],
  ]) {
    for (const surface of SURFACES) {
      const ratio = contrast(hc[token], hc[surface]);
      if (ratio === null) continue;
      const line = `contrast: ${token} on ${surface} = ${ratio.toFixed(2)}:1`;
      if (ratio < min) failures.push(`${line} — below ${min}:1`);
      else notes.push(`  ok  ${line}`);
    }
  }

  /* ── 2. slot completeness ─────────────────────────────────────────────────── */

  const lightColors = Object.keys(light).filter((k) => isColor(light[k]));

  for (const [label, block] of [
    ['the :root[data-theme="dark"] block', darkAttr],
    ['the :root[data-theme="contrast"] block', contrastAttr],
    ...(hasContrastMedia ? [["the prefers-contrast: more block", contrastMedia]] : []),
  ]) {
    const missing = lightColors.filter((k) => !(k in block));
    if (missing.length) {
      failures.push(
        `${missing.length} color token(s) defined for light but missing from ${label}: ` +
          missing.join(", ")
      );
    }
  }

  // The two contrast blocks must agree, or the switch and the OS setting disagree.
  const disagreements = Object.keys(contrastMedia).filter(
    (k) => contrastAttr[k] !== undefined && contrastAttr[k] !== contrastMedia[k]
  );
  if (disagreements.length) {
    failures.push(
      `prefers-contrast block and [data-theme="contrast"] disagree on: ${disagreements.join(", ")}`
    );
  }

  // Light is the default for everyone (ADR 008). A dark media block would quietly
  // bring back following the OS, which is the decision that ADR reverses.
  if (/@media\s*\(prefers-color-scheme:\s*dark\)/.test(css)) {
    failures.push(
      `${file} has a prefers-color-scheme: dark block — dark is an explicit choice only, see ADR 008.`
    );
  }

  // A skin's own slot: input and choice-row outlines (WCAG 1.4.11).
  if (opts.skin) {
    const themes = [["light", light], ["dark ", { ...light, ...darkAttr }], ["contrast", hc]];
    for (const [label, tokens] of themes) {
      if (!tokens["--border-control"]) {
        failures.push(`${label}: --border-control is not defined`);
        continue;
      }
      for (const surface of ["--surface", "--surface-elevated"]) {
        const ratio = contrast(tokens["--border-control"], tokens[surface]);
        if (ratio === null) continue;
        const line = `${label}: --border-control on ${surface} = ${ratio.toFixed(2)}:1`;
        if (ratio < MIN_LINE) failures.push(`${line} — below ${MIN_LINE}:1`);
        else notes.push(`  ok  ${line}`);
      }
    }
  }
}

if (skinPath) {
  auditTokens(readFileSync(skinPath, "utf8"), skinPath, { skin: true });
  report();
}
auditTokens(themeCss, "theme.css");

/* ── 3. accessibility affordances ─────────────────────────────────────────── */

if (!/:focus-visible/.test(coreCss)) {
  failures.push("core.css defines no :focus-visible style — keyboard focus is invisible.");
}
if (!/@media\s*\(prefers-reduced-motion/.test(coreCss)) {
  failures.push("core.css has no prefers-reduced-motion block.");
}
if (!/env\(safe-area-inset/.test(coreCss)) {
  failures.push("core.css uses no safe-area insets — content will sit under the notch.");
}

/* ── 4. UX patterns ───────────────────────────────────────────────────────── */

/*
  The parts of the UX guidelines a machine can decide. The rest is judgment and
  lives in docs/manual-tests.md — but these three have been got wrong in real
  code, so they are worth pinning here rather than trusting to review.
*/

// A visually-hidden helper built on display:none removes the element from the
// accessibility tree entirely, which defeats the point of having one.
const visuallyHidden = blockAfter(patternsCss, /\.visually-hidden\s*\{/);
if (!visuallyHidden) {
  failures.push("patterns.css defines no .visually-hidden — announcements have nowhere to live.");
} else if (/display\s*:\s*none/.test(visuallyHidden)) {
  failures.push(
    ".visually-hidden uses display:none, which hides it from assistive tech too."
  );
}

// An indicator whose animation is merely removed under reduced-motion sits
// parked mid-travel and reads as broken. The signal has to be replaced, not
// dropped.
const reducedMotionBlocks = patternsCss.match(
  /@media\s*\(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g
);
if (!reducedMotionBlocks?.some((b) => /\.pending-line/.test(b))) {
  failures.push("patterns.css does not give .pending-line a reduced-motion alternative.");
}

// The toast carries a time-limited action at the bottom of the screen, which is
// exactly where the gesture bar is.
const toastBlock = blockAfter(patternsCss, /\.toast\s*\{/);
if (!toastBlock || !/env\(safe-area-inset-bottom\)/.test(toastBlock)) {
  failures.push(".toast does not clear the bottom safe-area inset.");
}

// The limits are only real if the components enforce them.
for (const [constant, fn] of [
  ["MAX_CHUNKS_PER_STEP", "renderConceptCard"],
  ["MAX_CHOICES", "renderCheckpoint"],
]) {
  if (!new RegExp(`export const ${constant}`).test(uxTs)) {
    failures.push(`ux.ts no longer exports ${constant}.`);
  } else if (!new RegExp(`${constant}`).test(patternsTs)) {
    failures.push(`${fn} does not reference ${constant} — the limit is unenforced.`);
  } else {
    notes.push(`  ok  ${fn} enforces ${constant}`);
  }
}

// An error state with no way forward is a dead end, and dead ends are what
// people remember about an app. The rule is only real while renderError throws.
const renderError = blockAfter(patternsTs, /export function renderError\(/);
if (!/export const ERRORS_MUST_OFFER_RECOVERY/.test(uxTs)) {
  failures.push("ux.ts no longer states ERRORS_MUST_OFFER_RECOVERY.");
} else if (!renderError) {
  failures.push("patterns.ts exports no renderError — error states are unenforced.");
} else if (!/state\.action && !state\.recovery[\s\S]*throw new Error/.test(renderError)) {
  failures.push(
    "renderError no longer throws on an error state with neither an action nor a recovery line."
  );
} else {
  notes.push("  ok  renderError refuses an error state with no way forward");
}

/* ── report ───────────────────────────────────────────────────────────────── */

report();
