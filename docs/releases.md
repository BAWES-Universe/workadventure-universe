# Universe — Release Runbook

## Desktop Release Steps

1. **Update version** in `desktop/electron/package.json`:
   ```
   "version": "1.0.0"
   ```

2. **Commit and tag:**
   ```bash
   git add desktop/electron/package.json
   git commit -m "chore: bump version to 1.0.0"
   git tag v1.0.0
   git push origin universe --tags
   ```

3. **Watch the workflow** at:
   https://github.com/BAWES-Universe/workadventure-universe/actions/workflows/desktop-release.yml

4. **Verify artifacts** are attached to the GitHub Release:
   - `Universe-Setup-1.0.0.exe` (Windows)
   - `Universe-1.0.0.dmg` (macOS)
   - `Universe-1.0.0.AppImage` (Linux)
   - `universe_1.0.0_amd64.deb` (Linux Debian)

5. **Run the QA matrix** (see below) before announcing.

## QA Matrix

| Platform | Install | Launch | Universe loads | Login works | Resize/fullscreen | Offline page shown | Update check |
|----------|---------|--------|---------------|-------------|-------------------|-------------------|-------------|
| Windows 11 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| macOS 14+ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Ubuntu 22 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Android (PWA) | ☐ | ☐ | ☐ | ☐ | — | ☐ | — |
| iOS Safari (PWA) | ☐ | ☐ | ☐ | ☐ | — | ☐ | — |

All checkboxes must pass before closing the release issue.

## Mobile Handoff (until native apps are built)

Mobile users should install via PWA:
1. Visit `https://universe.bawes.net` on mobile
2. Android: Chrome banner or ⋮ → Add to Home Screen
3. iOS: Safari Share → Add to Home Screen

Native Android/iOS packaging is tracked in separate issues.
