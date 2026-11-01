/**
 * De-duplication store.
 *
 * Two files, both git-ignored:
 *   data/seen.json     — every job we have ever handled
 *   data/rounds/*.json — one record per round, for auditing
 *
 * Identity is (company, title). Job IDs on the site rotate, so the slug in the
 * URL is not stable enough on its own.
 */

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

const DATA = path.join(ROOT, "data");
const SEEN = path.join(DATA, "seen.json");
const ROUNDS = path.join(DATA, "rounds");

function ensure() {
  fs.mkdirSync(ROUNDS, { recursive: true });
}

export function key(company, title) {
  return `${String(company || "").trim()}|${String(title || "").trim()}`;
}

export function loadSeen() {
  ensure();
  if (!fs.existsSync(SEEN)) return { jobs: {}, stats: { rounds: 0 } };
  try {
    return JSON.parse(fs.readFileSync(SEEN, "utf8"));
  } catch {
    return { jobs: {}, stats: { rounds: 0 } };
  }
}

export function saveSeen(seen) {
  ensure();
  fs.writeFileSync(SEEN, JSON.stringify(seen, null, 2), "utf8");
}

/**
 * Filter a candidate list against the store.
 * @returns {{fresh: object[], skipped: object[]}}
 */
export function partition(candidates, seen) {
  const fresh = [];
  const skipped = [];
  for (const job of candidates) {
    const k = key(job.company, job.title);
    if (seen.jobs[k]) skipped.push(job);
    else fresh.push(job);
  }
  return { fresh, skipped };
}

export function markRound(seen, records) {
  ensure();
  for (const r of records) {
    const k = key(r.company, r.title);
    seen.jobs[k] = {
      company: r.company,
      title: r.title,
      url: r.url,
      status: r.status,
      round: r.round,
      at: new Date().toISOString(),
    };
  }
  seen.stats = seen.stats || {};
  seen.stats.rounds = (seen.stats.rounds || 0) + 1;
  seen.stats.lastRoundAt = new Date().toISOString();

  const file = path.join(ROUNDS, `round-${String(seen.stats.rounds).padStart(3, "0")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), records }, null, 2), "utf8");
  saveSeen(seen);
  return seen;
}

export function summary(seen) {
  const jobs = Object.values(seen.jobs || {});
  const by = {};
  for (const j of jobs) by[j.status] = (by[j.status] || 0) + 1;
  return {
    total: jobs.length,
    byStatus: by,
    rounds: seen.stats?.rounds || 0,
    lastRoundAt: seen.stats?.lastRoundAt || null,
  };
}
