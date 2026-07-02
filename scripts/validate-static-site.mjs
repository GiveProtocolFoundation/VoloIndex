#!/usr/bin/env node
// Phase-0 static-site validator for Volo Index.
//
// Runs in CI against the current single-file deploy artifact (`index.html`)
// until F1 (GIV-66) lands a real source tree + build. Catches the failure
// mode called out in GIV-68: a typo in `index.html` or a missing asset
// silently breaking the live site.
//
// Checks:
//   1. index.html exists at repo root.
//   2. index.html has the required top-level structure (<!DOCTYPE html>,
//      <html>, <head>, <body>). We intentionally do not try to balance
//      <script>/<style> counts because this file inlines a React bundle
//      whose string literals contain substrings that trip naïve counters.
//   3. Every referenced local asset (href / src / srcset) that is not an
//      absolute URL, data URI, or fragment resolves to a file on disk.
//
// Exit code 0 on success, 1 on the first failure. Prints a summary either way.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(repoRoot, 'index.html');

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

// --- Check 1: index.html present ---------------------------------------------
if (!existsSync(indexPath)) {
  fail('index.html is missing at repo root.');
  report();
}

const html = readFileSync(indexPath, 'utf8');
const sizeKb = Math.round(statSync(indexPath).size / 1024);

// --- Check 2: basic well-formedness ------------------------------------------
const lower = html.toLowerCase();
if (!lower.startsWith('<!doctype html>')) {
  fail('index.html does not start with <!DOCTYPE html>.');
}
for (const tag of ['<html', '<head', '<body']) {
  if (!lower.includes(tag)) {
    fail(`index.html is missing required tag: ${tag}>`);
  }
}
// --- Check 3: referenced local assets exist ----------------------------------
// Extract attribute values from href="…", src="…", src='…', srcset="…".
// We deliberately keep the parser conservative: attribute values in double or
// single quotes only. If a contributor ever writes unquoted attributes we'll
// miss them, but the file today uses quoted attributes throughout.
const refs = new Set();

function collect(regex, group = 1) {
  for (const match of html.matchAll(regex)) {
    refs.add(match[group]);
  }
}

collect(/\s(?:href|src)\s*=\s*"([^"]+)"/gi);
collect(/\s(?:href|src)\s*=\s*'([^']+)'/gi);

// srcset entries are comma-separated `url descriptor`.
for (const match of html.matchAll(/\ssrcset\s*=\s*"([^"]+)"/gi)) {
  for (const entry of match[1].split(',')) {
    const url = entry.trim().split(/\s+/)[0];
    if (url) refs.add(url);
  }
}
for (const match of html.matchAll(/\ssrcset\s*=\s*'([^']+)'/gi)) {
  for (const entry of match[1].split(',')) {
    const url = entry.trim().split(/\s+/)[0];
    if (url) refs.add(url);
  }
}

let localRefCount = 0;
let missingRefCount = 0;
for (const raw of refs) {
  const ref = raw.trim();
  if (!ref) continue;
  if (ref.startsWith('#')) continue; // in-page fragment
  if (ref.startsWith('data:')) continue; // inline
  if (ref.startsWith('blob:')) continue;
  if (ref.startsWith('mailto:')) continue;
  if (ref.startsWith('tel:')) continue;
  if (ref.startsWith('javascript:')) continue;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) continue; // http(s):// etc.
  if (ref.startsWith('//')) continue; // protocol-relative external

  localRefCount++;
  // Strip query/hash before resolving.
  const cleaned = ref.split('#')[0].split('?')[0];
  if (!cleaned) continue;
  // Only accept references anchored at repo root or relative to index.html.
  const abs = normalize(join(repoRoot, cleaned));
  if (!abs.startsWith(repoRoot)) {
    fail(`Local reference escapes repo root: ${ref}`);
    missingRefCount++;
    continue;
  }
  if (!existsSync(abs)) {
    fail(`Local asset referenced from index.html not found on disk: ${ref}`);
    missingRefCount++;
  }
}

// --- Report ------------------------------------------------------------------
function report() {
  const ok = failures.length === 0;
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[validate-static-site] ${status}`);
  console.log(`  index.html size: ${sizeKb} KB`);
  console.log(`  local asset refs checked: ${localRefCount}`);
  console.log(`  missing local assets: ${missingRefCount}`);
  if (warnings.length) {
    console.log('  warnings:');
    for (const w of warnings) console.log(`    - ${w}`);
  }
  if (!ok) {
    console.log('  failures:');
    for (const f of failures) console.log(`    - ${f}`);
    process.exit(1);
  }
}

report();
