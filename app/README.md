# Carrel（MVP）

本地优先的桌面学习工作空间：课件阅读、带出处的 AI 问答、可回溯的个人笔记放在同一个三栏界面里。
当前版本完成的是核心闭环：**打开资料 → 选中提问 → 回答带可核实来源 → 加入笔记 → 从笔记回到原文 → 关闭重开恢复现场**。

## 运行

```bash
cd app
npm install
npm run dev                 # 开发模式：Vite + Electron
npm run build && npm start  # 构建渲染层后以生产模式启动
```

Node 22 以上；Windows / macOS。构建产物在 `app/dist`，`app://` 自定义协议加载，不依赖本地文件 URL。

## 已实现

- **资料**：文件选择器或拖拽导入 PDF / Markdown / 图片；资料库支持搜索、类型筛选、收藏、在文件夹中显示、移出资料库（不删原文件）。原始文件始终留在本地，库中只存路径与内容哈希。
- **阅读**：pdf.js 渲染，翻页、页码跳转、缩放/适应宽度、页内查找并高亮、文本选择；高亮标注按归一化坐标保存，可在「标注」页签里重新定位。
- **AI**：多轮对话、流式输出、停止生成；上下文范围可选「选中内容 + 当前页 / 当前页 / 当前文件」，界面明确显示本次范围；视觉模型可附带当前页截图提问。
- **来源可核实**：模型必须输出 `@cite 页码 | 原文摘录`，应用逐字核对已提取的页面文本；核对通过才显示为黄色可点来源，点击跳回该页并闪烁原文；核对不通过标为「未核实」，不会伪造引用。
- **笔记**：Markdown 编辑与预览、自动保存、插入选中摘录、插入 AI 回答、来源锚点（`csref`），点击来源打开对应文件与页码；笔记独立于资料，可跨多份资料引用。
- **AI 整理笔记**：在笔记里选中片段，选一个整理指令（润色 / 精简 / 提纲 / 补例子），流式生成预览，确认后覆盖选中的原文；只改写选区，来源锚点不动。
- **状态**：标签、每份文件的页码、三栏布局、当前笔记、对话都会持久化，重开恢复；关闭前会落盘。

## 模型服务

设置入口在右上角「模型服务」。提供商与模型目录来自 [@cherrystudio/provider-registry](https://github.com/CherryHQ/cherry-studio/tree/main/packages/provider-registry)（MIT），当前只放行聊天相关的 10 个服务；请求层使用 [Vercel AI SDK](https://github.com/vercel/ai)（Apache-2.0）。

- 每个服务可启用多个模型，也可以手填模型 ID；「拉取模型」会调用服务商的 `/models` 接口，把新模型合并进列表（默认启用前 3 个）。
- 凭证四种：API Key、官方 OAuth、本机 CLI 导入、GitHub Copilot。
  - OAuth 走系统浏览器 + PKCE + 本地回环回调，令牌用系统安全存储加密后写入 `secrets.json`；Gemini 需要在 Google Cloud 建一个桌面 OAuth 客户端并填客户端 ID，同时填配额项目 ID。
  - 本机 CLI 导入读取 Claude Code / Codex / OpenCode 已有的登录凭证，属于第三方通道，客户端更新后可能失效，需要重新登录再导入；导入的令牌不自动刷新。
  - Copilot 走 GitHub 设备码登录，同样是非官方通道，随时可能失效。
- 协议按提供商自动选择：OpenAI 兼容、OpenAI Responses、Anthropic Messages、Google Gemini。切模型不影响会话历史。
- 演示模式用本地模板回答，不联网，用来先走通阅读 → 提问 → 引用 → 笔记的完整流程。
- 联网搜索暂未接入，接口定义在 `src/lib/search.ts`，请求层不会调用它。

## 数据位置

`%APPDATA%/Carrel`（macOS 为 `~/Library/Application Support/Carrel`）：

| 文件 | 内容 |
| --- | --- |
| `state.json` | 资料元信息、笔记、标注、对话、布局、阅读位置 |
| `texts/<fileId>.json` | 逐页提取的文本，用于上下文与引文核对 |
| `secrets.json` | 加密后的 API Key |

删除该目录即清空应用数据；原始资料不受影响。

## 范围与限制

首版只承诺下列能力，其余在界面里明确提示而不是假装支持：

- PPTX / DOCX 不做版面渲染（需要外部排版引擎），打开时提示「后续版本」。
- 图片只做预览与缩放，不做标注。
- 没有 OCR、全文检索、笔记导入导出、并排对照、多模型对比、打包安装程序。
- 联网搜索、多模态以外的工具调用尚未接入；OAuth 与订阅通道需要各服务账号，CI 无法自动验证。
- 引用定位是启发式的：文件被外部修改或替换后可能定位失败，界面会提示「未能定位」，不会静默把引用挂到错误内容上。
- 单实例运行；没有自动更新。

## 目录

```text
app/
├─ electron/
│  ├─ main.cjs      窗口、IPC、app:// 协议、CSP、关闭前落盘
│  ├─ preload.cjs   contextBridge 暴露的最小 API
│  ├─ store.cjs     本地存储、哈希、加密密钥
│  ├─ ai.cjs / ai.mjs  AI SDK 请求层与模型列表
│  ├─ oauth.cjs     官方 OAuth（PKCE + 回环回调）
│  └─ subscriptions.cjs  CLI 凭证导入与 Copilot 设备码登录
├─ src/
│  ├─ store.ts      zustand 状态、导入、问答、笔记与引用
│  ├─ components/   工作空间三栏、首页、资料库、笔记、设置
│  └─ lib/          pdf、文本层定位、引文校验、提供商目录、模型解析、搜索接口、Markdown
├─ scripts/         资源复制与开发启动
└─ test/            引文校验与模型提供商测试
```

## 测试

```bash
npm test          # 引文校验、模型提供商迁移与模型解析
npx tsc --noEmit  # 类型检查
```

`local/` 是本地验证用的临时目录（截图、样例 PDF、E2E 脚本），不参与产品运行。
