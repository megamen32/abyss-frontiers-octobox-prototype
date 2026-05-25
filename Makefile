SHELL := /bin/zsh

PORT ?= 4173
HOST ?= 0.0.0.0
PID_FILE := .vite-dev.pid
LOG_FILE := .vite-dev.log

.PHONY: help install build start restart stop status logs clean-dev

help:
	@echo "Available targets:"
	@echo "  make start    - install deps if needed and start the Vite dev server"
	@echo "  make restart  - stop, rebuild, and start the Vite dev server"
	@echo "  make stop     - stop the Vite dev server started by this Makefile"
	@echo "  make status   - show whether the dev server is running"
	@echo "  make logs     - tail the dev server log"

install:
	@if [ ! -d node_modules ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	else \
		echo "Dependencies already installed."; \
	fi

build:
	@echo "Building project..."
	@npm run build

start: install
	@if [ -f "$(PID_FILE)" ] && kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
		echo "Dev server is already running with PID $$(cat "$(PID_FILE)")"; \
	else \
		echo "Starting Vite dev server on $(HOST):$(PORT)..."; \
		PORT="$(PORT)" HOST="$(HOST)" LOG_FILE="$(LOG_FILE)" PID_FILE="$(PID_FILE)" python3 -c "import os, subprocess; from pathlib import Path; log_path = Path(os.environ['LOG_FILE']); log_file = log_path.open('ab'); process = subprocess.Popen(['./node_modules/.bin/vite', '--host', os.environ['HOST'], '--port', os.environ['PORT']], stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True, cwd='.'); Path(os.environ['PID_FILE']).write_text(f'{process.pid}\\n', encoding='utf-8'); log_file.close()"; \
		sleep 2; \
	fi
	@if [ -f "$(PID_FILE)" ] && kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
		echo "Dev server PID: $$(cat "$(PID_FILE)")"; \
		echo "Open in browser: http://127.0.0.1:$(PORT)/"; \
		echo "If needed from another device: http://<your-local-ip>:$(PORT)/"; \
		echo "Logs: tail -f $(LOG_FILE)"; \
		echo ""; \
		grep -E "Local:|Network:" "$(LOG_FILE)" || true; \
	else \
		echo "Dev server failed to start. Check $(LOG_FILE)"; \
		exit 1; \
	fi

restart: stop build start
	@echo "Restart complete."

stop:
	@if [ -f "$(PID_FILE)" ]; then \
		PID=$$(cat "$(PID_FILE)"); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "Stopping dev server $$PID..."; \
			kill $$PID; \
			sleep 1; \
			if kill -0 $$PID 2>/dev/null; then \
				echo "Process still running, forcing stop..."; \
				kill -9 $$PID; \
			fi; \
		else \
			echo "No running process for PID $$PID"; \
		fi; \
		rm -f "$(PID_FILE)"; \
	else \
		echo "No PID file found. Nothing to stop."; \
	fi

status:
	@if [ -f "$(PID_FILE)" ] && kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
		echo "Dev server is running with PID $$(cat "$(PID_FILE)")"; \
		echo "Open in browser: http://127.0.0.1:$(PORT)/"; \
	else \
		echo "Dev server is not running."; \
	fi

logs:
	@if [ -f "$(LOG_FILE)" ]; then \
		tail -f "$(LOG_FILE)"; \
	else \
		echo "No log file found at $(LOG_FILE)"; \
	fi

clean-dev:
	@rm -f "$(PID_FILE)" "$(LOG_FILE)"
