# Net Check

本项目是一个本地部署的网络诊断软件 MVP，界面风格参考 VSCode：

- 左侧控制栏：选择检测命令、配置目标和参数。
- 右侧内容栏：查看实时输出、结构化结果和诊断建议。

## 功能概览

- `Ping 连通性`：检查时延与丢包率。
- `DNS 解析`：检查域名是否可被正确解析。
- `路由追踪`：查看链路跳点与超时情况。
- `HTTP 可用性`：检查 HTTP 状态码与访问可达性。
- 流式日志：命令执行过程实时展示。
- 规则诊断：根据输出自动生成问题建议。

## 项目结构

```text
net-check/
  apps/
    server/   # Node.js 本地诊断后端（命令执行 + 解析 + SSE）
    web/      # React 前端（VSCode 风格双栏布局）
  README.md
  AGENTS.md
```

## 本地运行

```bash
npm install
npm run dev
```

默认端口：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`

如果你只想启动单端：

```bash
npm run dev:server
npm run dev:web
```

## 后续扩展建议

- 增加“尝试修复”指令（如 DNS 刷新、网络栈重置）并加二次确认。
- 引入 SQLite 保存历史任务和问题趋势。
- 增加更多规则引擎能力（网关、端口、TLS、抖动分析）。

