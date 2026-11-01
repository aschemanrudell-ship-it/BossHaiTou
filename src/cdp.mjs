/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Zero dependencies. Requires Node >= 22 (global WebSocket / fetch).
 *
 * The tool never launches its own browser: it attaches to a Chrome instance
 * that the user has already started with --remote-debugging-port and has
 * already logged into the target site with. That keeps credentials entirely
 * outside this project.
 */

const DEFAULT_HTTP = "http://127.0.0.1:9222";

export class Cdp {
  constructor(ws, id = 0) {
    this.ws = ws;
    this.id = id;
    this.pending = new Map();
    this.session = null;
  }

  /**
   * Attach to the first page target whose URL matches `urlPattern`.
   * @param {{http?: string, urlPattern?: RegExp, timeoutMs?: number}} opts
   */
  static async attach(opts = {}) {
    const http = opts.http || DEFAULT_HTTP;
    const pattern = opts.urlPattern || /./;
    const deadline = Date.now() + (opts.timeoutMs || 15000);

    let target = null;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(http + "/json/list");
        const list = await res.json();
        const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
        target = pages.find((t) => pattern.test(t.url)) || pages[0] || null;
        if (target) break;
      } catch (e) {
        lastErr = e;
      }
      await sleep(500);
    }
    if (!target) {
      throw new Error(
        `No page target found on ${http}. ` +
          `Start Chrome with --remote-debugging-port and open the site first.` +
          (lastErr ? ` Last error: ${lastErr.message}` : "")
      );
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "cdp error"));
        else resolve(msg.result);
      }
    };

    cdp.target = target;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return cdp;
  }

  /** Low-level command. */
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`cdp timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression: `(() => { try { return (${expression}); } catch (e) { return "__ERR__:" + e.message; } })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        "eval failed: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text)
      );
    }
    const value = res.result?.value;
    if (typeof value === "string" && value.startsWith("__ERR__:")) {
      throw new Error(value.slice(8));
    }
    return value;
  }

  /** Evaluate an expression body (pass raw statements ending in return). */
  async run(body) {
    return this.eval(`(() => { ${body} })()`);
  }

  /** Poll `expression` until it is truthy. */
  async waitFor(expression, timeoutMs = 20000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch {
        /* page may be mid-navigation */
      }
      await sleep(intervalMs);
    }
    return false;
  }

  async goto(url, { settleMs = 1200, timeoutMs = 25000 } = {}) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", timeoutMs);
    await sleep(settleMs);
  }

  async shot(selector) {
    // Not implemented: screenshots are cheap to add but not needed by the core flows.
    throw new Error("shot() is not part of the core client");
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize text for comparison: strip all whitespace. */
export const norm = (s) => String(s || "").replace(/\s+/g, "");

/**
 * Type text into a contenteditable element the way a human would.
 *
 * A plain `execCommand`/innerHTML write is ignored by Slate-style editors, so
 * the sequence is: focus -> select all -> real Ctrl+A -> Backspace -> insertText.
 * The caller must verify the field is empty before typing.
 */
export async function typeInto(cdp, selector, text, { settleMs = 950 } = {}) {
  const focused = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  })()`);
  if (!focused) throw new Error(`input not found: ${selector}`);

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers: 2,
    windowsVirtualKeyCode: 65,
    code: "KeyA",
    key: "a",
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 2,
    windowsVirtualKeyCode: 65,
    code: "KeyA",
    key: "a",
  });
  await sleep(120);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    windowsVirtualKeyCode: 8,
    code: "Backspace",
    key: "Backspace",
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    windowsVirtualKeyCode: 8,
    code: "Backspace",
    key: "Backspace",
  });
  await sleep(380);

  const left = await cdp.eval(
    `(document.querySelector(${JSON.stringify(selector)})?.innerText || "").trim().length`
  );
  if (left !== 0) throw new Error(`input not cleared (still ${left} chars)`);

  await cdp.send("Input.insertText", { text });
  await sleep(settleMs);

  const got = await cdp.eval(
    `(document.querySelector(${JSON.stringify(selector)})?.innerText || "")`
  );
  return got;
}
