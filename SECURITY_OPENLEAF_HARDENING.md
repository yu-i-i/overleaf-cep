# OpenLeaf Hardening Notes

OpenLeaf is intended for a private trusted-collaborator deployment of this extended Overleaf Community Edition fork. These changes reduce obvious foot-guns, but they do not make the system suitable for a public multi-tenant SaaS service.

## What was hardened

- Sandboxed compile containers now have explicit memory, swap, PID, CPU, file descriptor, and process ulimit defaults.
- Compile containers keep Docker networking disabled and also set `HostConfig.NetworkMode=none`.
- Compile containers explicitly run without privileged mode, keep `CapDrop: ['ALL']`, keep `no-new-privileges`, and preserve seccomp and AppArmor handling.
- TeX Docker images must come from an allow-list when sandboxed compiles are enabled. Set `ALLOWED_IMAGES` explicitly.
- External URL import is disabled by default with `EXTERNAL_URL_IMPORT_ENABLED=false`.
- Linked URL imports retain URL sanitisation, protocol checks, DNS checks, blocked-network checks, redirect revalidation, timeouts, file-size checks, and DNS pinning when enabled.
- Anonymous read/write sharing remains disabled by default, and enabling it requires the additional `OPENLEAF_ALLOW_ANONYMOUS_WRITE_SHARING_ACKNOWLEDGED=true` guard.
- A hardened Compose example binds the web port to `127.0.0.1`, keeps MongoDB and Redis internal, and documents Docker socket risk.
- CI now includes Trivy filesystem and config scans plus report-only `npm audit`.

## Remaining risks

LaTeX compilation is still high risk. TeX engines and helper tools can consume CPU, memory, disk, and process slots; some workflows intentionally execute helper programs. These hardening settings constrain that activity, but they do not prove hostile documents are safe.

The Docker socket remains dangerous. A process that can control `/var/run/docker.sock` can often start containers, mount host paths, alter containers, or otherwise gain broad host influence. Sibling compile containers improve isolation from the main application container, but the Docker socket is still a powerful trust boundary.

Run OpenLeaf in a dedicated VM. Keep the VM separate from other workloads, restrict administrative access, monitor disk usage, and use host firewall rules so only the intended reverse proxy or trusted network can reach the web port.

## TeX Image Allow-List

Set a pinned default image and allow-list it explicitly:

```sh
TEX_LIVE_DOCKER_IMAGE=ghcr.io/example/openleaf-texlive:2025.1
ALLOWED_IMAGES=ghcr.io/example/openleaf-texlive:2025.1
```

`ALLOWED_IMAGES` accepts comma-separated or whitespace-separated image names. `ALL_TEX_LIVE_DOCKER_IMAGES` is accepted only as a fallback when `ALLOWED_IMAGES` is absent, and explicit `ALLOWED_IMAGES` is preferred.

Avoid `latest` tags. Review and pin image tags before allowing them.

## External URL Import

External URL import is disabled by default:

```sh
EXTERNAL_URL_IMPORT_ENABLED=false
```

Enable it only when collaborators need it:

```sh
EXTERNAL_URL_IMPORT_ENABLED=true
```

When enabled, keep private, local, link-local, multicast, and reserved networks blocked unless you have a specific allow-list requirement:

```sh
OVERLEAF_LINKED_URL_ALLOWED_RESOURCES='^https://trusted.example/'
```

## Anonymous Write Sharing

Keep anonymous write-sharing disabled:

```sh
OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING=false
OPENLEAF_ALLOW_ANONYMOUS_WRITE_SHARING_ACKNOWLEDGED=false
```

If a private deployment intentionally enables it, both variables must be set:

```sh
OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING=true
OPENLEAF_ALLOW_ANONYMOUS_WRITE_SHARING_ACKNOWLEDGED=true
```

Restrict invitations to existing accounts where possible:

```sh
OVERLEAF_RESTRICT_INVITES_TO_EXISTING_ACCOUNTS=true
```

## Backups

Back up MongoDB, Redis persistence if used, and `/var/lib/overleaf` together. MongoDB contains core application data; Redis can contain sessions and queues; `/var/lib/overleaf` contains project files, compile/output data, caches, and history blobs depending on configuration. Test restoration before relying on the backup plan.

## Pre-production Checklist

- Pin the Overleaf image and the allowed TeX image tags.
- Put OpenLeaf behind a TLS reverse proxy and set `OVERLEAF_SITE_URL` and `OVERLEAF_SECURE_COOKIE=true`.
- Bind the web service to localhost or a private interface.
- Keep MongoDB and Redis unexposed to the host network.
- Run in a dedicated VM because the Docker socket is mounted.
- Keep `EXTERNAL_URL_IMPORT_ENABLED=false` unless needed.
- Keep anonymous write-sharing disabled.
- Set `OVERLEAF_RESTRICT_INVITES_TO_EXISTING_ACCOUNTS=true`.
- Run the security checks workflow and review Trivy and npm audit output.
- Test backup and restore for MongoDB, Redis, and Overleaf data.
