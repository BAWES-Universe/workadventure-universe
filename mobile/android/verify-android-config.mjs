/**
 * Automated verification test suite for the BAWES Universe Android Capacitor
 * platform, Fastlane signing/deployment lanes, launcher icons, and CI workflow.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ANDROID_DIR = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.resolve(ANDROID_DIR, '..');
const REPO_ROOT = path.resolve(MOBILE_DIR, '..');

const EXPECTED_ICON_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

/**
 * Reads a UTF-8 file relative to the repository root.
 *
 * @param {string} relativePath path relative to the repository root
 * @returns {string} decoded UTF-8 file contents
 */
function readRepoFile(relativePath) {
  const fullPath = path.join(REPO_ROOT, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

/**
 * Extracts PNG pixel width and height from the IHDR header chunk.
 *
 * @param {string} filePath absolute path to the PNG image
 * @returns {{ width: number, height: number }} decoded dimensions in pixels
 */
function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buffer.subarray(0, 8), pngSignature, `Invalid PNG header in ${filePath}`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/**
 * Extracts all shell script segments defined under GitHub Actions run keys.
 *
 * @param {string} workflowYaml raw YAML content of the workflow file
 * @returns {string[]} extracted shell command blocks
 */
function extractWorkflowRunBlocks(workflowYaml) {
  const matches = workflowYaml.match(/^\s*(?:-\s+)?run:\s*(?:\|[+-]?\s*\n(?:\s+.*\n?)*|.+)$/gm);
  return matches ?? [];
}

/**
 * Verifies that no GitHub Actions run block interpolates template expressions directly.
 *
 * @param {string} workflowYaml raw YAML content of the workflow file
 */
function assertNoTemplateExpressionsInRunBlocks(workflowYaml) {
  const blocks = extractWorkflowRunBlocks(workflowYaml);
  assert.equal(blocks.length > 0, true, 'Expected at least one run block in workflow');
  for (const block of blocks) {
    assert.equal(block.includes('${{'), false, `Direct expression found in run block: ${block}`);
  }
}

test('Gradle configuration enforces applicationId, minSdk 26, and targetSdk 34', () => {
  const appGradle = readRepoFile('mobile/android/app/build.gradle');
  const variablesGradle = readRepoFile('mobile/android/variables.gradle');

  assert.match(appGradle, /namespace\s*=\s*"net\.bawes\.universe"/);
  assert.match(appGradle, /applicationId\s+"net\.bawes\.universe"/);
  assert.match(appGradle, /minSdkVersion\s+26\b/);
  assert.match(appGradle, /targetSdkVersion\s+34\b/);
  assert.match(variablesGradle, /minSdkVersion\s*=\s*26\b/);
  assert.match(variablesGradle, /targetSdkVersion\s*=\s*34\b/);
});

test('AndroidManifest configures deep-link, landscape orientation, hardware acceleration, and WebRTC permissions', () => {
  const manifest = readRepoFile('mobile/android/app/src/main/AndroidManifest.xml');

  assert.match(manifest, /android:hardwareAccelerated="true"/);
  assert.match(manifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(manifest, /android:launchMode="singleTask"/);
  assert.match(manifest, /android:scheme="bawes"/);
  assert.match(manifest, /android:host="callback"/);
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
});

test('Universe launcher icons exist across all mipmap densities with exact dimensions', () => {
  const resDir = path.join(ANDROID_DIR, 'app/src/main/res');
  for (const [folder, expectedPx] of Object.entries(EXPECTED_ICON_SIZES)) {
    for (const iconName of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const iconPath = path.join(resDir, folder, iconName);
      assert.equal(fs.existsSync(iconPath), true, `Missing launcher icon: ${iconPath}`);
      const dims = readPngDimensions(iconPath);
      assert.deepEqual(dims, { width: expectedPx, height: expectedPx });
    }
  }
});

test('Fastlane Appfile and Fastfile define build, deploy, and test lanes', () => {
  for (const prefix of ['mobile/fastlane', 'mobile/android/fastlane']) {
    const appfile = readRepoFile(`${prefix}/Appfile`);
    const fastfile = readRepoFile(`${prefix}/Fastfile`);

    assert.match(appfile, /package_name\("net\.bawes\.universe"\)/);
    assert.match(fastfile, /platform\s+:android\s+do/);
    assert.match(fastfile, /lane\s+:build\s+do/);
    assert.match(fastfile, /lane\s+:deploy\s+do/);
    assert.match(fastfile, /lane\s+:test\s+do/);
    assert.match(fastfile, /upload_to_play_store\(track:\s*"internal"\)/);
  }
});

test('GitHub Actions workflow enforces explicit permissions and env-scoped secrets', () => {
  const workflow = readRepoFile('.github/workflows/android-build.yml');

  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /bundle exec fastlane android test/);
  assert.match(workflow, /bundle exec fastlane android build/);
  assert.match(workflow, /bundle exec fastlane android deploy/);
  assertNoTemplateExpressionsInRunBlocks(workflow);
});
