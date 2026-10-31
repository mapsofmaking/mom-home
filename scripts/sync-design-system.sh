#!/usr/bin/env bash
# Copies the Maps of Making design system's tokens, components, Workbench
# layer and fonts from one commit of mapsofmaking/design-system into
# src/styles/mom/. The design-system repo is the source: change it there
# first, then run this with the new commit and update the pin in README.md.
#
#   scripts/sync-design-system.sh <commit> [path to a design-system checkout]
#
# Two changes on the way in, both in components.css:
# - its Google Fonts @import is dropped: tokens.css already declares the same
#   faces from fonts/, and the app makes no third-party request;
# - its bare body, button and a rules are dropped: the kit owns base elements
#   (core.css) and the skin colours them; the map's resets stripped the kit's
#   buttons. Classes (.btn, .status-label, ...) and :focus-visible stay.
set -euo pipefail

commit="${1:?usage: $0 <commit> [design-system checkout]}"
ds="${2:-$HOME/github/mom-design-system}"
out="$(cd "$(dirname "$0")/.." && pwd)/src/styles/mom"

git -C "$ds" cat-file -e "$commit^{commit}"
rm -rf "$out"
mkdir -p "$out/fonts"

for f in tokens.css components.css workbench.css workbench.md; do
  git -C "$ds" show "$commit:tokens/$f" > "$out/$f"
done
sed -i -e '/^@import url(.https:\/\/fonts\.googleapis\.com/d' \
  -e '/^body {/d' -e '/^button {/d' -e '/^a {/d' "$out/components.css"

git -C "$ds" ls-tree --name-only "$commit" tokens/fonts/ | while read -r f; do
  git -C "$ds" show "$commit:$f" > "$out/fonts/$(basename "$f")"
done

echo "src/styles/mom/ now holds design-system $(git -C "$ds" rev-parse --short "$commit")"
