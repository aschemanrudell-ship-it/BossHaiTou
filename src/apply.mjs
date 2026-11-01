/**
 * Apply (打招呼) flow.
 *
 * Observed behaviour of the target site, which drives this design:
 *
 *  1. Clicking `.btn-startchat` on a job detail page usually opens the chat
 *     directly, and the button then reads 继续沟通.
 *  2. Once the account approaches its daily contact limit, every click instead
 *     raises a modal ("温馨提示 … 还剩 N 次沟通机会"). The click produces NO
 *     greeting. The modal must be acknowledged and the button clicked again —
 *     and after a while it stops being acknowledgeable at all, which is the
 *     real signal to stop for the day.
 *  3. A naive "click then move on" loop therefore reports success while doing
 *     nothing. We verify by re-reading the button label after the modal dance.
 */

import { SEL, LIMIT_HINTS, ACK_LABELS } from "./selectors.mjs";
import { sleep } from "./cdp.mjs";

/** Read the visible modals and whether one of them is the rate-limit notice. */
export async function probeDialog(cdp) {
  const raw = await cdp.eval(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(SEL.dialog)}));
    const texts = nodes
      .map((n) => (n.innerText || "").replace(/\\s+/g, " ").trim())
      .filter((s) => s.length > 2 && s.length < 300);
    return JSON.stringify(texts.slice(0, 4));
  })()`);
  let texts = [];
  try {
    texts = JSON.parse(raw || "[]");
  } catch {
    texts = [];
  }
  const hits = LIMIT_HINTS.filter((h) => texts.some((t) => t.includes(h)));
  const remaining = extractRemaining(texts.join(" "));
  return { texts, isLimit: hits.length > 0, remaining };
}

function extractRemaining(text) {
  const m = text.match(/还剩\s*(\d+)\s*次/);
  if (m) return Number(m[1]);
  const used = text.match(/已与\s*(\d+)\s*位/);
  if (used) return Math.max(0, 150 - Number(used[1]));
  return null;
}

/** Click the acknowledgement button of whatever modal is open. */
export async function ackDialog(cdp) {
  const labels = JSON.stringify(ACK_LABELS);
  return cdp.eval(`(() => {
    const labels = ${labels};
    const scope = document.querySelector(${JSON.stringify(SEL.dialog)});
    if (!scope) return false;
    const candidates = Array.from(scope.querySelectorAll("button, .btn, a, span"));
    const target = candidates.find((el) => labels.includes((el.innerText || "").trim()));
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

/** Current label of the apply button, or null when the page has none. */
export async function applyButtonState(cdp) {
  return cdp.eval(`(() => {
    const btn = document.querySelector(${JSON.stringify(SEL.applyButton)});
    return btn ? (btn.innerText || "").trim() : null;
  })()`);
}

/**
 * Try to greet one job.
 * @returns {Promise<{status:'SENT'|'ALREADY'|'LIMIT'|'BLOCKED'|'ERROR', note?:string}>}
 */
export async function applyOne(cdp, job, cfg) {
  await cdp.goto(job.url, { settleMs: cfg.pacing.afterNavigate });

  const btn = await cdp.waitFor(
    `!!document.querySelector(${JSON.stringify(SEL.applyButton)})`,
    20000
  );
  if (!btn) return { status: "ERROR", note: "no apply button" };

  const label = await applyButtonState(cdp);
  if (label && /继续沟通/.test(label)) return { status: "ALREADY" };

  await sleep(cfg.pacing.afterClick);
  await cdp.eval(
    `(() => { const b = document.querySelector(${JSON.stringify(SEL.applyButton)}); if (b) b.click(); })()`
  );
  await sleep(cfg.pacing.afterClick);

  const dlg = await probeDialog(cdp);
  if (dlg.isLimit) {
    const ok = await ackDialog(cdp);
    if (!ok) return { status: "LIMIT", note: "limit dialog not acknowledgeable" };
    await sleep(1200);
    // One retry: after acknowledging, a second click sometimes still connects.
    await cdp.eval(
      `(() => { const b = document.querySelector(${JSON.stringify(SEL.applyButton)}); if (b) b.click(); })()`
    );
    await sleep(cfg.pacing.afterClick);
    const again = await probeDialog(cdp);
    if (again.isLimit) {
      await ackDialog(cdp);
      return { status: "LIMIT", note: `remaining=${again.remaining ?? "?"}` };
    }
  }

  const after = await applyButtonState(cdp);
  if (after && /继续沟通/.test(after)) return { status: "SENT" };
  if (/立即沟通/.test(after || "")) {
    return { status: "BLOCKED", note: "button unchanged after click" };
  }
  return { status: "SENT", note: after || "navigated" };
}
