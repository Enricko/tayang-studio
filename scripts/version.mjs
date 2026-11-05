#!/usr/bin/env node
// Sets the app version everywhere it is written, so a release tag, the installers and the updater agree:
//   pnpm version:set 0.2.0
// Then commit, tag v0.2.0 and push the tag; the Release workflow builds a draft release from it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2]?.replace(/^v/, '');
// Plain semver (the updater compares versions), with an optional pre-release such as 0.2.0-beta.1.
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: pnpm version:set <major.minor.patch>, for example 0.2.0');
  process.exit(1);
}

const json = (rel) => {
  const path = join(root, rel);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};
json('package.json');
json('apps/desktop/package.json');
json('apps/desktop/src-tauri/tauri.conf.json');

// Only the [package] version, the first `version =` line of Cargo.toml.
const cargo = join(root, 'apps/desktop/src-tauri/Cargo.toml');
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
// Cargo.lock records the app's own version too.
execFileSync('cargo', ['update', '--workspace', '--offline'], { cwd: dirname(cargo), stdio: 'inherit' });

console.log(`Version set to ${version}. Next: git commit -am "Release v${version}" && git tag v${version} && git push origin main v${version}`);
