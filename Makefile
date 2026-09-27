# AI Assistant — Docker Compose convenience wrapper
# Use `make help` to see all targets.

.PHONY: help up down build up-app down-app build-app up-connector down-connector build-connector logs-connector status backfill-tenancy \
        up-preview build-preview down-preview logs-preview stats-preview

COMPOSE_FILES := -f docker-compose.yml -f services/drive-connector/docker-compose.connector.yml
BASE_COMPOSE_FILE := -f docker-compose.yml

# Artifact preview (PDF/PPTX/XLSX) needs the Gotenberg LibreOffice sidecar.
# Kept opt-in: Gotenberg (3G) and Ollama (4G) together exceed an 8GB VM budget,
# so `make up` must never start the converter implicitly.
PREVIEW_PROFILE := --profile gotenberg

help: ## Show available make targets
	@echo "AI Assistant — Docker Compose shortcuts"
	@echo "========================================"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-18s %s\n", $$1, $$2}'

up: ## Start app + infrastructure + drive-connector
	docker compose $(COMPOSE_FILES) up -d

down: ## Stop app + infrastructure + drive-connector
	docker compose $(COMPOSE_FILES) down

build: ## Build all services (app + connector)
	docker compose $(COMPOSE_FILES) up -d --build

up-app: ## Start app + infrastructure only (connector keeps running)
	docker compose $(BASE_COMPOSE_FILE) up -d

down-app: ## Stop app + infrastructure only (connector keeps running)
	docker compose $(BASE_COMPOSE_FILE) down

build-app: ## Build and start app + infrastructure only (connector keeps running)
	docker compose $(BASE_COMPOSE_FILE) up -d --build

up-connector: ## Start only drive-connector (assumes app/infrastructure already running)
	docker compose $(COMPOSE_FILES) up -d drive-connector

down-connector: ## Stop only drive-connector
	docker compose $(COMPOSE_FILES) down drive-connector

build-connector: ## Rebuild and restart only drive-connector
	docker compose $(COMPOSE_FILES) up -d --build drive-connector

logs-connector: ## Tail drive-connector logs
	docker compose $(COMPOSE_FILES) logs -f drive-connector

status: ## Show running containers for this project
	docker compose $(COMPOSE_FILES) ps

up-preview: ## Start app + infrastructure + Gotenberg artifact preview converter
	docker compose $(BASE_COMPOSE_FILE) $(PREVIEW_PROFILE) up -d

build-preview: ## Rebuild and start app + infrastructure + Gotenberg converter
	docker compose $(BASE_COMPOSE_FILE) $(PREVIEW_PROFILE) up -d --build

down-preview: ## Stop only the Gotenberg converter (app keeps running)
	docker compose $(BASE_COMPOSE_FILE) $(PREVIEW_PROFILE) stop gotenberg

logs-preview: ## Tail Gotenberg conversion logs
	docker compose $(BASE_COMPOSE_FILE) $(PREVIEW_PROFILE) logs -f gotenberg

stats-preview: ## Live CPU/memory for the converter (watch while converting a large deck)
	docker stats policy-bot-gotenberg

backfill-tenancy: ## Run idempotent PostgreSQL and Qdrant organization-tenancy backfills
	bash scripts/run-tenancy-backfills.sh
