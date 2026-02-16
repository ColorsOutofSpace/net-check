# GitHub 贡献指南

本文档说明如何在 GitHub 上为 Net Check 做贡献。

## 1. 前置条件

- GitHub 账号
- Node.js 18+
- npm 9+
- Git

## 2. Fork 与本地准备

1. 在 GitHub 上 `Fork` 本仓库到你的账号。
2. 克隆你的 Fork：

```bash
git clone <your-fork-url>
cd net-check
```

3. 安装依赖：

```bash
npm install
```

4. 新建功能分支：

```bash
git checkout -b feat/<short-description>
```

推荐分支命名：
- `feat/...`：新功能
- `fix/...`：缺陷修复
- `docs/...`：文档更新
- `refactor/...`：重构

## 3. 本地开发与验证

常用命令（仓库根目录）：

```bash
npm run dev
npm run lint
npm run build
```

提交前至少执行：

```bash
npm run lint
```

如你修改了命令解析、规则评估、SSE 事件逻辑，建议补充/更新测试。

## 4. 代码规范

- TypeScript 使用 2 空格缩进。
- 前端组件使用 PascalCase，变量与函数使用 camelCase。
- 不要绕过后端白名单执行任意命令。
- 涉及网络命令时，优先保证跨平台兼容与超时兜底。

## 5. Commit 规范

请使用 Conventional Commits，例如：

- `feat: add dns cache flush diagnosis rule`
- `fix: prevent one-click workflow from hanging on timeout`
- `docs: update contribution workflow`

## 6. 提交 Pull Request

1. 推送分支到你的 Fork：

```bash
git push origin <branch-name>
```

2. 在 GitHub 发起 PR 到上游仓库。

3. PR 描述建议包含：
- 变更背景与目标
- 主要改动点
- 验证方式（命令输出、截图、日志）
- 影响范围与潜在风险

4. 若有 UI 改动，请附截图/GIF。

## 7. PR 检查清单

提交前请自查：

- [ ] 已通过 `npm run lint`
- [ ] 文案已中英文策略一致（除专业术语外优先中文）
- [ ] 未引入任意命令执行风险
- [ ] 涉及解析逻辑时已考虑中文/英文输出兼容
- [ ] 已更新相关文档（如 README、架构说明）

## 8. Issue 报告建议

提交问题时请尽量提供：

- 操作系统与版本
- Node/npm 版本
- 复现步骤
- 期望结果 vs 实际结果
- 关键日志（建议脱敏）

## 9. 安全问题

若发现安全漏洞（如命令注入风险），请不要公开披露细节，建议先通过私下渠道联系维护者。
