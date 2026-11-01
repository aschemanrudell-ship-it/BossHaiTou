/**
 * Job collection + filtering.
 *
 * The search result page is a plain list of `.job-card-box` anchors. We pull
 * title / company / url from each, then apply the configured keep/drop rules.
 */

import { SEL } from "./selectors.mjs";
import { sleep } from "./cdp.mjs";

/**
 * Scrape every card currently rendered on the search page.
 * @returns {Promise<Array<{title:string, company:string, url:string}>>}
 */
export async function scrapePage(cdp) {
  const raw = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll(${JSON.stringify(SEL.jobCard)}));
    return JSON.stringify(cards.map((card) => {
      const a = card.querySelector("a") || card.closest("a");
      const pick = (sel) => {
        const el = card.querySelector(sel);
        return el ? el.innerText.trim() : "";
      };
      return {
        title: pick(${JSON.stringify(SEL.jobCardName)}),
        company: pick(".company-name") || pick(".company-title") || pick(${JSON.stringify(SEL.jobCardBoss)}),
        url: a ? a.href : "",
      };
    }));
  })()`);
  try {
    return JSON.parse(raw || "[]").filter((j) => j.title && j.url);
  } catch {
    return [];
  }
}

/**
 * Walk all configured keywords and return the deduplicated raw candidate pool.
 */
export async function collectAll(cdp, cfg, { onProgress } = {}) {
  const byUrl = new Map();
  for (const kw of cfg.keywords) {
    const url =
      `${cfg.site.search}?query=${encodeURIComponent(kw)}` + (cfg.city ? `&city=${cfg.city}` : "");
    onProgress?.(`search: ${kw}`);
    await cdp.goto(url, { settleMs: cfg.pacing.afterNavigate });
    const cards = await scrapePage(cdp);
    for (const c of cards) {
      if (!byUrl.has(c.url)) byUrl.set(c.url, c);
    }
    onProgress?.(`  ${cards.length} cards, ${byUrl.size} unique so far`);
    await sleep(800);
  }
  return Array.from(byUrl.values());
}

/**
 * Apply the title rules.
 * @returns {{kept: object[], rejected: Array<{job:object, why:string}>}}
 */
export function filterJobs(jobs, cfg) {
  const kept = [];
  const rejected = [];
  for (const job of jobs) {
    const t = job.title || "";
    if (cfg.requireIntern && !cfg.internRe.test(t)) {
      rejected.push({ job, why: "not-intern" });
      continue;
    }
    if (cfg.hardBlockRe.test(t)) {
      rejected.push({ job, why: "hard-block" });
      continue;
    }
    const dropped = cfg.dropRe.test(t) && !cfg.dropExemptRe.test(t);
    if (dropped) {
      rejected.push({ job, why: "drop-rule" });
      continue;
    }
    if (!cfg.keepRe.test(t)) {
      rejected.push({ job, why: "no-keep-match" });
      continue;
    }
    kept.push(job);
  }
  return { kept, rejected };
}
