# AI Assistant — Docker Compose convenience wrapper
# Use `make help` to see all targets.

.PHONY: help up down build up-connector down-connector build-connector logs-connector status

COMPOSE_FILES := -f docker-compose.yml -f services/drive-connector/docker-compose.connector.yml

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
