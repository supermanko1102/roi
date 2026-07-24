.PHONY: install test lint playground eval

install:
	uv sync

test:
	uv run pytest

lint:
	uv run ruff check .

playground:
	uv run adk web .

eval:
	uv run adk eval project_address_agent evals/address_repair.evalset.json
