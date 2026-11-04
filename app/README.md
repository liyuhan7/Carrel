# Carrel 应用架构

Electron 主进程 + React 渲染层的本地优先桌面应用。界面只负责交互与渲染；文件、凭证、模型请求都在主进程，应用状态以单个 JSON 文档落盘。

## 进程与职责

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 渲染层 | `src/` | React 19 + zustand：三栏布局、阅读器、笔记、资料库、设置 |
| 预加载 | `electron/preload.cjs` | contextBridge 暴露的窗口 API；渲染层不开 nodeIntegration |
| 主进程 | `electron/main.cjs` | 窗口、IPC、`app://` 协议、CSP、单实例、关闭前落盘 |
| 存储 | `electron/store.cjs` | `state.json`、逐页文本、safeStorage 加密密钥 |
| 请求层 | `electron/ai.cjs`、`ai.mjs` | AI SDK 流式请求、模型列表、协议适配与请求头修正 |
| 凭证 | `electron/oauth.cjs`、`subscriptions.cjs` | PKCE 回环 OAuth、CLI 凭证导入与续期、Copilot 设备码 |

渲染层只通过 `window.cs` 调 IPC；主进程回传结果与事件，密钥不进入渲染层。

## 一次问答的链路

1. `store.sendQuestion` 用当前资料、页码、选区拼上下文（`buildContext`），视觉模型可选附带页面截图。
2. `window.cs.startAI(reqId, payload)` → 主进程 `ai:start`：按 `ModelRoute` 取凭证，交给 `ai.mjs`。
3. `ai.mjs` 用 AI SDK 的 `streamText` 请求；增量走 `ai:delta`，结束 `ai:done`，异常 `ai:error`。
4. 渲染层把整段文本交给 `parseAnswer`：抽 `@cite` 行，用 `locateQuote` 在已提取的页面文本里逐字比对；通过则标为已验证并记录页码，失败标为「未核实」。
5. 消息、引用与阅读位置随状态持久化：写入防抖，关闭前补一次 flush。

## 阅读与定位

- pdf.js 渲染页面，所有页在一个滚动容器里连续排布，滚动即翻页；只保留当前页与相邻页的画布和文本层，其余页只占位。
- 当前页由滚动位置推出并写回阅读状态，页码输入、上下页按钮和引用跳转都定位到对应页；缩放时保持当前页在视口内的位置。
- 文本层提供选区，页内查找高亮命中，缩放与适应宽度只改视口。
- 标注保存为页面归一化坐标 `[x, y, w, h]`，与缩放无关；窗口尺寸变化后按当前视口重新投影。
- 每份文件的逐页文本存在 `texts/<fileId>.json`，同时作为问答上下文和引文核对依据。
- 引文定位先做归一化（空白、标点、全半角），再按选区提示页 → 当前页 → 全文的顺序查找；定位失败会提示，不把引用挂到别的内容上。
- 笔记来源锚点形如 `csref:r1`，由链接服务解析成「文件 + 页码 + 摘录」，点击时打开对应资料并定位。

## 笔记

- 正文是 Markdown，编辑与预览共用同一份内容；保存走 store 的持久化队列。
- 「AI 整理」把选中片段与指令发给模型，流式预览；确认后只替换选区文本，锚点与其余段落不动。
- 插入来源时写入锚点与摘录；撤销条由笔记 UI 的 undo 状态管理，超时自动收起。

## 模型服务

- 目录：`src/lib/catalog.ts` 合并 `@cherrystudio/provider-registry`（MIT）与 GCMP（MIT）的厂商配置，得到 28 个服务的端点、模型与能力；`catalog/gcmp.ts` 保存 Cherry 目录未覆盖的厂商数据。
- 协议：OpenAI 兼容、OpenAI Responses、Anthropic Messages、Google Gemini。部分服务在一个 provider 内混用协议，`ModelPreset.protocol` 覆盖连接级协议，`routeOf` 据此生成路由。
- 凭证：API Key（safeStorage）、官方 OAuth（PKCE + 回环回调）、本机 CLI 导入（Claude Code / Codex / Grok Build，含续期与写回）、GitHub Copilot 设备码。
- 请求头修正：Codex 走 ChatGPT 后端，带 `originator` / `version` / `chatgpt-account-id`，请求体 `store: false` 且 system 作为 `instructions`；OpenCode 带 `x-opencode-*` 会话头；Anthropic OAuth 带 `anthropic-beta`。
- 模型发现：调服务商 `/models` 合并进目录，标记来源（目录 / 发现 / 手填）；`modelList: registry` 的服务跳过网络。
- 联网搜索与工具调用不在请求链路上：`src/lib/search.ts` 只定义契约。

## 数据与安全

| 路径 | 内容 |
| --- | --- |
| `state.json` | 资料元信息、笔记、标注、对话、布局、阅读位置 |
| `texts/<fileId>.json` | 逐页提取的文本 |
| `secrets.json` | safeStorage 加密后的密钥与令牌 |

数据目录：Windows `%APPDATA%/Carrel`，macOS `~/Library/Application Support/Carrel`。渲染层经 `app://` 加载，CSP 为 `connect-src 'self'`，网络请求只在主进程发起。

## 构建与测试

```bash
npm run dev     # Vite + Electron 开发模式
npm run build   # 复制 pdf.js 资源、tsc --noEmit、vite build
npm start       # 以生产构建启动
npm test        # 引文校验、模型提供商、笔记与阅读状态
```

`scripts/assets.mjs` 把 pdf.js 的 cmaps 与标准字体复制到 `public/`；构建产物在 `dist/`，由 `app://` 协议加载。

## 目录

```text
app/
├─ electron/
│  ├─ main.cjs           窗口、IPC、app:// 协议、CSP、关闭前落盘
│  ├─ preload.cjs        contextBridge 暴露的窗口 API
│  ├─ store.cjs          state.json、逐页文本、加密密钥
│  ├─ ai.cjs / ai.mjs    AI SDK 请求层、模型列表、协议适配
│  ├─ oauth.cjs          PKCE 回环 OAuth
│  └─ subscriptions.cjs  CLI 凭证导入/续期、Copilot 设备码
├─ src/
│  ├─ store.ts           zustand 状态、导入、问答、笔记与引用
│  ├─ components/        三栏工作空间、首页、资料库、笔记、设置
│  ├─ reader/            阅读器与标注
│  ├─ notes/             笔记块、捕获与插入
│  ├─ shared/            资源、锚点、链接与阅读状态的契约和实现
│  └─ lib/               pdf、文本层定位、引文校验、提供商目录、模型解析、Markdown
├─ scripts/              资源复制与开发启动
└─ test/                 引文校验、提供商、笔记与阅读状态测试
```
