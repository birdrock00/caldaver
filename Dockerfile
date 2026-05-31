# syntax=docker/dockerfile:1

FROM docker.io/library/node:22-bookworm-slim AS assets
WORKDIR /src

COPY package.json package-lock.json* ./
RUN npm install

COPY assets ./assets
COPY web/public ./web/public
RUN npm run build:templates \
    && npm run build:css \
    && npm run build:js

FROM docker.io/library/rust:1-bookworm AS rust-builder
WORKDIR /src

COPY rust ./rust
COPY web/templates ./web/templates
RUN cargo build --release --manifest-path rust/Cargo.toml --bin caldaver-server

FROM docker.io/library/debian:bookworm-slim

LABEL org.opencontainers.image.title="caldaver" \
      org.opencontainers.image.description="Caldaver CalDAV web client Docker image, served by the Rust backend" \
      org.opencontainers.image.source="https://github.com/caldaver-app/caldaver" \
      org.opencontainers.image.licenses="GPL-3.0-or-later AND MIT"

ENV CALDAVER_BIND=0.0.0.0:8080 \
    CALDAVER_STATIC_ROOT=/var/www/caldaver/web/public \
    RUST_LOG=caldaver_server=info,tower_http=info

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /var/www/caldaver
COPY --from=rust-builder /src/rust/target/release/caldaver-server /usr/local/bin/caldaver-server
COPY --from=assets /src/web/public /var/www/caldaver/web/public

EXPOSE 8080
USER nobody
ENTRYPOINT ["/usr/local/bin/caldaver-server"]
