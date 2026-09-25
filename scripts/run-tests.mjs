#!/usr/bin/env node
/**
 * Isolated test runner: runs every `test/*.test.js` in its own process so
 * brittle/jsdom globals do not leak across files. Streams output and exits
 * non-zero on the first failing file, naming it.
 */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');
const files = readdirSync(testDir).filter((name) => name.endsWith('.test.js')).sort();

if (files.length === 0) {
  console.error('No test/*.test.js files found');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const child = spawn(process.execPath, [path.join(testDir, file)], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.on('exit', (exitCode, signal) => resolve(signal ? 1 : exitCode)));
  if (code !== 0) {
    console.error(`\nFAILED: test/${file}`);
    failed = 1;
    break;
  }
}

if (failed) process.exit(1);
console.log(`\nAll ${files.length} test files passed.`);