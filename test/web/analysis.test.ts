import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildSummary, hasWarning, type LayerDefinition, type WorkflowItem } from "../../apps/web/src/analysis";

const baseItem = (patch: Partial<WorkflowItem>): WorkflowItem => ({
  commandId: "x",
  commandTitle: "x",
  category: "x",
  status: "completed",
  timedOut: false,
  diagnosis: [],
  evidence: [],
  structured: {},
  ...patch
});

test("hasWarning: nic_link_status adapterCount=0 不应误告警", () => {
  const item = baseItem({
    commandId: "nic_link_status",
    structured: { adapterCount: 0, linkUpCount: 0 }
  });

  assert.equal(hasWarning(item), false);
});

test("hasWarning: nic_link_status adapterCount>0 且 linkUpCount=0 应告警", () => {
  const item = baseItem({
    commandId: "nic_link_status",
    structured: { adapterCount: 2, linkUpCount: 0 }
  });

  assert.equal(hasWarning(item), true);
});

test("hasWarning: proxy_conflict_check 冲突应告警", () => {
  const item = baseItem({
    commandId: "proxy_conflict_check",
    structured: { proxyConflict: true }
  });

  assert.equal(hasWarning(item), true);
});

test("hasWarning: virtual_adapter_check 默认路由虚拟网卡应告警", () => {
  const item = baseItem({
    commandId: "virtual_adapter_check",
    structured: { defaultRouteIsVirtual: true }
  });

  assert.equal(hasWarning(item), true);
});

test("buildSummary: 无根因命中但存在失败项时给出失败提示", () => {
  const layers: LayerDefinition[] = [{ id: "adapter", label: "适配器", commandIds: ["nic_link_status"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "dns_lookup",
      commandTitle: "DNS 解析",
      status: "failed",
      diagnosis: ["命令执行失败"],
      evidence: ["命令执行失败"]
    })
  ];

  const summary = buildSummary(items, layers);
  assert.equal(summary.failed, 1);
  assert.ok(summary.causes.length > 0);
  assert.equal(summary.causes[0].title, "存在失败项");
  assert.equal(summary.causes[0].severity, "high");
});

test("buildSummary: nic 根因优先使用 evidence", () => {
  const layers: LayerDefinition[] = [{ id: "adapter", label: "适配器", commandIds: ["nic_link_status"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "nic_link_status",
      commandTitle: "网卡链路状态",
      evidence: ["证据A"],
      structured: { adapterCount: 1, linkUpCount: 0 }
    })
  ];

  const summary = buildSummary(items, layers);
  assert.ok(summary.causes.length > 0);
  assert.equal(summary.causes[0].title, "没有可用网卡");
  assert.equal(summary.causes[0].evidence, "证据A");
});

test("buildSummary: 代理冲突触发根因", () => {
  const layers: LayerDefinition[] = [{ id: "proxy", label: "代理", commandIds: ["proxy_conflict_check"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "proxy_conflict_check",
      commandTitle: "代理冲突检测",
      structured: { proxyConflict: true },
      evidence: ["系统代理与环境变量代理同时设置。"]
    })
  ];

  const summary = buildSummary(items, layers);
  assert.ok(summary.causes.some((cause) => cause.title === "代理配置冲突"));
});

test("buildSummary: 虚拟网卡接管默认路由触发根因", () => {
  const layers: LayerDefinition[] = [{ id: "adapter", label: "适配器", commandIds: ["virtual_adapter_check"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "virtual_adapter_check",
      commandTitle: "虚拟网卡与路由检测",
      structured: { defaultRouteIsVirtual: true },
      evidence: ["默认路由由虚拟网卡承担。"]
    })
  ];

  const summary = buildSummary(items, layers);
  assert.ok(summary.causes.some((cause) => cause.title === "虚拟网卡接管默认路由"));
});

test("buildSummary: 无根因命中但存在告警时给出告警提示", () => {
  const layers: LayerDefinition[] = [{ id: "adapter", label: "适配器", commandIds: ["any"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "any",
      commandTitle: "任意检测",
      timedOut: true
    })
  ];

  const summary = buildSummary(items, layers);
  assert.equal(summary.warnings, 1);
  assert.ok(summary.causes.length > 0);
  assert.equal(summary.causes[0].title, "存在告警信号");
});

test("buildSummary: 全部正常时给出未检测到问题", () => {
  const layers: LayerDefinition[] = [{ id: "adapter", label: "适配器", commandIds: ["any"] }];
  const items: WorkflowItem[] = [
    baseItem({
      commandId: "any",
      commandTitle: "任意检测"
    })
  ];

  const summary = buildSummary(items, layers);
  assert.equal(summary.failed, 0);
  assert.equal(summary.warnings, 0);
  assert.ok(summary.causes.length > 0);
  assert.equal(summary.causes[0].title, "已完成检测");
});
