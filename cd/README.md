# Continuous Deployment (`cd/`)

This directory contains legacy upstream WorkAdventure Kubernetes and Traefik manifests (`map-storage-traefik-ingress-route.tmpl.yaml`) used only by the upstream `master`/`develop` deployment jobs in `.github/workflows/build-test-and-deploy.yml`.

## BAWES Universe Deployment

BAWES Universe does **not** deploy through the Kubernetes templates in `cd/`. Instead:

- **Production (`https://universe.bawes.net`)** and **Dev (`https://dev.bawes.net`)** are deployed through **Coolify** using container images published to GitHub Container Registry (`ghcr.io/bawes-universe/*-universe`).
- **Build, release, sequential Coolify deployment, post-deploy health checks, and manual rollback** are defined in [`.github/workflows/build-universe-images.yml`](../.github/workflows/build-universe-images.yml).
- **End-to-end image verification** runs in [`.github/workflows/test-universe-images.yml`](../.github/workflows/test-universe-images.yml).
- **PR preview switching on `dev.bawes.net`** runs in [`.github/workflows/dev-server.yml`](../.github/workflows/dev-server.yml) and [`.github/workflows/dev-server-switch.yml`](../.github/workflows/dev-server-switch.yml).

See [`docs/cicd.md`](../docs/cicd.md) for the complete BAWES Universe CI/CD pipeline reference and [`docs/dev-workflow.md`](../docs/dev-workflow.md) for the day-to-day developer workflow.
