# 兼容性与开发验证

当前依赖 SDK 0.55.0、UI 0.6.0；插件版本与最低客户端版本以 manifest.json 为准。仅声明 desktop：朗读（`tts.open`）、保存资源文件（`upload.save`）、对象动作、详情区块与侧栏只在桌面提供。

## 验证与发布

1. 使用正式 npm 依赖与仓库锁文件执行 `pnpm install --frozen-lockfile`，不注入本地 SDK。
2. 执行 `pnpm test`，再执行 `pnpm build`。
3. 正式用户通过插件中心安装。作者客户端行为验收覆盖启用、生成、播放、跳回原文、保存重开与停用；构建或单测通过不等于已完成这些验收。
4. 发布时提高 package.json 与 manifest.json 版本，使用新 tag；不覆盖旧版本。推送 tag 会触发发布工作流，提交源码不等于已经上架。
