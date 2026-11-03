#!/usr/bin/env node
/**
 * Dependency malware/CVE gate: queries OSV (https://osv.dev) for every
 * `name@version` resolved in a lockfile and reports the result.
 *
 * Fails closed. Exit codes:
 *   0  tree verified, no `MAL-*` (malicious-package) advisories
 *   1  a `MAL-*` advisory was reported, or the tree could not be verified at
 *      all (unreadable/invalid lockfile, network error, non-2xx HTTP, bad JSON)
 *      or `--strict` was set and any advisory at all was reported
 *
 * Usage: node scripts/check-dependencies.mjs [lockfile] [--strict]
 *   lockfile  lockfile to scan, resolved against the cwd (default package-lock.json)
 *   --strict  also treat non-malicious advisories as failures; for manual
 *             pre-release checks only, never in CI
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const OSV_API = 'https://api.osv.dev/v1';
const QUERY_CHUNK = 1000;
const MAL_PREFIX = 'MAL-';

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`could not verify dependency tree: ${error.message}`);
  process.exit(1);
}

async function main (argv) {
  const options = parseArgs(argv);
  const entries = await readEntries(options.lockPath);
  const report = await queryOsv(entries);

  const malicious = collect(report, entries, true);
  const advisories = collect(report, entries, false);

  for (const id of [...malicious.keys()].sort()) {
    console.log(`MALICIOUS: ${id} — ${[...malicious.get(id)].sort().join(', ')}`);
    const vuln = await fetchJson(`${OSV_API}/vulns/${encodeURIComponent(id)}`);
    const aliases = Array.isArray(vuln.aliases) && vuln.aliases.length > 0 ? vuln.aliases.join(', ') : 'no aliases';
    console.log(`  ${id} (${aliases}) — ${oneLine(vuln.summary ?? vuln.details ?? 'no summary')}`);
  }

  if (malicious.size > 0) process.exit(1);

  console.log(`OK: ${entries.length} entries, 0 malicious, ${advisories.size} advisories`);

  if (options.strict && advisories.size > 0) {
    for (const id of [...advisories.keys()].sort()) {
      console.log(`ADVISORY: ${id} — ${[...advisories.get(id)].sort().join(', ')}`);
    }
    console.error(`--strict: ${advisories.size} advisory(s) reported by OSV`);
    process.exit(1);
  }
}

function parseArgs (argv) {
  const options = { lockPath: 'package-lock.json', strict: false };
  for (const arg of argv) {
    if (arg === '--strict') options.strict = true;
    else if (arg === '-h' || arg === '--help') {
      console.log('usage: node scripts/check-dependencies.mjs [lockfile] [--strict]');
      process.exit(0);
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else options.lockPath = arg;
  }
  return options;
}

/** Read every `name@version` pair resolved in a lockfile's `packages` map. */
async function readEntries (lockPath) {
  const resolved = path.resolve(lockPath);
  let raw;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${resolved}: ${error.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${resolved}: ${error.message}`);
  }

  const packages = manifest.packages;
  if (packages === null || typeof packages !== 'object') throw new Error(`${resolved} has no "packages" map`);

  const entries = new Map();
  for (const [key, pkg] of Object.entries(packages)) {
    if (key === '') continue; // the root project itself
    if (pkg === null || typeof pkg !== 'object') continue;
    if (typeof pkg.version !== 'string') continue; // `link`/workspace entries carry no version
    // npm alias deps (`"os": "npm:bare-node-os"`) record the real package name;
    // the key path would name the unrelated registry package the alias shadows.
    const name = typeof pkg.name === 'string' ? pkg.name : packageName(key);
    if (name === null) continue;
    const id = `${name}@${pkg.version}`;
    if (!entries.has(id)) entries.set(id, { id, name, version: pkg.version });
  }
  return [...entries.values()];
}

/**
 * `node_modules/…/node_modules/<name>` -> `<name>`, keeping the scope of
 * `@scope/name`; returns null for keys that name no package.
 */
function packageName (key) {
  const marker = 'node_modules/';
  const index = key.lastIndexOf(marker);
  if (index === -1) return null;
  const name = key.slice(index + marker.length);
  return name === '' ? null : name;
}

/** POST every entry to the OSV batch endpoint; returns per-entry advisory ids. */
async function queryOsv (entries) {
  const report = entries.map(() => []);
  for (let start = 0; start < entries.length; start += QUERY_CHUNK) {
    const chunk = entries.slice(start, start + QUERY_CHUNK);
    const response = await fetchJson(`${OSV_API}/querybatch`, {
      queries: chunk.map((entry) => ({ package: { ecosystem: 'npm', name: entry.name }, version: entry.version }))
    });
    const results = response.results;
    if (!Array.isArray(results) || results.length !== chunk.length) {
      throw new Error(`unexpected OSV response for ${chunk.length} queries`);
    }
    results.forEach((result, offset) => {
      for (const vuln of result?.vulns ?? []) {
        if (typeof vuln?.id === 'string') report[start + offset].push(vuln.id);
      }
    });
  }
  return report;
}

/** Advisory id -> affected `name@version` list, split by MAL-* vs the rest. */
function collect (report, entries, malicious) {
  const found = new Map();
  report.forEach((ids, index) => {
    for (const id of ids) {
      if (id.startsWith(MAL_PREFIX) !== malicious) continue;
      if (!found.has(id)) found.set(id, new Set());
      found.get(id).add(entries[index].id);
    }
  });
  return found;
}

async function fetchJson (url, body) {
  const options = body === undefined
    ? { headers: { accept: 'application/json' } }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      };

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url}: invalid JSON (${error.message})`);
  }
}

function oneLine (text) {
  return String(text).replace(/\s+/g, ' ').trim();
}
