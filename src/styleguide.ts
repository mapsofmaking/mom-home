/**
 * The design system, rendered from itself.
 *
 * Every value shown here is read back out of the live CSS with
 * `getComputedStyle` — nothing is restated in this file. A styleguide that
 * hardcodes its own copy of the palette cannot catch drift, which is the one
 * job it has.
 *
 * The contrast figures are computed the same way `scripts/audit.mjs` computes
 * them, so what the audit asserts in CI is what you can check by eye here.
 */
import "./styles/fonts.css";
import "./styles/core.css";
import "./styles/theme.css";
import "./styles/patterns.css";
import "./styles/editorial.css";
import "./styles/styleguide.css";
import { THEMES, currentTheme, renderThemeButton, wireThemeButton, type Theme } from "./ui/theme";

const root = document.querySelector<HTMLDivElement>("#styleguide")!;

/* ── reading the live tokens ──────────────────────────────────────────────── */

const readToken = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgb | null {
  const probe = document.createElement("div");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  const m = resolved.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/
  );
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

const over = (fg: Rgb, bg: Rgb): Rgb =>
  fg.a >= 1
    ? fg
    : {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      };

function luminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fgValue: string, bgValue: string): number | null {
  const bg = parseColor(bgValue);
  const fg = parseColor(fgValue);
  if (!bg || !fg) return null;
  const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── content ──────────────────────────────────────────────────────────────── */

const SURFACE_SLOTS = ["--surface", "--surface-elevated", "--surface-recessed"];
const TEXT_SLOTS = ["--text-primary", "--text-secondary", "--text-tertiary"];
const LINE_SLOTS = ["--border", "--border-subtle", "--selection"];
const IDENTITY_SLOTS = [
  "--accent",
  "--accent-contrast",
  "--accent-soft",
  "--accent-line",
  "--warn",
  "--warn-soft",
  "--warn-line",
  "--danger",
  "--danger-soft",
  "--code-bg",
];

/** Marks in the knowledge views only: never text, never UI state. */
const KNOW_SLOTS = [
  "--know-block",
  "--know-convergence",
  "--know-pattern",
  "--know-temporal",
  "--know-frontier",
  "--know-fresh",
  "--meter-fill",
];

const TYPE_ROLES = [
  ["--text-display", "Display"],
  ["--text-h1", "Heading 1"],
  ["--text-h2", "Heading 2"],
  ["--text-h3", "Heading 3"],
  ["--text-h4", "Heading 4"],
  ["--text-body", "Body"],
  ["--text-small", "Small"],
  ["--text-meta", "Meta"],
  ["--text-micro", "Micro"],
];

const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const RADII = ["--radius-none", "--radius-sm", "--radius-md", "--radius-lg", "--radius-mark"];

/**
 * The floor the badges hold a text token to: AA everywhere, AAA in the
 * high-contrast theme — the same two floors `npm run audit` enforces.
 */
const contrastFloor = (): { min: number; name: string } =>
  currentTheme() === "contrast" ? { min: 7, name: "AAA" } : { min: 4.5, name: "AA" };

const PREVIEW_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  contrast: "High contrast",
};

/** The three themes, as pressed-state buttons: this page's preview only. */
function renderPreview(current: Theme = currentTheme()): string {
  return `
    <div class="sg-preview" role="group" aria-label="Preview a theme">
      ${THEMES.map(
        (theme) => `<button type="button" class="ghost small" data-theme-preview="${theme}"
          aria-pressed="${theme === current}">${PREVIEW_LABELS[theme]}</button>`
      ).join("")}
      ${renderThemeButton()}
    </div>`;
}

function swatchRow(token: string, against?: string): string {
  const value = readToken(token);
  let badge = "";
  if (against) {
    const ratio = contrast(value, readToken(against));
    if (ratio !== null) {
      const floor = contrastFloor();
      const pass = ratio >= floor.min;
      badge = `<span class="badge ${pass ? "pass" : "fail"}">${ratio.toFixed(
        2
      )}:1 ${pass ? floor.name : `below ${floor.name}`}</span>`;
    }
  }
  return `
    <tr>
      <td><span class="chip" style="background:${value}"></span></td>
      <td><code>${token}</code></td>
      <td class="value">${value}</td>
      <td>${badge}</td>
    </tr>`;
}

function colorTable(title: string, tokens: string[], against?: string): string {
  return `
    <h3>${title}</h3>
    <div class="tablewrap">
      <table>
        <thead>
          <tr><th></th><th>Token</th><th>Resolved</th><th>${
            against ? `on <code>${against}</code>` : ""
          }</th></tr>
        </thead>
        <tbody>${tokens.map((t) => swatchRow(t, against)).join("")}</tbody>
      </table>
    </div>`;
}

