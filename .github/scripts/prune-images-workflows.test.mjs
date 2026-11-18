// The live clean-up and its preview repeat the same package -> Coolify settings (GitHub Actions expressions cannot be loaded
// from a shared file), so this test fails when the two lists drift apart. It also pins the safe shape of the close trigger.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (name) => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
const live = read('prune-images.yml');
const check = read('prune-images-check.yml');

/** Every `<package> ${{ ... }}` line of the DEV_APPS and PROD_APPS blocks, in order of appearance. */
const mappings = (text) => [...text.matchAll(/^\s+([a-z-]+-universe) (\$\{\{ .+ \}\})\s*$/gm)].map((match) => `${match[1]} ${match[2]}`);

describe('prune workflows', () => {
  it('map the same seven packages to the same Coolify settings in the live run and the preview', () => {
    const liveRows = mappings(live);
    assert.ok(liveRows.length >= 12, `expected the DEV and PROD rows, found ${liveRows.length}`);
    assert.deepEqual([...mappings(check)].sort(), [...liveRows].sort());
  });

  it('clears on pull_request closed and never checks out the PR head', () => {
    assert.match(live, /^ {2}pull_request:\n {4}types: \[closed\]/m);
    assert.doesNotMatch(live.replace(/^\s*#.*$/gm, ''), /pull_request_target/);
    assert.match(live, /github\.event_name != 'pull_request' \|\|/);
    assert.doesNotMatch(live, /ref: \$\{\{[^}]*head\.(ref|sha)/);
    assert.match(live, /--closed-pr "\$CLOSED_PR"/);
  });
});
