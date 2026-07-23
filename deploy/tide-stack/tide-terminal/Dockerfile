ARG PYTHON_IMAGE=python:3.12.13-slim
FROM ${PYTHON_IMAGE}

ARG OPEN_TERMINAL_REF=9162e808c3aaf8dba38745cea55204a42bbb348d
RUN test "${OPEN_TERMINAL_REF}" = "9162e808c3aaf8dba38745cea55204a42bbb348d"

RUN apt-get update && apt-get install -y --no-install-recommends \
		bash ca-certificates curl git tini sudo util-linux \
		build-essential python3-dev \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git init /src/open-terminal \
	&& git -C /src/open-terminal remote add origin https://github.com/open-webui/open-terminal.git \
	&& git -C /src/open-terminal fetch --depth=1 origin ${OPEN_TERMINAL_REF} \
	&& git -C /src/open-terminal checkout --detach ${OPEN_TERMINAL_REF} \
	&& test "$(git -C /src/open-terminal rev-parse HEAD)" = "${OPEN_TERMINAL_REF}" \
	&& sed -i 's/title="Open Terminal"/title="Tide Terminal"/' /src/open-terminal/open_terminal/main.py \
	&& sed -i 's/description="A remote terminal API\."/description="Tide-Bot remote terminal API\."/' /src/open-terminal/open_terminal/main.py \
	&& sed -i 's/name="Open Terminal"/name="Tide Terminal"/' /src/open-terminal/open_terminal/mcp_server.py \
	&& pip install --no-cache-dir /src/open-terminal \
	&& cp /src/open-terminal/LICENSE /app/OPEN_TERMINAL_LICENSE

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 0755 /app/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["run"]
