# 选择器对照表

站点改版后，先看这里的"作用"和"失效表现"，再去 `src/selectors.mjs` 改对应的那一项。

## 岗位列表页

| 键 | 选择器 | 作用 | 失效表现 |
| --- | --- | --- | --- |
| `jobCard` | `.job-card-box` | 单张岗位卡片的根节点 | `collect` 输出 `采集 0` |
| `jobCardName` | `.job-name` | 卡片内的岗位标题 | 标题为空，导致筛选全部丢弃 |
| `jobCardBoss` | `.boss-name` | 卡片内的招聘者名称，公司名抓不到时作为兜底 | 去重键退化为标题 |

## 岗位详情页

| 键 | 选择器 | 作用 | 失效表现 |
| --- | --- | --- | --- |
| `applyButton` | `.btn-startchat` | 「立即沟通」按钮 | `apply` 报 `no apply button` |

按钮文案有两种状态，靠文案判断结果：

- `立即沟通` —— 还没投过
- `继续沟通` —— 已经投过，或刚刚投递成功

## 会话页

| 键 | 选择器 | 作用 | 失效表现 |
| --- | --- | --- | --- |
| `conversationItem` | `.friend-content` | 左侧会话列表的一行 | `greet` 报 `conversation N not found` |
| `conversationTitle` | `.friend-name, .title-box` | 会话标题 | 标题为空，`--only` 过滤失效 |
| `chatInput` | `[contenteditable=true].chat-input` | 消息输入框 | `input not found` |
| `sendButton` | `.btn-send` | 发送按钮 | 退化为 Enter 键发送 |
| `myMessage` | `.message-item.item-myself` | 自己发出的消息气泡 | 幂等判断失效，导致重复发送 |
| `lastMessagePreview` | `.last-msg-text` | 列表行的消息预览 | 不影响发送，仅调试用 |

## 弹窗

| 键 | 选择器 | 作用 |
| --- | --- | --- |
| `dialog` | `.dialog-wrap, .boss-dialog, [class*=dialog]` | 通用弹窗容器 |
| `dialogConfirm` | `.dialog-wrap .btn, .dialog-wrap button` | 弹窗内按钮 |

频率提示的识别不靠选择器，靠 `LIMIT_HINTS` 里的文案关键词匹配弹窗文本 —— 文案通常比类名稳定。

## 排查顺序

1. 打开目标页面，在控制台跑 `document.querySelector("选择器")`，看是否返回节点。
2. 返回 `null` → 选择器失效，从页面元素面板复制新的类名替换。
3. 返回节点但内容为空 → 该节点可能是占位元素，需要再往下找一层。
4. 都正常但流程仍失败 → 大概率是节奏问题，把 `config.json` 里的 `pacing` 调大再试。
