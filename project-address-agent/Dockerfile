FROM ghcr.io/astral-sh/uv:0.11.32-python3.13-trixie-slim@sha256:fb576a1ff0c6b967e8b466695af934e34161c4a99c2fbfb859261d4a24d4a8d3

ENV PYTHONUNBUFFERED=1 \
    ROI_REPO_ROOT=/app \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1

WORKDIR /app

COPY project-address-agent /app/project-address-agent
COPY data/districts.geojson /app/data/districts.geojson

RUN uv sync --project /app/project-address-agent --locked --no-dev

CMD ["/app/project-address-agent/.venv/bin/project-address-agent", "cycle", "--apply", "--limit", "100", "--agent-limit", "3", "--max-llm-calls", "3"]
