# syntax=docker/dockerfile:1
# Build manually from the repository root. This file does not trigger a release.
FROM node:24-bookworm-slim AS web
WORKDIR /build
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY engineering/web/package.json engineering/web/pnpm-lock.yaml engineering/web/pnpm-workspace.yaml ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    pnpm install --frozen-lockfile --ignore-scripts
COPY engineering/web/ ./
RUN pnpm run test && pnpm run build

FROM python:3.12-slim
WORKDIR /workspace
COPY engineering/requirements.txt /workspace/engineering/requirements.txt
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir -r engineering/requirements.txt && useradd --create-home console
COPY engineering/server/ /workspace/engineering/server/
# Source is analysed, never imported or executed by the console.
COPY backend/*.py /workspace/backend/
COPY web/src/ /workspace/web/src/
COPY android/app/src/ /workspace/android/app/src/
COPY infra/ /workspace/infra/
COPY firebase.json firestore.rules cloudbuild.yaml /workspace/
COPY --from=web /build/dist /workspace/engineering/web/dist/
# Checkouts may restore owner-only modes; the runtime intentionally is non-root.
RUN chmod -R a+rX /workspace
ARG SOURCE_REVISION=unknown
ENV ENGINEERING_SOURCE_REVISION=$SOURCE_REVISION
ENV ENGINEERING_CLOUD_ENABLED=false
USER console
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn engineering.server.app:app --host 0.0.0.0 --port ${PORT:-8080} --no-proxy-headers"]
