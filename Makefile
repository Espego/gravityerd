.PHONY: up up-detached down node-deps build test test-js test-go test-db test-e2e security clean

COMPOSE = docker compose
COMPOSE_ALL = $(COMPOSE) --profile tools --profile test

define with_cleanup
	@set -eu; \
	cleanup() { \
		status=$$?; cleanup_status=0; containers=; \
		trap - EXIT INT TERM; \
		$(COMPOSE_ALL) down --remove-orphans || cleanup_status=$$?; \
		containers="$$($(COMPOSE_ALL) ps -aq)" || cleanup_status=$$?; \
		if [ -n "$$containers" ]; then echo "GravityERD containers remain after cleanup: $$containers" >&2; cleanup_status=1; fi; \
		if [ $$status -ne 0 ]; then exit $$status; fi; \
		exit $$cleanup_status; \
	}; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	trap cleanup EXIT; \
	$(1)
endef

node-deps:
	$(COMPOSE) --profile tools run --rm node npm ci --prefer-offline --no-audit

up: node-deps
	$(call with_cleanup,$(COMPOSE) up --remove-orphans web)

up-detached: node-deps
	$(COMPOSE) up -d --wait web

down:
	$(COMPOSE_ALL) down --remove-orphans

build: node-deps
	$(COMPOSE) --profile tools run --rm node sh -c 'npm run examples && npm run build'
	git diff --exit-code -- examples

test: test-js test-go test-db test-e2e

test-js: node-deps
	$(call with_cleanup,$(COMPOSE) --profile tools run --rm node sh -c 'npm run examples && npm test')
	git diff --exit-code -- examples

test-go:
	$(call with_cleanup,$(COMPOSE) --profile test run --rm go-test)

test-db:
	$(call with_cleanup, \
		$(COMPOSE) --profile test up -d --wait postgres; \
		$(COMPOSE) --profile test run --rm --no-deps schema-integration go test -tags=integration -run '^TestDatabaseExporters$$/^postgresql$$' ./internal/exporter; \
		$(COMPOSE) --profile test rm --stop --force postgres; \
		$(COMPOSE) --profile test up -d --wait mysql; \
		$(COMPOSE) --profile test run --rm --no-deps schema-integration go test -tags=integration -run '^TestDatabaseExporters$$/^mysql$$' ./internal/exporter; \
		$(COMPOSE) --profile test rm --stop --force mysql)

test-e2e: node-deps
	$(call with_cleanup, \
		$(COMPOSE) --profile test up -d --wait web; \
		$(COMPOSE) --profile test run --rm playwright)

security: node-deps
	$(call with_cleanup,$(COMPOSE) --profile tools run --rm node npm audit --audit-level=moderate)
	$(call with_cleanup,$(COMPOSE) --profile test run --rm go-test sh -c 'go vet ./... && go tool govulncheck ./...')
	sh scripts/scan-secrets.sh

clean:
	$(COMPOSE_ALL) down --remove-orphans -v
