#!/usr/bin/env node
/**
 * context-sizes.mjs
 * Shows the context size (total tokens) of the latest session for each bot.
 * Usage: node tools/context-sizes.mjs
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const SESSIONS_DIR = path.join(process.cwd(), 'data/sessions');

function fmtTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function bar(fraction, width = 20) {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Find the most recently modified .jsonl (excluding subagents/) for a group
function latestSession(groupDir) {
  const projectsDir = path.join(groupDir, '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  let latest = null;
  for (const proj of fs.readdirSync(projectsDir)) {
    const projDir = path.join(projectsDir, proj);
    if (!fs.statSync(projDir).isDirectory()) continue;
    for (const file of fs.readdirSync(projDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const full = path.join(projDir, file);
      const mtime = fs.statSync(full).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { path: full, mtime };
    }
  }
  return latest?.path ?? null;
}

// Read last assistant entry with usage from a JSONL file
function lastUsage(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  let lastU = null;
  let lastTs = null;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const usage = entry.message?.usage;
    if (usage && entry.type === 'assistant') {
      lastU = usage;
      lastTs = entry.timestamp ?? null;
    }
  }
  return lastU ? { usage: lastU, timestamp: lastTs } : null;
}

function contextTokens(usage) {
  return (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

// Gather results
const results = [];

for (const group of fs.readdirSync(SESSIONS_DIR).sort()) {
  const groupDir = path.join(SESSIONS_DIR, group);
  if (!fs.statSync(groupDir).isDirectory()) continue;

  const sessionFile = latestSession(groupDir);
  if (!sessionFile) continue;

  const found = lastUsage(sessionFile);
  if (!found) continue;

  const total = contextTokens(found.usage);
  results.push({ group, total, timestamp: found.timestamp, usage: found.usage });
}

if (!results.length) {
  console.log('No sessions found.');
  process.exit(0);
}

const max = Math.max(...results.map(r => r.total));

// Sort by context size descending
results.sort((a, b) => b.total - a.total);

const labelW = Math.max(...results.map(r => r.group.length));

console.log('\n  Context sizes — latest session per bot\n');
console.log(`  ${'BOT'.padEnd(labelW)}   ${'TOKENS'.padStart(7)}   ${'BAR'.padEnd(22)}  LAST ACTIVE`);
console.log(`  ${'─'.repeat(labelW)}   ${'─'.repeat(7)}   ${'─'.repeat(22)}  ${'─'.repeat(11)}`);

for (const r of results) {
  const fraction = max > 0 ? r.total / max : 0;
  const b = bar(fraction, 22);
  const tokens = fmtTokens(r.total).padStart(7);
  const label = r.group.padEnd(labelW);
  const age = fmtDate(r.timestamp);
  console.log(`  ${label}   ${tokens}   ${b}  ${age}`);
}

console.log();
