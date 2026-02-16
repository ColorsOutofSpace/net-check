# 架构说明

## 1. 总体架构

Net Check 采用前后端分离的本地优先架构：

- 前端：`apps/web`
  - React + TypeScript
  - 负责流程编排 UI、实时输出展示、总览分析展示
- 后端：`apps/server`
  - Node.js + TypeScript + Express
  - 负责白名单命令执行、任务生命周期管理、SSE 事件流、输出解析与诊断

## 2. 核心模块

### 2.1 Web（`apps/web/src/App.tsx`）

- 左侧栏：
  - 一键检测流程配置（选择项目、顺序调整、并发设置）
  - 单项检测列表
- 右侧面板：
  - `总览`：
    - 总数/运行中/失败/告警统计
    - 分层状态（适配器/路由/DNS/代理/互联网）
    - 根因推断
    - 检测矩阵与诊断建议（同一模块整合）
  - `实时输出`：命令原始流式输出
- 布局能力：
  - 左右分割线拖拽调宽并本地持久化
  - 页面全屏固定，滚动在子区域内进行

### 2.2 Server API（`apps/server/src/index.ts`）

- `GET /api/commands`：返回检测项定义
- `POST /api/jobs`：创建任务
- `GET /api/jobs/:jobId/stream`：SSE 推送 `start/log/error/complete`
- `GET /api/jobs/:jobId`：返回任务快照

### 2.3 诊断领域（`apps/server/src/diagnostics`）

- `definitions.ts`
  - 所有可执行命令白名单
  - 平台差异（Windows/Linux/macOS）命令映射
- `job-manager.ts`
  - 任务创建、进程执行、超时控制
  - 流式输出与任务事件分发
  - 汇总 `structured`、`diagnosis`、`evidence` 到任务快照
  - Windows 输出编码处理与兼容
- `parsers.ts`
  - 命令输出结构化解析
  - 基于规则生成诊断建议与证据链（`evidence`）

## 3. 数据流

1. 前端加载检测项：`GET /api/commands`
2. 用户触发执行（单项或一键）
3. 前端 `POST /api/jobs` 创建任务
4. 前端通过 SSE 订阅任务流
5. 后端执行命令并推送事件
6. 任务结束后输出结构化结果、诊断建议与证据链
7. 前端将结果汇总到总览矩阵并展示

## 4. 一键检测并发模型

- 一键流程维护可执行队列与并发 worker。
- 并发上限由前端配置（默认 4，可在 UI 调整）。
- 单个任务失败不阻塞其余任务，避免流程卡死。

## 5. 告警与根因逻辑（前端）

前端对每个检测项进行状态归类（通过/告警/失败），并在总览中进行：

- 分层状态聚合
- Top 根因推断
- 检测矩阵异常筛选（“仅看异常”）

## 6. 安全边界

- 命令执行严格受 `definitions.ts` 白名单控制。
- API 对输入进行格式与范围校验。
- 不提供任意 shell 执行入口。

## 7. 扩展建议

- 规则引擎外置（JSON/YAML）以便社区贡献诊断规则。
- 增加 parser 单元测试，覆盖中英文输出与跨平台差异。
- 增加任务历史与回归对比能力。
