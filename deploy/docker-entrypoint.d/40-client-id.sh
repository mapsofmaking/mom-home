#!/bin/sh
# Writes /id.jsonld, the home app's Solid-OIDC Client ID Document (solid-kit
# ADR 010, point 6), from PUBLIC_URL. Its client_id and redirect_uris must be
# this deploy's own origin, so it cannot be built into the image: the nginx
# image runs every script in /docker-entrypoint.d/ before it starts.
#
# PUBLIC_URL unset: no document, and the app signs in as before (dynamic
# registration, a random client id on the consent page).
set -eu

out=/usr/share/nginx/html/id.jsonld

if [ -z "${PUBLIC_URL:-}" ]; then
  rm -f "$out"
  echo "40-client-id: PUBLIC_URL unset, no /id.jsonld"
  exit 0
fi

# One form only, so the document, the redirect the app computes and the
# gateway agree: http(s), a host, a trailing slash, nothing JSON would need
# escaped.
case "$PUBLIC_URL" in
  http://*/ | https://*/) ;;
  *) echo "40-client-id: PUBLIC_URL must be http(s)://host/ with its trailing slash, got '$PUBLIC_URL'" >&2; exit 1 ;;
esac
case "$PUBLIC_URL" in
  *'"'* | *'\'* | *' '*) echo "40-client-id: PUBLIC_URL holds a quote, backslash or space" >&2; exit 1 ;;
esac

# client_name is APP_NAME in src/config.ts. redirect_uris is the app's root:
# redirectUrlFrom() drops the query and fragment, and the app is served at /.
# scope and grant_types are what @inrupt/solid-client-authn-browser asks for.
cat > "$out" <<JSON
{
  "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
  "client_id": "${PUBLIC_URL}id.jsonld",
  "client_name": "Maps of Making home",
  "client_uri": "${PUBLIC_URL}",
  "logo_uri": "${PUBLIC_URL}favicon.svg",
  "redirect_uris": ["${PUBLIC_URL}"],
  "post_logout_redirect_uris": ["${PUBLIC_URL}"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile offline_access webid",
  "token_endpoint_auth_method": "none"
}
JSON
echo "40-client-id: wrote /id.jsonld for ${PUBLIC_URL}"
