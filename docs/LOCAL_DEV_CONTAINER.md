# Reproducible local development container

This container standardizes Node, Rust, and Stellar CLI versions so contributors
and CI use the same toolchain.

## Build and run

~~~bash
docker build -f Dockerfile.dev -t predinex-dev .
docker run --rm -it -p 3000:3000 -v "$PWD:/workspace" predinex-dev
~~~

Inside the container:

~~~bash
cd /workspace/web && npm ci
cd /workspace/contracts/predinex && cargo test
~~~

The image contains no credentials. Supply testnet values through an untracked
`web/.env.local` or an ephemeral `--env-file`.

## Reproducibility rules

- Pin the base image digest and tool versions before publishing a release image.
- Use lockfile-based installs (`npm ci` and `cargo build --locked`).
- Never bake wallet secrets, API keys, or deployment addresses into the image.
- Rebuild after changes to the Dockerfile, toolchain, or package lockfiles.
