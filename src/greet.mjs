/**
 * Greeting (发送话术) flow.
 *
 * The conversation list is virtualized: only the first page of rows exists in
 * the DOM, and each row is an element whose `[d-c]` attribute is NOT unique —
 * several rows can share it. Rows are therefore addressed by index, never by
 * attribute lookup.
 *
 * The message box is a Slate-style contenteditable. Writing innerHTML or using
 * execCommand is ignored by it; the only reliable path is a real keyboard
 * sequence (Ctrl+A, Backspace) followed by Input.insertText.
 */

import { SEL } from "./selectors.mjs";
import { sleep, norm, typeInto } from "./cdp.mjs";

/** Which conversations are currently rendered, with their preview text. */
export async function listConversations(cdp) {
  const raw = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(SEL.conversationItem)}));
    return JSON.stringify(rows.map((row, i) => {
      const title = (row.querySelector(${JSON.stringify(SEL.conversationTitle)}) || row).innerText
        .replace(/\\s+/g, " ").trim();
      const preview = (row.querySelector(${JSON.stringify(SEL.lastMessagePreview)}) || {}).innerText || "";
      return { i, title: title.slice(0, 60), preview: preview.replace(/\\s+/g, " ").slice(0, 60) };
    }));
  })()`);
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

/** Scroll the conversation list to bring older rows into the DOM. */
export async function loadMoreConversations(cdp, times = 3) {
  for (let n = 0; n < times; n++) {
    const moved = await cdp.eval(`(() => {
      const row = document.querySelector(${JSON.stringify(SEL.conversationItem)});
      if (!row) return false;
      const scroller = row.closest("[class*=scroll], .chat-list, ul") || row.parentElement;
      if (!scroller) return false;
      const before = scroller.scrollTop;
      scroller.scrollTop = scroller.scrollHeight;
      return scroller.scrollTop !== before;
    })()`);
    if (!moved) break;
    await sleep(1500);
  }
}

/** Open the conversation at `index`. */
export async function openConversation(cdp, index) {
  const ok = await cdp.eval(`(() => {
    const rows = document.querySelectorAll(${JSON.stringify(SEL.conversationItem)});
    const row = rows[${index}];
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!ok) throw new Error(`conversation ${index} not found`);
  await cdp.waitFor(`!!document.querySelector(${JSON.stringify(SEL.chatInput)})`, 15000);
  await sleep(1200);
}

/** How many of our own messages are in the open conversation. */
export async function myMessageCount(cdp) {
  return cdp.eval(`document.querySelectorAll(${JSON.stringify(SEL.myMessage)}).length`);
}

/** True when the open conversation already contains a message equal to `text`. */
export async function alreadySent(cdp, text) {
  const target = norm(text);
  const raw = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(SEL.myMessage)}));
    return JSON.stringify(rows.map((r) => r.innerText || ""));
  })()`);
  let bodies = [];
  try {
    bodies = JSON.parse(raw || "[]");
  } catch {
    bodies = [];
  }
  return bodies.some((b) => norm(b).includes(target.slice(0, 60)));
}

/** Type and send the message in the open conversation. */
export async function sendMessage(cdp, text, cfg) {
  const got = await typeInto(cdp, SEL.chatInput, text);
  if (!norm(got).includes(norm(text).slice(0, 40))) {
    return { ok: false, why: "typed text does not match", got };
  }
  await sleep(300);
  const clicked = await cdp.eval(`(() => {
    const btn = document.querySelector(${JSON.stringify(SEL.sendButton)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) {
    // Fallback: Enter key.
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 13,
      code: "Enter",
      key: "Enter",
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 13,
      code: "Enter",
      key: "Enter",
    });
  }
  await sleep(cfg.pacing.betweenMessages);
  return { ok: await alreadySent(cdp, text) };
}

/**
 * Greet every new conversation reachable in the list.
 * @param {string[]} [onlyTitles] restrict to rows whose title contains one of these
 */
export async function greetAll(cdp, cfg, text, { onlyTitles = null, max = 40, onProgress } = {}) {
  await cdp.goto(cfg.site.chat, { settleMs: cfg.pacing.afterTabSwitch });
  await cdp.waitFor(`!!document.querySelector(${JSON.stringify(SEL.conversationItem)})`, 20000);
  await loadMoreConversations(cdp, 3);

  const rows = await listConversations(cdp);
  const sent = [];
  const skipped = [];
  const failed = [];

  // Walk backwards: sending a message moves its row to the top, which shifts
  // every index forward. Descending order keeps untouched rows stable.
  for (let i = Math.min(rows.length, max) - 1; i >= 0; i--) {
    const row = rows[i];
    if (onlyTitles && !onlyTitles.some((t) => row.title.includes(t))) continue;
    onProgress?.(`[${i}] ${row.title}`);
    try {
      await openConversation(cdp, i);
      if (await alreadySent(cdp, text)) {
        skipped.push(row.title);
        onProgress?.("  skip: already sent");
        continue;
      }
      const res = await sendMessage(cdp, text, cfg);
      if (res.ok) {
        sent.push(row.title);
        onProgress?.("  sent");
      } else {
        failed.push({ title: row.title, why: res.why || "not verified" });
        onProgress?.(`  fail: ${res.why || "not verified"}`);
      }
    } catch (e) {
      failed.push({ title: row.title, why: e.message });
      onProgress?.(`  error: ${e.message}`);
    }
    await sleep(600);
  }
  return { sent, skipped, failed, total: rows.length };
}
