#!/usr/bin/env npx tsx
/**
 * Token usage estimator for NanoClaw
 *
 * Parses JSONL session logs and reports token usage per group and model.
 *
 * Usage:
 *   npx tsx scripts/token-usage.ts                  # all time
 *   npx tsx scripts/token-usage.ts --since 1h       # last hour
 *   npx tsx scripts/token-usage.ts --since 24h      # last 24 hours
 *   npx tsx scripts/token-usage.ts --since 7d       # last 7 days
 *   npx tsx scripts/token-usage.ts --since 2026-03-01  # since date
 */

import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = path.join(process.cwd(), 'data', 'sessions');

// Pricing per million tokens (as of March 2026)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5':  { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

function parseSince(arg: string): Date {
  const match = arg.match(/^(\d+)([hdm])$/);
  if (match) {
    const [, num, unit] = match;
    const ms = unit === 'h' ? +num * 3600000
             : unit === 'd' ? +num * 86400000
             : +num * 60000;
    return new Date(Date.now() - ms);
  }
  const date = new Date(arg);
  if (isNaN(date.getTime())) {
    console.error(`Invalid --since value: ${arg}`);
    process.exit(1);
  }
  return date;
}

interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  models: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    requests: number;
  }>;
}

function newStats(): TokenStats {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, models: {} };
}

function ensureModel(stats: TokenStats, model: string) {
  if (!stats.models[model]) {
    stats.models[model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let since: Date | null = null;

  const sinceIdx = args.indexOf('--since');
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    since = parseSince(args[sinceIdx + 1]);
  }

  const jsonlFiles: string[] = [];
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const group of fs.readdirSync(SESSIONS_DIR)) {
      const projectsDir = path.join(SESSIONS_DIR, group, '.claude', 'projects');
      if (!fs.existsSync(projectsDir)) continue;
      for (const project of fs.readdirSync(projectsDir)) {
        const projectPath = path.join(projectsDir, project);
        if (!fs.statSync(projectPath).isDirectory()) continue;
        for (const file of fs.readdirSync(projectPath)) {
          if (file.endsWith('.jsonl')) {
            jsonlFiles.push(path.join(group, '.claude', 'projects', project, file));
          }
        }
      }
    }
  }

  if (jsonlFiles.length === 0) {
    console.log('No session logs found.');
    return;
  }

  const groupStats: Record<string, TokenStats> = {};
  const totalStats = newStats();

  for (const file of jsonlFiles) {
    const groupFolder = file.split('/')[0];
    if (!groupStats[groupFolder]) groupStats[groupFolder] = newStats();
    const stats = groupStats[groupFolder];

    const fullPath = path.join(SESSIONS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf-8');

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        // Filter by timestamp
        if (since && entry.timestamp) {
          const ts = new Date(entry.timestamp);
          if (ts < since) continue;
        }

        // Only count assistant messages with usage data
        if (entry.type !== 'assistant' || !entry.message?.usage) continue;

        const usage = entry.message.usage;
        const model = entry.message.model || 'unknown';

        const input = usage.input_tokens || 0;
        const output = usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheWrite = usage.cache_creation_input_tokens || 0;

        // Skip entries with no meaningful token count (streaming deltas with 0s)
        if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

        stats.inputTokens += input;
        stats.outputTokens += output;
        stats.cacheReadTokens += cacheRead;
        stats.cacheWriteTokens += cacheWrite;
        stats.requests++;

        ensureModel(stats, model);
        stats.models[model].inputTokens += input;
        stats.models[model].outputTokens += output;
        stats.models[model].cacheReadTokens += cacheRead;
        stats.models[model].cacheWriteTokens += cacheWrite;
        stats.models[model].requests++;

        totalStats.inputTokens += input;
        totalStats.outputTokens += output;
        totalStats.cacheReadTokens += cacheRead;
        totalStats.cacheWriteTokens += cacheWrite;
        totalStats.requests++;

        ensureModel(totalStats, model);
        totalStats.models[model].inputTokens += input;
        totalStats.models[model].outputTokens += output;
        totalStats.models[model].cacheReadTokens += cacheRead;
        totalStats.models[model].cacheWriteTokens += cacheWrite;
        totalStats.models[model].requests++;
      } catch {
        // skip unparseable lines
      }
    }
  }

  // Output
  const fmt = (n: number) => n.toLocaleString();
  const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString();
  const fmtCost = (n: number) => `$${n.toFixed(4)}`;

  function estimateCost(model: string, stats: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
    // Find best matching pricing key
    const key = Object.keys(PRICING).find(k => model.includes(k) || model.startsWith(k.split('-').slice(0, 2).join('-')));
    if (!key) return 0;
    const p = PRICING[key];
    return (stats.inputTokens * p.input + stats.outputTokens * p.output + stats.cacheReadTokens * p.cacheRead + stats.cacheWriteTokens * p.cacheWrite) / 1_000_000;
  }

  console.log('');
  console.log(`=== NanoClaw Token Usage ${since ? `(since ${since.toISOString().split('T')[0]})` : '(all time)'} ===`);
  console.log('');

  for (const [group, stats] of Object.entries(groupStats)) {
    if (stats.requests === 0) continue;
    console.log(`📂 ${group}`);
    console.log(`   Requests: ${fmt(stats.requests)}`);

    for (const [model, mStats] of Object.entries(stats.models)) {
      const cost = estimateCost(model, mStats);
      console.log(`   ${model}:`);
      console.log(`     Input: ${fmtK(mStats.inputTokens)}  Output: ${fmtK(mStats.outputTokens)}  Cache read: ${fmtK(mStats.cacheReadTokens)}  Cache write: ${fmtK(mStats.cacheWriteTokens)}`);
      console.log(`     Requests: ${fmt(mStats.requests)}  Est. cost: ${fmtCost(cost)}`);
    }
    console.log('');
  }

  if (Object.keys(groupStats).length > 1) {
    console.log('─'.repeat(60));
  }

  let totalCost = 0;
  console.log(`📊 TOTAL`);
  console.log(`   Requests: ${fmt(totalStats.requests)}`);
  for (const [model, mStats] of Object.entries(totalStats.models)) {
    const cost = estimateCost(model, mStats);
    totalCost += cost;
    console.log(`   ${model}:`);
    console.log(`     Input: ${fmtK(mStats.inputTokens)}  Output: ${fmtK(mStats.outputTokens)}  Cache read: ${fmtK(mStats.cacheReadTokens)}  Cache write: ${fmtK(mStats.cacheWriteTokens)}`);
    console.log(`     Requests: ${fmt(mStats.requests)}  Est. cost: ${fmtCost(cost)}`);
  }
  console.log(`   Total estimated cost: ${fmtCost(totalCost)}`);
  console.log('');
}

main();
