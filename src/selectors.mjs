/**
 * All page selectors live here.
 *
 * Sites rename their CSS classes regularly. When a flow breaks, this is the
 * only file you should need to touch. Every entry is verified against the
 * live DOM as of the version noted in package.json.
 */

export const SEL = {
  // ---- job list (search result page) ----
  jobCard: ".job-card-box",
  jobCardName: ".job-name",
  jobCardBoss: ".boss-name",

  // ---- job detail page ----
  applyButton: ".btn-startchat",

  // ---- chat page ----
  conversationItem: ".friend-content", // one row in the left conversation list
  conversationTitle: ".friend-name, .title-box",
  chatTabLabel: "span.label-name", // 全部 / 未读 / 新招呼 / 更多
  chatInput: "[contenteditable=true].chat-input",
  sendButton: ".btn-send",
  myMessage: ".message-item.item-myself",
  lastMessagePreview: ".last-msg-text",
  scrollMore: ".scroll-loading, .load-more, .chat-more",

  // ---- generic modal (rate-limit notice, resume picker, ...) ----
  dialog: ".dialog-wrap, .boss-dialog, [class*=dialog]",
  dialogConfirm: ".dialog-wrap .btn, .dialog-wrap button",
};

/** Texts that mean "the site is telling you to stop for today". */
export const LIMIT_HINTS = [
  "还剩",
  "次数",
  "已达上限",
  "今天已与",
  "沟通机会",
];

/** Candidate button labels used to acknowledge a modal. */
export const ACK_LABELS = ["好", "知道了", "确定", "继续"];
