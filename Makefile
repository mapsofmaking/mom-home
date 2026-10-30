# Convenience targets. Anything a single npm script already covers stays a npm
# script. Deploys are images built by CI (Dockerfile, docker-compose.yml): no
# target here pushes to a server.

.DEFAULT_GOAL := help
.PHONY: help dev build check test verify audit image clean

help: ## Show this help
	@echo "mom-home — home.mapsofmaking.org"
	@echo
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Routing lives in hetzner-gateway; see deploy/gateway-vhost.conf."

dev: ## Vite dev server; /api goes to the map's dev stack on localhost:8080
	npm run dev

build: ## Typecheck + production build into dist/
	npm run build

check: ## Typecheck only, no build
	npm run check

test: ## Unit tests
	npm test

audit: ## Design-system checks: contrast, token completeness, a11y affordances
	npm run audit

verify: ## Everything automated: typecheck + tests + audit
	npm run verify
	@echo
	@echo "Automated checks pass. Sign-in is NOT covered — see docs/manual-tests.md."

image: ## Build the image as CI does, tagged mom-home:local
	docker build -t ghcr.io/mapsofmaking/mom-home:local .

clean: ## Remove dist/
	rm -rf dist
