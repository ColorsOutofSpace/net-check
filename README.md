# Net Check

Net Check 是一个本地优先的网络诊断工具，面向开发者快速定位“网络不可用”问题。

当前版本提供：
- 左侧检测流程编排：支持一键检测项目选择、顺序调整、并发数设置。
- 右侧结果面板：
  - `总览`：统计、分层状态、根因分析、检测矩阵与诊断建议（已整合，优先展示证据链）。
  - `实时输出`：命令原始输出流。
- 左右区域分割线支持拖拽调整宽度（并持久化）。
- 页面固定全屏，整页禁滚动，超出内容在对应区域内滚动。

## 适用场景

- 新环境网络不可用，快速判断是网卡、路由、DNS、代理还是外网链路问题。
- CI/开发机出现间歇性网络异常，需要可视化排查路径。
- 团队共建网络诊断规则与命令模板。

## 快速开始

在仓库根目录执行：

```bash
npm install
npm run dev
```

默认地址：
- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`

## npm scripts

在仓库根目录执行：

- `npm run dev`：同时启动前后端。
- `npm run dev:server`：仅启动后端。
- `npm run dev:web`：仅启动前端。
- `npm run build`：构建前后端。
- `npm run lint`：前后端 TypeScript 校验。
- `npm run test`：运行单元测试（server 解析器与 web 总览逻辑）。

## 当前内置检测项（概要）

- 连通性：`Ping`、默认路由检测、全局 ICMP 探测。
- DNS：`DNS 解析`、DNS 服务器配置、Hosts 文件检测、全局 DNS 探测。
- 路径分析：路由追踪。
- HTTP：`HTTP 可用性`。
- 网络接口：网卡链路状态、网卡 IP 配置、DHCP 状态。
- 代理与环境：`IE 代理检测`、`LSP 目录检测`、网络环境变量检测。

## 运行行为说明

- 手动单项运行与一键流程都通过后端白名单命令执行。
- 一键流程按配置并行执行，默认并发受 UI 选择控制。
- 目标/次数/超时参数当前使用命令默认值（默认 `count=4`、`timeoutSeconds=10`）。

## 项目结构

```text
net-check/
  apps/
    server/                  # Node.js + TypeScript（命令执行、SSE、解析与诊断）
    web/                     # React + TypeScript（界面与交互）
  docs/
    architecture.md          # 架构说明
    contribution.md          # GitHub 贡献指南
  README.md
  AGENTS.md
```

## API（后端）

- `GET /api/health`：健康检查。
- `GET /api/commands`：获取可执行检测项。
- `POST /api/jobs`：创建检测任务。
- `GET /api/jobs/:jobId`：查看任务快照（含 `structured`、`diagnosis`、`evidence`）。
- `GET /api/jobs/:jobId/stream`：SSE 订阅任务事件。

## 安全说明

- 仅执行 `apps/server/src/diagnostics/definitions.ts` 中定义的白名单命令。
- 严禁拼接并执行原始用户输入。
- 对 API 输入进行校验与约束。

## 文档

- 架构文档：`docs/architecture.md`（总体架构、核心模块、数据流、并发模型、告警/根因逻辑、安全边界、扩展建议）
- 开发规范：`docs/development.md`（开发原则、分层职责、代码风格、检测项开发流程、并发规范、测试与验证、提交与评审、安全与隐私）
- 贡献指南：`docs/contribution.md`（Fork/分支/提交流程、开发验证、Commit/PR 规范、检查清单、Issue 报告建议、安全问题处理）

如果你要在 GitHub 上参与开发，请先阅读贡献指南。
