# O.M.V 帝江号 · 全域广播 —— 一键运维（Linux/macOS/WSL）
# Windows 无 make 时用 ./start.ps1
SHELL := /bin/sh
OPS_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

# 所有 compose 命令都基于 ops/.env
COMPOSE := docker compose --project-directory $(OPS_DIR) --env-file $(OPS_DIR)/.env -f $(OPS_DIR)/docker-compose.yml
RUN := $(COMPOSE) run --rm --no-deps api

.DEFAULT_GOAL := help

.PHONY: help env up down restart ps logs logs-api health migrate init-owner seed reset psql redis-cli minio-console build

help: ## 列出所有目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## 生成 ops/.env（若不存在）
	@test -f $(OPS_DIR)/.env || cp $(OPS_DIR)/.env.example $(OPS_DIR)/.env
	@echo "使用 $(OPS_DIR)/.env"

up: env ## 构建并启动 postgres/redis/minio/api/caddy
	$(COMPOSE) up -d --build
	@echo "API:   http://localhost:$${API_PORT:-3000}/healthz"
	@echo "Web:   http://$${DOMAIN:-localhost}/api/v1"
	@echo "MinIO: http://localhost:$${MINIO_CONSOLE_PORT:-9001}"

build: ## 只构建 api 镜像
	$(COMPOSE) build api

down: ## 停止并删除容器（保留卷）
	$(COMPOSE) down

restart: down up ## 重启

ps: ## 查看容器状态
	$(COMPOSE) ps

logs: ## 跟踪全部日志
	$(COMPOSE) logs -f --tail=200

logs-api: ## 只跟踪 api 日志
	$(COMPOSE) logs -f --tail=200 api

health: ## 探测 /healthz 与 /readyz
	@curl -fsS http://localhost:$${API_PORT:-3000}/healthz && echo
	@curl -fsS http://localhost:$${API_PORT:-3000}/readyz && echo

migrate: ## 执行 prisma migrate deploy（0001_init）
	$(RUN) node node_modules/prisma/build/index.js migrate deploy

init-owner: ## 首次引导：创建 owner + 三个验收频道
	$(RUN) node dist/scripts/init-owner.js

seed: ## 灌入验收固定数据子集
	$(RUN) node dist/scripts/seed.js

reset: ## 危险：删除卷并重建（数据全丢）
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build
	$(MAKE) migrate init-owner seed

psql: ## 进入 psql
	$(COMPOSE) exec postgres sh -c 'psql -U $$POSTGRES_USER -d $$POSTGRES_DB'

redis-cli: ## 进入 redis-cli
	$(COMPOSE) exec redis sh -c 'redis-cli -a $$REDIS_PASSWORD'

minio-console: ## 打印 MinIO 控制台地址与账号
	@echo "http://localhost:$${MINIO_CONSOLE_PORT:-9001}  user=$${S3_ACCESS_KEY_ID:-minioadmin}"
