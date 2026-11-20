## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T14:28:58Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/traceability.json > upstream_ids and coverage | The list has no NFR6.1 to NFR6.6, yet observability-design.md and LC7 cite them, so the observability design is not traced at all. It also omits NFR3.7, NFR5.7 to NFR5.9, NFR7.3 to NFR7.6, NFR2.10, NFR2.11, NFR4.5, NFR6.7 and NFR1.7, all of which the upstream tech-stack-decisions.md and the other requirement documents define. The designs use some of them: NFR7.6 appears in security-design.md and NFR5.8 in logical-components.md. | Add every upstream NFR ID, at least NFR6.1 to NFR6.7, with a coverage row each that points to the design section. Where an ID is intentionally left to the infrastructure design stage, record that in the row instead of leaving it out. | New |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > section 1 (systemd unit) | The only concrete unit definition differs from the other designs. It has none of the hardening in security-design.md (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ReadWritePaths=/mnt/data`). It has no `NODE_OPTIONS=--max-old-space-size=192`, which performance-design.md relies on for the memory budget. It has no `node --version` >= 24 check, which NFR7.1 and security-design.md require. reliability-design.md section 2 also says "ProtectSystem=strict prevents writes outside /mnt/data", but with the unit as written that guarantee does not exist. The `/usr/bin/node` path is not tied to the tarball install location in LC9. Caddy has no ordering dependency on `mobile-order.service`, although the text states a boot order. | Make one unit definition authoritative and include all directives from the other design documents (hardening, `NODE_OPTIONS`, the version check, the node path). Say where LC9 installs node, or symlink it to `/usr/bin/node`. Add the Caddy unit ordering, or remove the claim that the boot order is guaranteed. | New |
| R-03 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > section 3 (deploy.sh flow) | The edge cases of the release switching are not defined. The first deploy has no `prev`, so step 6 cannot roll back. Redeploying the same id makes `prev` equal `current`, so the rollback restores the same broken version. The failed release directory is deleted only after a later success. When the failure comes from the mount assertion, section 2 skips the rollback, which differs from the automatic rollback in NFR3.3. | Define the behavior for no `prev`, `prev` equal to `current`, and cleanup of failed releases. State explicitly that the mount-assertion failure is the one exception to the automatic rollback, and record that as a deliberate deviation from NFR3.3. | New |
| R-04 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/performance-design.md > server shape (esbuild) | The design bundles Fastify and pino to ESM with `--format=esm` but does not mention the `createRequire` banner, the `__dirname` shims, or the handling of pino's transport and worker threads. These are common reasons for "dynamic require of X is not supported". The risk is acknowledged only as a skeleton check. | Name the esbuild settings to try (banner with `createRequire`, externals) so the skeleton check has a concrete fallback. | New |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/nfr-design/reliability-design.md > Assumptions A1 and the Caddy configuration | The Caddy `root` and `try_files` (SPA fallback, `no-cache` for `index.html`) are not specified. Whether the symlink resolution works without a restart is left to the skeleton. The upstream `127.0.0.1:3000` matches `HOST=127.0.0.1`, so there is no contradiction, but the Caddyfile is not pinned down. | Add a short Caddyfile sketch (root `current/web`, `handle_path /api/*` to `127.0.0.1:3000`, the caching headers) to logical-components.md. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| Manual traceability check (traceability.json against nfr-requirements/traceability.json and the requirement documents) | FAIL (partial): NFR6.x and several decision IDs are missing | Confirms the first Major finding |
| Manual consistency check (systemd directives, rollback timing 60 s + 120 s, `HOST` against the Caddy upstream) | `RequiresMountsFor` plus `AssertPathIsMountPoint` plus `nofail` is semantically sound. `Restart=always` with `StartLimitIntervalSec=0` satisfies NFR3.1. `HOST=127.0.0.1` matches the Caddy upstream. The unit and the other documents differ, see the second Major finding. | Mostly consistent except for the unit definition |

### Summary

The design is largely implementable and consistent with the NFR requirements: the systemd mount semantics, rollback timing and loopback binding are sound. The two Major findings are a traceability gap (NFR6.x and the decision IDs are missing) and a unit definition that omits directives the other designs depend on. Both are cheap to fix, and the remaining items are Minor.
