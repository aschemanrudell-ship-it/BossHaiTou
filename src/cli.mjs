#!/usr/bin/env node
/**
 * Boss海投 — CLI entry point.
 *
 *   node src/cli.mjs status
 *   node src/cli.mjs collect
 *   node src/cli.mjs apply   [--limit 15] [--dry]
 *   node src/cli.mjs greet   [--limit 40] [--only "公司A,公司B"]
 *   node src/cli.mjs run     [--rounds 5]
 */

import { loadConfig, loadMessage } from "./config.mjs";
import { Cdp, sleep } from "./cdp.mjs";
import { collectAll, filterJobs } from "./collect.mjs";
import { applyOne } from "./apply.mjs";
import { greetAll } from "./greet.mjs";
import { loadSeen, partition, markRound, summary } from "./store.mjs";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}
const flag = (name) => process.argv.includes(`--${name}`);

async function withBrowser(cfg, fn) {
  const cdp = await Cdp.attach({ http: cfg.cdp });
  try {
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

async function cmdStatus() {
  const seen = loadSeen();
  const s = summary(seen);
  console.log(`已记录岗位 : ${s.total}`);
  console.log(`轮次       : ${s.rounds}`);
  console.log(`最近一轮   : ${s.lastRoundAt || "-"}`);
  for (const [k, v] of Object.entries(s.byStatus)) console.log(`  ${k.padEnd(8)} ${v}`);
}

async function cmdCollect(cfg) {
  return withBrowser(cfg, async (cdp) => {
    const all = await collectAll(cdp, cfg, { onProgress: (m) => console.log(m) });
    const { kept, rejected } = filterJobs(all, cfg);
    const seen = loadSeen();
    const { fresh } = partition(kept, seen);
    console.log(`\n采集 ${all.length} → 规则通过 ${kept.length} → 新岗位 ${fresh.length}`);
    for (const r of rejected.slice(0, 5)) console.log(`  reject ${r.why}: ${r.job.title}`);
    for (const j of fresh) console.log(`  + ${j.title} | ${j.company}`);
    return fresh;
  });
}

async function cmdApply(cfg, { limit, dry }) {
  const seen = loadSeen();
  const candidates = await cmdCollect(cfg);
  const batch = candidates.slice(0, limit);
  if (!batch.length) {
    console.log("没有新岗位可投。");
    return [];
  }
  if (dry) {
    console.log(`\n[dry] 将投递 ${batch.length} 个岗位，未实际执行。`);
    return [];
  }

  const results = await withBrowser(cfg, async (cdp) => {
    const out = [];
    for (const job of batch) {
      let status = "ERROR";
      let note = "";
      try {
        const r = await applyOne(cdp, job, cfg);
        status = r.status;
        note = r.note || "";
      } catch (e) {
        note = e.message;
      }
      out.push({ ...job, status, note });
      console.log(`  ${status.padEnd(8)} ${job.title} | ${job.company}${note ? " — " + note : ""}`);
      if (status === "LIMIT" && /not acknowledgeable/.test(note)) {
        console.log("  ↑ 达到当日沟通上限，停止本轮。");
        break;
      }
      await sleep(800);
    }
    return out;
  });

  markRound(seen, results);
  const sent = results.filter((r) => r.status === "SENT").length;
  console.log(`\n本轮投递：${sent} 成功 / ${results.length} 尝试`);
  return results;
}

async function cmdGreet(cfg, { limit, only }) {
  const text = loadMessage();
  const onlyTitles = only ? String(only).split(",").map((s) => s.trim()).filter(Boolean) : null;
  return withBrowser(cfg, async (cdp) => {
    const res = await greetAll(cdp, cfg, text, {
      onlyTitles,
      max: limit,
      onProgress: (m) => console.log(m),
    });
    console.log(`\n发送 ${res.sent.length} / 跳过 ${res.skipped.length} / 失败 ${res.failed.length}`);
    for (const f of res.failed) console.log(`  失败 ${f.title}: ${f.why}`);
    return res;
  });
}

async function cmdRun(cfg, { rounds }) {
  for (let r = 1; r <= rounds; r++) {
    console.log(`\n=== 第 ${r}/${rounds} 轮 ${new Date().toLocaleTimeString()} ===`);
    const applied = await cmdApply(cfg, { limit: cfg.limits.perRound, dry: false });
    await cmdGreet(cfg, { limit: 40, only: null });
    if (r < rounds) {
      const wait = cfg.limits.roundIntervalMin * 60 * 1000;
      console.log(`等待 ${cfg.limits.roundIntervalMin} 分钟后进入下一轮…`);
      await sleep(wait);
    }
  }
}

async function main() {
  const cmd = process.argv[2] || "status";
  const cfg = loadConfig();
  const limit = Number(arg("limit", cfg.limits.perRound));

  switch (cmd) {
    case "status":
      return cmdStatus();
    case "collect":
      await cmdCollect(cfg);
      return;
    case "apply":
      await cmdApply(cfg, { limit, dry: flag("dry") });
      return;
    case "greet":
      await cmdGreet(cfg, { limit: Number(arg("limit", 40)), only: arg("only") });
      return;
    case "run":
      await cmdRun(cfg, { rounds: Number(arg("rounds", 3)) });
      return;
    default:
      console.log("用法: node src/cli.mjs <status|collect|apply|greet|run> [options]");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("错误:", e.message);
  process.exitCode = 1;
});
