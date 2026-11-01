# 开发说明

## 数据契约

Tau 客户端把卡片、文章、项目文档上原有的播客迁入本插件时直接按这里的形状写库，修改字段须同步宿主迁移（`apps/desktop/src-electron/main/modules/podcast-plugin-migration.ts`）。

- 实体 `episode`：卡片、文章、项目文档一篇一期，`key` 为 `<类型>:<ID>`（`card` / `article` / `document`）；Notebook 每次生成一期，`key` 为 `notebook:<Notebook ID>:<UUID>`（迁入的旧播客为 `notebook:<ID>:legacy-<笔记 ID>`）。标题为这一期的名字；正文为可读脚本（每段「**说话人**：内容」），供搜索与 @ 引用。
- 关联：卡片、文章、项目文档的一期指向原文，`role: "source"`；Notebook 的一期由 Tau 建立指向 Notebook 的关联，`role: "output"`（Notebook 产物列表据此显示）。
- `meta`（读取见 `src/data/model.ts` 的 `readEpisode`，写入见 `episodeMeta`）：
  - `source: { kind, id }`、`sourceKind`（索引）、`sourceTitle`：原文引用与生成时的标题。
  - `status`（索引）：`script` / `review` / `synth` / `failed` / `ready`；`error`、`progress` 为失败信息与断点。
  - `options`：`format`（`duo` / `panel` / `solo`）、`speakers`、`minutes`、`focus`、`review`。
  - `audio`：已完成的版本 `{ url, duration, speakers, lines }`；首次生成完成前为 null。
  - `draft`：待审或合成中的新稿 `{ title, speakers, lines }`；完成后清空，旧音频在此期间照常可听。
  - `speakers` 每项 `{ name, voiceId, voiceName, tone }`，`tone` 为 1–5 的 tag 色板；`lines` 每项 `{ speaker（speakers 下标）, text, start, duration }`，单位秒。

## 生成流程

Notebook 入口（`context.notebooks.registerOutput`）：`prepare` 建占位并返回任务要求（`src/gen/script.ts` 的 `notebookInstructions`），脚本由 Notebook 的生成流程写好后经 `complete` 交回，`jobs.completeNotebook` 解析后直接合成或停在审稿。

卡片入口：
`src/gen/jobs.ts` 在 `activate` 里创建，单并发排队：读原文正文 → AI 功能 `script` 写脚本 → 逐段 `tts.open().synthesize` → 宿主 FFmpeg 拼接为 MP3 → `upload.save` 保存。进度只在内存；段落按「音色 + 文字」缓存，失败后同一次运行内可续；应用关闭时进行中的任务在下次启用时标为失败。

## 本地开发

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm install:local
```

`install:local` 把 `dist/` 的 ZIP 装进 `~/.editor/plugins/tau.podcast`，目标已存在时先停用插件并移走旧目录。
