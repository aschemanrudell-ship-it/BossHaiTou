/**
 * Config loading and validation.
 *
 * Everything user-specific (message text, filters, rate limits) lives in
 * config.json / message.txt next to the project root and is git-ignored, so a
 * cloned copy contains no personal data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  /** Chrome DevTools endpoint of an already-logged-in browser. */
  cdp: "http://127.0.0.1:9222",

  /** Base URLs; only change these if the site moves. */
  site: {
    search: "https://www.zhipin.com/web/geek/jobs",
    chat: "https://www.zhipin.com/web/geek/chat",
  },

  /** City code used by the search URL. Look yours up in the site's own URL. */
  city: "",

  /** Search keywords, one request each. */
  keywords: ["python实习", "后端实习", "开发实习生"],

  /** Hard caps per run. Keep them low; the site rate-limits aggressively. */
  limits: {
    perRound: 15,
    roundIntervalMin: 20,
    maxRounds: 20,
    maxPerDay: 120,
  },

  /** Pacing, in milliseconds. */
  pacing: {
    afterNavigate: 2500,
    afterClick: 1800,
    afterTabSwitch: 3000,
    afterConversationOpen: 2500,
    betweenMessages: 4000,
  },

  /** Keep a job only if its title matches this regex. */
  keepPattern:
    "python|数据|算法|测试|运维|自动化|脚本|爬虫|机器学习|深度学习|量化|实施|AI|人工智能|大模型|智能体|agent|后端|开发|全栈|Node|React",

  /** Drop a job if its title matches this regex (applied unless exempt). */
  dropPattern:
    "剪辑|生图|视频|运营|视觉设计|自动驾驶|嵌入式|java|前端|助教|兼职|销售|客服|行政|人事|财务|产品经理|主播|美工|教师|讲师|Lua|小白|无责|开单|包住|可培训|零基础|不限经验|博士|硕士|高级|资深|专家|架构师|负责人|总监|外包|驻场",

  /** A drop-pattern hit is ignored when the title also matches this. */
  dropExemptPattern: "全栈",

  /** Require the title to look like an internship / campus role. */
  requireIntern: true,
  internPattern: "实习|校招|intern",

  /** Extra hard blocks on the title regardless of keepPattern. */
  hardBlockPattern: "java|golang|\\.net|php|c#",
};

export function loadConfig(file = path.join(ROOT, "config.json")) {
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    console.warn(`[warn] ${path.basename(file)} not found, using defaults`);
  }
  const cfg = {
    ...DEFAULTS,
    ...user,
    site: { ...DEFAULTS.site, ...(user.site || {}) },
    limits: { ...DEFAULTS.limits, ...(user.limits || {}) },
    pacing: { ...DEFAULTS.pacing, ...(user.pacing || {}) },
    keywords:
      Array.isArray(user.keywords) && user.keywords.length
        ? user.keywords
        : DEFAULTS.keywords,
  };
  cfg.keepRe = new RegExp(cfg.keepPattern);
  cfg.dropRe = new RegExp(cfg.dropPattern, "i");
  cfg.dropExemptRe = new RegExp(cfg.dropExemptPattern);
  cfg.internRe = new RegExp(cfg.internPattern, "i");
  cfg.hardBlockRe = new RegExp(cfg.hardBlockPattern, "i");
  return cfg;
}

/** Load the outgoing message. Refuses to run with the shipped sample. */
export function loadMessage(file = path.join(ROOT, "message.txt")) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `message.txt not found. Copy message.example.txt to message.txt and write your own message.`
    );
  }
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("message.txt is empty");
  if (/\[.*?PLACEHOLDER.*?\]/i.test(text)) {
    throw new Error("message.txt still contains a placeholder — fill it in first");
  }
  return text;
}
