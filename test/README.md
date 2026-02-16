# 测试目录说明

此目录用于存放项目测试代码（当前包含 server/web 的单元测试入口与用例）。

推荐约定：

- 单元测试：当前统一放在 `test/server/` 与 `test/web/`，命名为 `*.test.ts`。
- 集成测试/端到端测试：后续可继续在 `test/` 下按模块扩展（例如 `test/e2e/`）。
- 测试数据与样例输出：可放在 `test/fixtures/`，避免散落在业务代码目录。

执行测试：

- 仓库根目录：`npm run test`
- 或按 workspace：`npm run test -w apps/server` / `npm run test -w apps/web`

说明：

- 为避免 `node --test` 在部分环境下触发 `spawn EPERM`，当前使用 `node:test` 的程序化 `run()` 方式执行测试。
- server 测试编译输出在 `apps/server/dist-test/`，web 测试编译输出在 `test-dist/web/`（均已在 `.gitignore` 忽略）。