function render(): void {
  root.innerHTML = `
    <div class="screen stack">
      <header class="sg-header">
        <div>
          <p class="label-mono">solid-kit</p>
          <h1>Design system</h1>
          <p class="lead">
            Read live from <code>core.css</code> and <code>theme.css</code>.
            Nothing on this page restates a value — if a token changes, this
            changes with it.
          </p>
        </div>
        <div class="sg-themes">
          <span class="label-mono">Preview</span>
          ${renderPreview()}
        </div>
      </header>

      <section>
        <h2>Color slots</h2>
        <p class="lead">
          Contrast is measured against the surface each token sits on. The floor
          is WCAG AA 4.5:1 — AAA 7:1 in High contrast — checked in CI by
          <code>npm run audit</code>.
        </p>
        ${colorTable("Surfaces", SURFACE_SLOTS)}
        ${colorTable("Text on --surface", TEXT_SLOTS, "--surface")}
        ${colorTable("Text on --surface-elevated", TEXT_SLOTS, "--surface-elevated")}
        ${colorTable("Lines", LINE_SLOTS)}
        ${colorTable("Identity", IDENTITY_SLOTS)}
        ${colorTable("Knowledge (marks only)", KNOW_SLOTS)}
      </section>

      <section>
        <h2>Type scale</h2>
        <div class="stack">
          ${TYPE_ROLES.map(
            ([token, label]) => `
            <div class="sg-type-row">
              <code class="sg-type-token">${token}</code>
              <span class="sg-type-size">${readToken(token)}</span>
              <span style="font-size:var(${token})">${label} — Grid, pod, séance</span>
            </div>`
          ).join("")}
        </div>
        <h3>Font roles</h3>
        <p class="font-heading">--font-heading — headings and display</p>
        <p class="font-body">--font-body — running text</p>
        <p class="font-mono">--font-mono — metadata, labels, code</p>
        <h3>Measure</h3>
        <p>
          Body text is capped at <code>--measure-body</code>. This paragraph runs
          to that limit so the line length is visible rather than described: a
          pod is the storage, a WebID is the name, and the app is only the
          process in between — which is exactly as much as one line should try
          to carry before it wraps.
        </p>
      </section>

      <section>
        <h2>Spacing &amp; radii</h2>
        <div class="stack">
          ${SPACE_STEPS.map(
            (n) => `
            <div class="sg-space-row">
              <code>--space-${n}</code>
              <span class="sg-bar" style="width:var(--space-${n})"></span>
              <span class="meta">${readToken(`--space-${n}`)}</span>
            </div>`
          ).join("")}
        </div>
        <div class="sg-radii">
          ${RADII.map(
            (token) => `
            <div class="sg-radius">
              <div class="sg-radius-box" style="border-radius:var(${token})"></div>
              <code>${token}</code>
              <span class="meta">${readToken(token)}</span>
            </div>`
          ).join("")}
        </div>
      </section>

      <section>
        <h2>Components</h2>

        <h3>Buttons</h3>
        <div class="sg-inline">
          <button>Primary</button>
          <button class="ghost">Ghost</button>
          <button disabled>Disabled</button>
        </div>
        <p class="hint">
          Tab to a button to check the focus ring — one primary action per
          screen is the rule these are built for.
        </p>

        <h3>Form</h3>
        <form class="stack" onsubmit="return false">
          <div class="field">
            <label for="sg-input">Pod or WebID</label>
            <input id="sg-input" type="url" value="https://pod.nicolasdb.eu/" />
            <p class="hint">
              Your pod's address, or your WebID if you don't know which provider
              hosts it.
            </p>
          </div>
          <div><button type="submit">Sign in</button></div>
        </form>

        <h3>Feedback</h3>
        <p class="error">
          Access refused (401) on https://pod.example/private/ — the session has
          expired, or this pod does not belong to your account.
        </p>
        <p class="hint">
          Errors say what happened and which resource refused. Never a bare
          status code, never the server's error graph.
        </p>

        <h3>Text utilities</h3>
        <div class="topbar">
          <span class="meta">solid-kit app</span>
          <button class="ghost">Sign out</button>
        </div>
        <p class="label-mono">label-mono — section labels</p>
        <p class="meta">meta — timestamps, WebIDs and paths</p>
        <p class="hint">hint — help under a field and the quiet line under a form: prose, so never mono.</p>
        <p>Inline <code>code</code> inside running text.</p>

        <h3>Editorial register</h3>
        <p class="hint">
          <code>editorial.css</code>: landings and reading pages. The serif is for
          titles and the pull line only, at 400, never bold.
        </p>
        <div class="stack">
          <p class="eyebrow">A backoffice for your pod</p>
          <h2 class="display">Your pod, and the collectives you belong to.</h2>
          <p class="pull">Who you are, who may read what, and who you work with.</p>
          <span class="brand"><span class="brand-mark" aria-hidden="true"></span>solid-kit</span>
          <ol class="how-steps">
            <li><span class="how-number">01</span><h3 class="display how-title">Your pod</h3><p class="lead">An address of your own.</p></li>
            <li><span class="how-number">02</span><h3 class="display how-title">Join a collective</h3><p class="lead">One message asks.</p></li>
          </ol>
          <div class="meter" role="meter" aria-label="Confidence" aria-valuenow="64"
               aria-valuemin="0" aria-valuemax="100" style="max-width: 20rem">
            <div class="meter-track"><div class="meter-fill" style="--value: 64%"></div></div>
            <span class="meter-value">64%</span>
          </div>
        </div>
      </section>

      <footer class="sg-footer meta">
        <p><a href="/">← Back to the app</a> · <a href="/guidelines.html">UX guidelines</a></p>
        <p>
          Checked by <code>npm run audit</code>. Live login is verified by hand —
          see <code>docs/manual-tests.md</code>.
        </p>
      </footer>
    </div>
  `;
}

/*
 * Exercising all three themes is the only way to catch a token defined in one
 * mode but not another. The app's own switch cannot do it: High contrast is
 * not in its cycle (it comes from the device). So this page has a preview of
 * its own, which stamps a theme on the page and stores nothing, beside the
 * real button (an app keeps the button, never the preview). Contrast figures
 * depend on the active theme, so either one re-renders the page; both are
 * wired once, by delegation on `root`, because render() replaces their buttons.
 */
render();
wireThemeButton(root, () => render());
root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-theme-preview]");
  if (!button) return;
  document.documentElement.dataset.theme = button.dataset.themePreview;
  render();
});
