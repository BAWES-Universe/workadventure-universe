# Universe Branch Build & Test Workflow

This workflow builds and tests Docker images for the `universe` branch and pushes them to GitHub Container Registry (GHCR) for deployment with Coolify.

## What This Does

- **Builds** all WorkAdventure services (play, back, map-storage, uploader) as Docker images
- **Pushes** images to `ghcr.io/{your-username}/{service}-universe:latest`
- **Tests** images using WorkAdventure's existing test suite to verify they work correctly
- **Triggers** automatically on pushes to the `universe` branch
- **Supports** manual triggering via GitHub Actions UI

## Image Hosting (Free!)

**GitHub Container Registry (GHCR)** is used - it's **completely free** and requires **no extra account**:
- Uses your existing GitHub account
- Uses `GITHUB_TOKEN` (automatically available in workflows)
- **Free for public repos**: Unlimited storage and bandwidth
- **Free tier for private repos**: 500MB storage, 1GB bandwidth/month
- Images are at: `ghcr.io/{your-username}/{service}-universe:latest`

No Docker Hub account or additional setup needed!

## Images Built

- `ghcr.io/{your-username}/play-universe:latest`
- `ghcr.io/{your-username}/back-universe:latest`
- `ghcr.io/{your-username}/map-storage-universe:latest`
- `ghcr.io/{your-username}/uploader-universe:latest`

## Workflow Structure

### 1. Build Workflow (`build-universe-images.yml`)
- Builds all services using universe-specific Dockerfiles
- Pushes to GHCR
- Uses ARG instead of Docker secrets (simpler for Coolify)

### 2. Test Workflow (`test-universe-images.yml`)
- Automatically runs after successful builds
- Uses WorkAdventure's existing test infrastructure:
  - `contrib/docker/docker-compose.prod.yaml` (production setup)
  - `contrib/docker/tests/docker-compose.test.yaml` (test overrides)
  - `contrib/docker/docker-compose.universe.yaml` (universe image overrides)
  - Existing Playwright test suite (`tests/` directory)
- Runs `npm run test-single-domain-install` (WorkAdventure's test command)
- Verifies all services start and respond correctly
- Shows logs on failure

## Usage in Coolify

1. In Coolify, create a new resource
2. Choose **"Docker Image"** as the source type
3. Enter the image name: `ghcr.io/{your-username}/play-universe:latest`
4. Configure environment variables, ports, and domains
5. Deploy!

**Note**: You may need to authenticate to GHCR in Coolify if your repo is private. For public repos, no authentication needed.

## Manual Build & Test

### Build Only
1. Go to Actions → "Build Universe Images for Coolify"
2. Click "Run workflow"
3. Select which service to build (or "all")
4. Run

### Test Only
1. Go to Actions → "Test Universe Images"
2. Click "Run workflow"
3. Optionally specify a Docker tag (defaults to `latest`)
4. Run

## Files Created (Universe-Specific)

These files are universe-specific and **won't conflict** with upstream merges:

- `play/Dockerfile.universe` - Uses ARG instead of secrets
- `back/Dockerfile.universe` - Copy of original
- `map-storage/Dockerfile.universe` - Copy of original
- `uploader/Dockerfile.universe` - Copy of original
- `contrib/docker/docker-compose.universe.yaml` - Overrides image names for testing
- `.github/workflows/build-universe-images.yml` - Build workflow
- `.github/workflows/test-universe-images.yml` - Test workflow

## Differences from WorkAdventure Workflows

- Uses **ARG** instead of Docker secrets (simpler for Coolify)
- Only runs on `universe` branch (doesn't interfere with upstream)
- Pushes to your personal GHCR namespace
- Doesn't require WorkAdventure organization secrets
- Uses universe-specific Dockerfiles (original files untouched)
- Reuses WorkAdventure's proven test infrastructure

## Testing & Verification

The test workflow:
1. Pulls the built universe images from GHCR
2. Starts the full WorkAdventure stack using production docker-compose
3. Runs WorkAdventure's existing Playwright test suite
4. Verifies all services work correctly
5. Shows detailed logs if anything fails

This ensures your images work correctly **before** you deploy them to Coolify, saving you debugging time.

## Safe Upstream Merges

- **Original Dockerfiles untouched** - No modifications to `play/Dockerfile`, etc.
- **Universe files are separate** - All universe-specific files have `.universe` suffix
- **No workflow conflicts** - Universe workflows only run on `universe` branch
- **Upstream merges cleanly** - No merge conflicts when pulling WorkAdventure updates

## Troubleshooting

### Build Fails
- Check the build logs in GitHub Actions
- Verify all dependencies are available
- Check if Sentry build args are needed (can be left empty)

### Test Fails
- Check the test logs in GitHub Actions
- Review docker-compose logs (uploaded as artifacts)
- Verify images were pushed to GHCR successfully
- Check if images are accessible (public repo or authenticated)

### Images Not Found in Coolify
- Verify images exist: `ghcr.io/{your-username}/{service}-universe:latest`
- Check if repo is private (may need GHCR authentication in Coolify)
- Ensure you're using the correct image name format
