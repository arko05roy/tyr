FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin frost-signer

FROM debian:bookworm-slim
COPY --from=build /src/target/release/frost-signer /usr/local/bin/frost-signer
ENTRYPOINT ["frost-signer"]
