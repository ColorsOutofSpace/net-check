export type WorkflowStatus = "pending" | "running" | "completed" | "failed";
export type LayerStatus = "pending" | "running" | "passed" | "warning" | "failed";

export interface WorkflowItem {
  commandId: string;
  commandTitle: string;
  category: string;
  status: WorkflowStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  timedOut: boolean;
  diagnosis: string[];
  evidence: string[];
  structured: Record<string, string | number | boolean>;
  errorMessage?: string;
}

export interface LayerDefinition {
  id: string;
  label: string;
  commandIds: string[];
}

export interface LayerSummary {
  id: string;
  label: string;
  status: LayerStatus;
  note: string;
}

export interface RootCause {
  title: string;
  evidence: string;
  severity: "high" | "medium" | "low";
}

export interface OverviewSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  warnings: number;
  layers: LayerSummary[];
  causes: RootCause[];
}

export const hasWarning = (item: WorkflowItem): boolean => {
  if (item.status !== "completed") {
    return false;
  }
  if (item.timedOut) {
    return true;
  }

  if (item.commandId === "nic_link_status") {
    const adapterCount = item.structured.adapterCount;
    const linkUpCount = item.structured.linkUpCount;
    if (
      typeof adapterCount === "number" &&
      adapterCount > 0 &&
      typeof linkUpCount === "number" &&
      linkUpCount === 0
    ) {
      return true;
    }
    return false;
  }

  if (item.commandId === "proxy_conflict_check") {
    return item.structured.proxyConflict === true;
  }

  if (item.commandId === "virtual_adapter_check") {
    return item.structured.defaultRouteIsVirtual === true;
  }

  const packetLoss = item.structured.packetLossPercent;
  if (typeof packetLoss === "number" && packetLoss > 5) {
    return true;
  }

  if (item.structured.hasDefaultRoute === false || item.structured.resolved === false) {
    return true;
  }

  return item.diagnosis.some((line) => {
    const englishWarning = /\b(failed|failure|timeout|timed\s*out|without|missing|unstable|unreachable)\b/i;
    const chineseWarning = /(失败|超时|缺失|不稳定|不可达|异常|告警)/;
    return englishWarning.test(line) || chineseWarning.test(line);
  });
};

const firstEvidence = (item: WorkflowItem | undefined, fallback: string): string =>
  item?.evidence.find((line) => line.trim().length > 0) ??
  item?.diagnosis.find((line) => line.trim().length > 0) ??
  fallback;

export const buildSummary = (workflowItems: WorkflowItem[], layerDefinitions: LayerDefinition[]): OverviewSummary => {
  const total = workflowItems.length;
  const running = workflowItems.filter((item) => item.status === "running").length;
  const completed = workflowItems.filter((item) => item.status === "completed").length;
  const failed = workflowItems.filter((item) => item.status === "failed").length;
  const warnings = workflowItems.filter((item) => hasWarning(item)).length;

  const byId = new Map(workflowItems.map((item) => [item.commandId, item]));

  const layers: LayerSummary[] = layerDefinitions.map((layer) => {
    const related = layer.commandIds.map((commandId) => byId.get(commandId)).filter((item): item is WorkflowItem => Boolean(item));

    if (related.length === 0) {
      return { id: layer.id, label: layer.label, status: "pending", note: "未选择检测项" };
    }

    if (related.some((item) => item.status === "pending" || item.status === "running")) {
      return { id: layer.id, label: layer.label, status: "running", note: "检测进行中" };
    }

    if (related.some((item) => item.status === "failed" || item.timedOut)) {
      return { id: layer.id, label: layer.label, status: "failed", note: "该层存在失败项" };
    }

    if (related.some((item) => hasWarning(item))) {
      return { id: layer.id, label: layer.label, status: "warning", note: "该层存在告警信号" };
    }

    return { id: layer.id, label: layer.label, status: "passed", note: "健康" };
  });

  const causes: RootCause[] = [];

  const nic = byId.get("nic_link_status");
  if (
    nic &&
    typeof nic.structured.adapterCount === "number" &&
    nic.structured.adapterCount > 0 &&
    typeof nic.structured.linkUpCount === "number" &&
    nic.structured.linkUpCount === 0
  ) {
    causes.push({
      title: "没有可用网卡",
      evidence: firstEvidence(nic, "网卡链路状态显示 UP 网卡数量为 0。"),
      severity: "high"
    });
  }

  const virtualAdapter = byId.get("virtual_adapter_check");
  if (virtualAdapter?.structured.defaultRouteIsVirtual === true) {
    causes.push({
      title: "虚拟网卡接管默认路由",
      evidence: firstEvidence(virtualAdapter, "默认路由由虚拟网卡承担。"),
      severity: "medium"
    });
  }

  const route = byId.get("default_route_check");
  if (route?.structured.hasDefaultRoute === false) {
    causes.push({
      title: "默认路由缺失",
      evidence: firstEvidence(route, "路由表中未发现默认路由。"),
      severity: "high"
    });
  }

  const dns = byId.get("global_dns_probe");
  if (dns?.structured.resolved === false) {
    causes.push({
      title: "DNS 解析失败",
      evidence: firstEvidence(dns, "全局 DNS 探测无法解析 example.com。"),
      severity: "high"
    });
  }

  const proxyConflict = byId.get("proxy_conflict_check");
  if (proxyConflict?.structured.proxyConflict === true) {
    causes.push({
      title: "代理配置冲突",
      evidence: firstEvidence(proxyConflict, "系统代理与环境变量代理同时设置。"),
      severity: "medium"
    });
  }

  const internet = byId.get("global_internet_icmp");
  const packetLoss = internet?.structured.packetLossPercent;
  if (typeof packetLoss === "number" && packetLoss >= 100) {
    causes.push({
      title: "无外网连通性",
      evidence: firstEvidence(internet, "对 1.1.1.1 的全局 ICMP 探测丢包率为 100%。"),
      severity: "high"
    });
  } else if (typeof packetLoss === "number" && packetLoss > 5) {
    causes.push({
      title: "外网链路不稳定",
      evidence: firstEvidence(internet, `全局 ICMP 探测丢包率为 ${packetLoss}%。`),
      severity: "medium"
    });
  }

  if (causes.length === 0 && total > 0 && running === 0) {
    if (failed > 0) {
      causes.push({
        title: "存在失败项",
        evidence: `有 ${failed} 项检测执行失败，请查看检测矩阵与实时输出。`,
        severity: "high"
      });
    } else if (warnings > 0) {
      causes.push({
        title: "存在告警信号",
        evidence: `有 ${warnings} 项检测出现告警，请查看检测矩阵。`,
        severity: "medium"
      });
    } else {
      causes.push({
        title: "已完成检测",
        evidence: "已完成检测，但暂未检测到问题。",
        severity: "low"
      });
    }
  }

  const severityWeight: Record<RootCause["severity"], number> = { high: 3, medium: 2, low: 1 };
  causes.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]);

  return {
    total,
    running,
    completed,
    failed,
    warnings,
    layers,
    causes: causes.slice(0, 3)
  };
};
