# 架构说明（MVP）

## 分层设计

- 表现层（`apps/web`）：命令面板、输出面板、诊断视图。
- 服务层（`apps/server/src/index.ts`）：REST + SSE 接口。
- 领域层（`apps/server/src/diagnostics`）：
  - `definitions.ts`：白名单命令定义与参数映射。
  - `job-manager.ts`：任务管理、进程执行、流式事件。
  - `parsers.ts`：输出解析与规则诊断。

## 核心流程

1. 前端请求 `/api/commands` 获取可执行检测项。
2. 用户点击“运行”后，前端调用 `/api/jobs` 创建任务。
3. 前端通过 `/api/jobs/:jobId/stream` 建立 SSE 流。
4. 后端执行系统命令并回传 `start/log/error/complete` 事件。
5. 任务结束后前端展示结构化结果和诊断建议。

## 安全约束

- 仅允许执行 `definitions.ts` 中定义的白名单命令。
- 输入目标受正则校验，拒绝非法字符。
- 不开放任意 shell 执行能力。

