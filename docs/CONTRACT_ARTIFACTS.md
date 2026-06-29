# Contract Interface Artifacts

## Overview

After every successful contract CI run on `main`, the build produces a **contract interface artifact** that frontend teams can consume to stay in sync with the latest on-chain interface.

## Artifact Location

The artifact is uploaded to the GitHub Actions run under the name:

```
contract-interface-artifact
```

### Downloading the Artifact

1. Go to the [Actions tab](https://github.com/dimka90/predinex-stellar/actions/workflows/ci.yml).
2. Select the successful CI run on `main`.
3. Scroll to the **Artifacts** section at the bottom of the run summary.
4. Download `contract-interface-artifact`.

## Artifact Contents

| File | Description |
|------|-------------|
| `contract-interface-version.txt` | Contains the `CONTRACT_INTERFACE_VERSION` (git SHA) |
| `contract-metadata.json` | Cargo metadata with dependency versions |
| `contract-src-structure.txt` | List of source files in `src/` |
| `README.md` | Artifact metadata (commit, branch, timestamp) |
| `doc/` | Generated Rust documentation (if available) |

## Update Policy

- **Frequency**: Artifacts are regenerated on every push to `main` after contract checks pass.
- **Retention**: Artifacts are retained for **30 days** (configurable in `.github/workflows/ci.yml`).
- **Versioning**: Each artifact is tagged with the git commit SHA that produced it.

## Frontend Integration

Frontend consumers should:

1. Download the latest artifact from the CI run.
2. Extract and read `contract-interface-version.txt` to identify the version.
3. Compare with the currently used interface version.
4. Update the local contract interface types if the version has changed.

### Example Workflow

```bash
# Download and extract the latest artifact
gh run download --name contract-interface-artifact --dir ./contract-iface

# Check the version
cat ./contract-iface/contract-interface-version.txt

# Use the interface metadata
cat ./contract-iface/contract-metadata.json
```

## CI Integration

The artifact generation step runs only after all contract checks (format, clippy, tests) pass. If the checks fail, no artifact is uploaded.

To modify the artifact contents or retention policy, edit `.github/workflows/ci.yml`.

## Compatibility

The artifact contains the interface as it exists on the `main` branch. Breaking changes to the contract interface will be reflected immediately in the artifact. Frontend teams should:

- Monitor artifact updates regularly.
- Review `CHANGELOG.md` for breaking changes.
- Test integration in a staging environment before deploying to production.
