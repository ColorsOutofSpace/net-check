type ParseResult = {
  structured: Record<string, string | number | boolean>;
  diagnosis: string[];
  evidence?: string[];
};

const isUnsupportedPlatformOutput = (output: string): boolean =>
  output.includes("UNSUPPORTED_PLATFORM:");

const parseUnsupportedPlatform = (output: string): ParseResult => {
  const featureMatch = output.match(/UNSUPPORTED_PLATFORM:\s*([^\r\n]+)/i);
  const feature = featureMatch?.[1]?.trim() ?? "该检测项";

  return {
    structured: {
      supportedOnCurrentPlatform: false,
      feature
    },
    diagnosis: [`当前操作系统暂不支持 ${feature}。`]
  };
};

const unique = (values: string[]): string[] => [...new Set(values)];

const normalizeParseResult = (result: ParseResult): ParseResult => {
  if (result.evidence && result.evidence.length > 0) {
    return result;
  }

  const evidence: string[] = [];
  result.diagnosis.slice(0, 3).forEach((item) => evidence.push(item));

  Object.entries(result.structured)
    .slice(0, 4)
    .forEach(([key, value]) => evidence.push(`${key}=${String(value)}`));

  return {
    ...result,
    evidence
  };
};

const parsePing = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const windowsLossMatch = output.match(/\(([\d.]+)%\s*(?:loss|丢失)\)/i);
  const windowsLossInlineMatch = output.match(/(?:loss|丢失)\s*[=:：]?\s*([\d.]+)%/i);
  const unixLossMatch = output.match(/([\d.]+)%\s*packet\s*loss/i);
  const lossRaw = windowsLossMatch?.[1] ?? windowsLossInlineMatch?.[1] ?? unixLossMatch?.[1];
  const packetLoss = lossRaw ? Number(lossRaw) : null;

  const windowsAvgMatch = output.match(/(?:Average|平均)\s*[=:：]\s*(\d+)\s*ms/i);
  const unixAvgMatch = output.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+\s*ms/i);
  const avgRaw = windowsAvgMatch?.[1] ?? unixAvgMatch?.[1];
  const avgLatency = avgRaw ? Number(avgRaw) : null;

  if (packetLoss !== null) {
    structured.packetLossPercent = packetLoss;
  }
  if (avgLatency !== null) {
    structured.avgLatencyMs = avgLatency;
  }

  if (packetLoss === null) {
    diagnosis.push("无法解析丢包率，目标可能不可达。");
  } else if (packetLoss >= 100) {
    diagnosis.push("丢包率为 100%，请检查网关、路由、防火墙或上游链路。");
  } else if (packetLoss > 5) {
    diagnosis.push("丢包率高于 5%，链路质量或上游路径可能不稳定。");
  } else {
    diagnosis.push("丢包率在可接受范围内。");
  }

  if (avgLatency !== null) {
    if (avgLatency > 200) {
      diagnosis.push("平均时延较高（>200ms）。");
    } else {
      diagnosis.push("平均时延处于正常范围。");
    }
  }

  return { structured, diagnosis };
};

const parseDnsLookup = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const failure = /(non-existent domain|can't find|timed out|server failed|NXDOMAIN|SERVFAIL)/i.test(output);
  const ipv4Addresses = unique(output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []);
  const ipv6Addresses = unique(output.match(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi) ?? []);

  structured.resolved = !failure;
  structured.ipv4Count = ipv4Addresses.length;
  structured.ipv6Count = ipv6Addresses.length;

  if (failure) {
    diagnosis.push("DNS 解析失败，请检查本机解析器配置或上游 DNS 连通性。");
  } else if (ipv4Addresses.length === 0 && ipv6Addresses.length === 0) {
    diagnosis.push("DNS 查询已完成，但未解析到 A/AAAA 记录。");
  } else {
    diagnosis.push("DNS 解析成功。");
  }

  return { structured, diagnosis };
};

const parseTraceRoute = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const lines = output.split(/\r?\n/);
  const hopLines = lines.filter((line) => /^\s*\d+\s+/.test(line));
  const starLines = hopLines.filter((line) => line.includes("*"));

  structured.hopCount = hopLines.length;
  structured.timeoutHopCount = starLines.length;

  if (hopLines.length === 0) {
    diagnosis.push("未解析到有效跳点信息。");
  } else if (starLines.length > hopLines.length / 2) {
    diagnosis.push("大量跳点超时，可能存在中间设备过滤或路径不稳定。");
  } else {
    diagnosis.push("路由路径可追踪，超时跳点较少。");
  }

  return { structured, diagnosis };
};

const parseDefaultRouteCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const lines = output.split(/\r?\n/);
  const routeLines = lines.filter((line) => line.trim().length > 0);
  const windowsDefault = lines.filter((line) => /\b0\.0\.0\.0\s+0\.0\.0\.0\b/.test(line));
  const unixDefault = lines.filter((line) => /\bdefault\b/i.test(line));
  const defaultRouteCount = windowsDefault.length + unixDefault.length;

  structured.routeLineCount = routeLines.length;
  structured.defaultRouteCount = defaultRouteCount;
  structured.hasDefaultRoute = defaultRouteCount > 0;

  if (defaultRouteCount > 0) {
    diagnosis.push("默认路由存在。");
  } else {
    diagnosis.push("未检测到默认路由，外网连通可能失败。");
  }

  return { structured, diagnosis };
};

const parseGatewayReachability = (output: string): ParseResult => {
  const base = parsePing(output);
  const structured: Record<string, string | number | boolean> = { ...base.structured };
  const diagnosis: string[] = [];

  const gatewayMatch = output.match(/GATEWAY:([^\r\n]+)/i);
  const gatewayRaw = gatewayMatch?.[1]?.trim();
  const gatewayFound = Boolean(gatewayRaw && gatewayRaw !== "NOT_FOUND");

  structured.gatewayFound = gatewayFound;
  if (gatewayFound && gatewayRaw) {
    structured.gateway = gatewayRaw;
  }

  if (!gatewayFound) {
    diagnosis.push("未检测到默认网关。");
    return { structured, diagnosis };
  }

  const loss = structured.packetLossPercent;
  if (typeof loss === "number") {
    if (loss >= 100) {
      diagnosis.push("默认网关不可达，请检查本机到交换机/网关的链路。");
    } else if (loss > 0) {
      diagnosis.push("默认网关存在丢包，二层链路或网关可能不稳定。");
    } else {
      diagnosis.push("默认网关可达。");
    }
  } else {
    diagnosis.push("无法解析默认网关的丢包率。");
  }

  if (typeof structured.avgLatencyMs === "number") {
    diagnosis.push(`默认网关平均时延为 ${structured.avgLatencyMs} ms。`);
  }

  return { structured, diagnosis };
};

const parseArpNeighborCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const gatewayMatch = output.match(/GATEWAY:([^\r\n]+)/i);
  const gatewayRaw = gatewayMatch?.[1]?.trim();
  const gatewayFound = Boolean(gatewayRaw && gatewayRaw !== "NOT_FOUND");
  structured.gatewayFound = gatewayFound;
  if (gatewayFound && gatewayRaw) {
    structured.gateway = gatewayRaw;
  }

  const lines = output.split(/\r?\n/);
  const neighborLines = lines.filter(
    (line) => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(line) && !/^GATEWAY:/i.test(line)
  );
  const reachableCount = neighborLines.filter((line) => /\bReachable\b/i.test(line)).length;
  const staleCount = neighborLines.filter((line) => /\bStale\b/i.test(line)).length;
  const incompleteCount = neighborLines.filter((line) => /\bIncomplete\b/i.test(line)).length;

  structured.neighborCount = neighborLines.length;
  structured.reachableCount = reachableCount;
  structured.staleCount = staleCount;
  structured.incompleteCount = incompleteCount;

  let gatewayState: string | undefined;
  if (gatewayFound && gatewayRaw) {
    const gatewayLine = neighborLines.find((line) => line.includes(gatewayRaw));
    if (gatewayLine) {
      gatewayState =
        gatewayLine.match(/\b(Reachable|Stale|Delay|Probe|Incomplete|Unreachable|Permanent)\b/i)?.[1] ?? undefined;
      if (gatewayState) {
        structured.gatewayState = gatewayState;
      }
    }
  }

  if (!gatewayFound) {
    diagnosis.push("未检测到默认网关。");
  } else if (!gatewayState) {
    diagnosis.push("未能在邻居表中找到默认网关记录。");
  } else if (/Reachable|Stale|Permanent/i.test(gatewayState)) {
    diagnosis.push("默认网关 ARP 已解析。");
  } else if (/Incomplete|Unreachable/i.test(gatewayState)) {
    diagnosis.push("默认网关 ARP 未解析，请检查二层连通性。");
  } else {
    diagnosis.push("已获取默认网关邻居状态，请结合输出确认。");
  }

  if (neighborLines.length === 0) {
    diagnosis.push("邻居表未解析到任何 IPv4 条目。");
  }

  return { structured, diagnosis };
};

const parseHttp = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const statusMatch = output.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;

  if (statusCode !== null) {
    structured.statusCode = statusCode;
  }

  if (statusCode === null) {
    diagnosis.push("未解析到 HTTP 状态码，请检查 URL、TLS 与连通性。");
  } else if (statusCode >= 500) {
    diagnosis.push("服务返回 5xx，目标可达但后端异常。");
  } else if (statusCode >= 400) {
    diagnosis.push("目标返回 4xx，连通性通常正常，请检查请求是否有效。");
  } else {
    diagnosis.push("HTTP 目标可达且返回非错误状态码。");
  }

  return { structured, diagnosis };
};

const parseGlobalInternetIcmp = (output: string): ParseResult => {
  const base = parsePing(output);
  const diagnosis = [...base.diagnosis];

  if (base.structured.packetLossPercent === 0) {
    diagnosis.push("全局 ICMP 探测正常。");
  } else if (typeof base.structured.packetLossPercent === "number") {
    diagnosis.push("全局 ICMP 探测存在丢包，外网路径可能不稳定。");
  }

  return {
    structured: {
      ...base.structured,
      probeTarget: "1.1.1.1"
    },
    diagnosis
  };
};

const parseGlobalDnsProbe = (output: string): ParseResult => {
  const base = parseDnsLookup(output);
  const diagnosis = [...base.diagnosis];

  if (base.structured.resolved === true) {
    diagnosis.push("全局 DNS 探测可解析 example.com。");
  } else {
    diagnosis.push("全局 DNS 探测无法解析 example.com。");
  }

  return {
    structured: {
      ...base.structured,
      probeDomain: "example.com"
    },
    diagnosis
  };
};

const parseNicLinkStatus = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const lines = output.split(/\r?\n/);
  const statusLines = lines.filter((line) => /\b(UP|DOWN|Up|Down|Disconnected|Disabled)\b/.test(line));
  const upCount = statusLines.filter((line) => /\b(UP|Up)\b/.test(line)).length;
  const downCount = statusLines.filter((line) => /\b(DOWN|Down|Disconnected|Disabled)\b/.test(line)).length;

  structured.adapterCount = statusLines.length;
  structured.linkUpCount = upCount;
  structured.linkDownOrDisabledCount = downCount;

  if (statusLines.length === 0) {
    diagnosis.push("无法解析网卡链路状态。");
  } else if (upCount === 0) {
    diagnosis.push("未发现处于 UP 状态的网卡。");
  } else {
    diagnosis.push(`当前有 ${upCount} 个网卡处于 UP 状态。`);
  }

  if (downCount > 0) {
    diagnosis.push(`有 ${downCount} 个网卡处于未连接或已禁用状态（可能为虚拟网卡）。`);
  }

  return { structured, diagnosis };
};

const parseNicIpConfig = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const ipv4Addresses = unique(
    (output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter(
      (ip) => ip !== "0.0.0.0" && !ip.startsWith("255.")
    )
  );
  const hasDefaultGateway =
    /Default Gateway|default via|Gateway/i.test(output) && !/Default Gateway[.\s:]*$/im.test(output);

  structured.ipv4AddressCount = ipv4Addresses.length;
  structured.hasDefaultGateway = hasDefaultGateway;

  if (ipv4Addresses.length === 0) {
    diagnosis.push("未从网卡配置中解析到 IPv4 地址。");
  } else {
    diagnosis.push(`在网卡配置中检测到 ${ipv4Addresses.length} 个 IPv4 地址。`);
  }

  if (!hasDefaultGateway) {
    diagnosis.push("未明确检测到默认网关。");
  } else {
    diagnosis.push("已检测到默认网关配置。");
  }

  return { structured, diagnosis };
};

const parseDhcpStatus = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const enabledMatches = output.match(/\b(Enabled|Yes)\b/gi) ?? [];
  const disabledMatches = output.match(/\b(Disabled|No)\b/gi) ?? [];
  const hasDhcpKeyword = /DHCP|Dhcp/i.test(output);

  const dhcpEnabledCount = enabledMatches.length;
  const dhcpDisabledCount = disabledMatches.length;

  structured.detectedDhcpFields = hasDhcpKeyword;
  structured.dhcpEnabledCount = dhcpEnabledCount;
  structured.dhcpDisabledCount = dhcpDisabledCount;

  if (!hasDhcpKeyword) {
    diagnosis.push("命令输出中未解析到 DHCP 字段。");
  } else if (dhcpEnabledCount > 0) {
    diagnosis.push("至少有一个网卡在使用 DHCP。");
  } else {
    diagnosis.push("未明确发现启用 DHCP 的网卡。");
  }

  if (dhcpDisabledCount > 0) {
    diagnosis.push("部分网卡可能使用静态配置。");
  }

  return { structured, diagnosis };
};

const parseDnsServerConfig = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const ipv4Servers = unique(output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []);
  const ipv6Servers = unique(output.match(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi) ?? []);

  structured.ipv4DnsServerCount = ipv4Servers.length;
  structured.ipv6DnsServerCount = ipv6Servers.length;
  structured.hasLoopbackDns = ipv4Servers.includes("127.0.0.1") || ipv6Servers.includes("::1");

  if (ipv4Servers.length === 0 && ipv6Servers.length === 0) {
    diagnosis.push("未从本机配置中解析到 DNS 服务器地址。");
  } else {
    diagnosis.push(
      `检测到 ${ipv4Servers.length} 个 IPv4 与 ${ipv6Servers.length} 个 IPv6 的 DNS 服务器地址。`
    );
  }

  if (structured.hasLoopbackDns) {
    diagnosis.push("检测到回环 DNS，请确认本机解析服务是否正常。");
  }

  return { structured, diagnosis };
};

const parseDnsServerProbe = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.some((line) => /^DNS_SERVER:NONE$/i.test(line))) {
    structured.dnsServerCount = 0;
    structured.dnsServerSuccessCount = 0;
    structured.dnsServerFailCount = 0;
    diagnosis.push("未检测到 DNS 服务器配置。");
    return { structured, diagnosis };
  }

  const results = lines
    .map((line) => line.match(/^DNS_SERVER:([^\s]+)\s+(OK|FAIL)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match));

  const total = results.length;
  const successCount = results.filter((match) => match[2].toUpperCase() === "OK").length;
  const failCount = total - successCount;

  structured.dnsServerCount = total;
  structured.dnsServerSuccessCount = successCount;
  structured.dnsServerFailCount = failCount;

  if (total === 0) {
    diagnosis.push("未解析到 DNS 服务器探测结果。");
  } else if (failCount > 0) {
    diagnosis.push("部分 DNS 服务器解析失败，请检查上游 DNS 或网络连通性。");
  } else {
    diagnosis.push("DNS 服务器解析可用。");
  }

  return { structured, diagnosis };
};

const parseHostsFileCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const entries = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const hosts = entries
    .flatMap((line) => line.split(/\s+/).slice(1))
    .map((host) => host.toLowerCase())
    .filter((host) => host.length > 0);
  const uniqueHosts = unique(hosts);
  const duplicateHostCount = hosts.length - uniqueHosts.length;
  const localhostMapped = hosts.includes("localhost");

  structured.entryCount = entries.length;
  structured.localhostMapped = localhostMapped;
  structured.duplicateHostCount = duplicateHostCount;

  if (entries.length === 0) {
    diagnosis.push("Hosts 文件中没有生效的映射项。");
  } else {
    diagnosis.push(`Hosts 文件包含 ${entries.length} 行生效映射。`);
  }

  if (!localhostMapped) {
    diagnosis.push("Hosts 文件中未检测到 localhost 映射。");
  }

  if (duplicateHostCount > 0) {
    diagnosis.push("检测到重复主机映射，请确认覆盖顺序和意图。");
  }

  if (entries.length > 25) {
    diagnosis.push("Hosts 文件覆盖项较多，建议清理陈旧条目。");
  }

  return { structured, diagnosis };
};

const parseLspCatalogCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const catalogEntriesMatch = output.match(/Catalog Entries\s*:\s*(\d+)/i);
  const catalogEntries = catalogEntriesMatch ? Number(catalogEntriesMatch[1]) : null;
  const layeredProviderCount = (output.match(/Layered\s+Chain\s+Entry/gi) ?? []).length;

  if (catalogEntries !== null) {
    structured.catalogEntries = catalogEntries;
  }
  structured.layeredProviderCount = layeredProviderCount;

  if (catalogEntries === null && layeredProviderCount === 0) {
    diagnosis.push("未清晰解析到 Winsock 目录详情。");
  } else {
    diagnosis.push("已采集 Winsock 目录输出。");
  }

  if (layeredProviderCount > 0) {
    diagnosis.push(`检测到 ${layeredProviderCount} 个分层链路条目。`);
  }

  return { structured, diagnosis };
};

const parseIeProxyCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  // Use whitespace patterns that do not cross line boundaries.
  const proxyEnableMatch = output.match(/ProxyEnable[^\S\r\n]*:[^\S\r\n]*(\d+)/i);
  const proxyServerMatch = output.match(/ProxyServer[^\S\r\n]*:[^\S\r\n]*([^\r\n]*)/i);
  const autoConfigUrlMatch = output.match(/AutoConfigURL[^\S\r\n]*:[^\S\r\n]*([^\r\n]*)/i);
  const autoDetectMatch = output.match(/AutoDetect[^\S\r\n]*:[^\S\r\n]*(\d+)/i);

  const proxyEnabled = proxyEnableMatch ? Number(proxyEnableMatch[1]) === 1 : false;
  const proxyServer = (proxyServerMatch?.[1] ?? "").trim();
  const autoConfigUrl = (autoConfigUrlMatch?.[1] ?? "").trim();
  const autoDetectEnabled = autoDetectMatch ? Number(autoDetectMatch[1]) === 1 : false;

  structured.proxyEnabled = proxyEnabled;
  structured.autoDetectEnabled = autoDetectEnabled;
  structured.hasProxyServer = proxyServer.length > 0;
  structured.hasPacUrl = autoConfigUrl.length > 0;

  if (proxyEnabled && proxyServer.length > 0) {
    diagnosis.push("系统手动代理已启用。");
  } else if (proxyEnabled && autoConfigUrl.length > 0) {
    diagnosis.push("代理已启用，且已配置 PAC URL。");
  } else if (proxyEnabled) {
    diagnosis.push("代理看似已启用，但缺少代理地址详情。");
  } else {
    diagnosis.push("系统手动代理未启用。");
  }

  if (autoDetectEnabled) {
    diagnosis.push("已启用 WPAD 自动发现。");
  }

  return { structured, diagnosis };
};

const parseProxyConflictCheck = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const sysEnabledMatch = output.match(/SYS_PROXY_ENABLED:([^\r\n]+)/i);
  const sysServerMatch = output.match(/SYS_PROXY_SERVER:([^\r\n]*)/i);
  const sysPacMatch = output.match(/SYS_PAC:([^\r\n]*)/i);
  const envProxyMatch = output.match(/ENV_PROXY:([^\r\n]*)/i);
  const envNoProxyMatch = output.match(/ENV_NO_PROXY:([^\r\n]*)/i);

  const sysEnabled = sysEnabledMatch?.[1]?.trim().toLowerCase() === "true";
  const sysServerRaw = (sysServerMatch?.[1] ?? "").trim();
  const sysPacRaw = (sysPacMatch?.[1] ?? "").trim();
  const envProxyRaw = (envProxyMatch?.[1] ?? "").trim();
  const envNoProxyRaw = (envNoProxyMatch?.[1] ?? "").trim();

  const systemProxyServer = sysServerRaw ? maskProxyValue(sysServerRaw) : "";
  const envProxy = envProxyRaw ? maskProxyValue(envProxyRaw) : "";

  const hasSystemProxy = sysEnabled && systemProxyServer.length > 0;
  const hasEnvProxy = envProxy.length > 0;
  const hasPacUrl = sysPacRaw.length > 0;
  const hasNoProxy = envNoProxyRaw.length > 0;
  const proxyConflict = hasSystemProxy && hasEnvProxy;

  structured.systemProxyEnabled = sysEnabled;
  structured.systemProxyServer = systemProxyServer;
  structured.systemPacUrl = sysPacRaw;
  structured.envProxy = envProxy;
  structured.envNoProxy = envNoProxyRaw;
  structured.hasSystemProxy = hasSystemProxy;
  structured.hasEnvProxy = hasEnvProxy;
  structured.hasPacUrl = hasPacUrl;
  structured.hasNoProxy = hasNoProxy;
  structured.proxyConflict = proxyConflict;

  if (proxyConflict) {
    diagnosis.push("系统代理与环境变量代理同时设置，可能存在冲突。");
  } else if (hasSystemProxy) {
    diagnosis.push("系统代理已配置。");
  } else if (hasEnvProxy) {
    diagnosis.push("检测到环境变量代理。");
  } else {
    diagnosis.push("未检测到代理配置。");
  }

  if (hasEnvProxy && !hasNoProxy) {
    diagnosis.push("环境变量代理缺少 NO_PROXY，本地/内网请求可能受影响。");
  }

  if (hasPacUrl) {
    diagnosis.push("检测到 PAC 配置，请确认 PAC 可达性。");
  }

  return { structured, diagnosis };
};

const maskProxyValue = (value: string): string =>
  value.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, "//$1:***@");

const parseNetworkEnvVars = (output: string): ParseResult => {
  const structured: Record<string, string | number | boolean> = {};
  const diagnosis: string[] = [];

  const proxyVarNames = new Set([
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy"
  ]);

  const values = new Map<string, string>();

  output.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const eqMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (eqMatch) {
      const name = eqMatch[1];
      const value = eqMatch[2];
      if (proxyVarNames.has(name)) {
        values.set(name, value.trim());
      }
      return;
    }

    const tableMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
    if (!tableMatch) {
      return;
    }

    const name = tableMatch[1];
    const value = tableMatch[2];
    if (proxyVarNames.has(name)) {
      values.set(name, value.trim());
    }
  });

  structured.proxyEnvVarCount = values.size;

  values.forEach((value, key) => {
    structured[`env_${key}`] = maskProxyValue(value);
  });

  if (values.size === 0) {
    diagnosis.push("未检测到代理相关环境变量。");
  } else {
    diagnosis.push(`检测到 ${values.size} 个代理相关环境变量。`);
  }

  const hasProxy = values.has("HTTP_PROXY") || values.has("HTTPS_PROXY") || values.has("http_proxy");
  const hasNoProxy = values.has("NO_PROXY") || values.has("no_proxy");
  if (hasProxy && !hasNoProxy) {
    diagnosis.push("检测到代理配置但缺少 NO_PROXY，本地/内网请求可能受影响。");
  }

  return { structured, diagnosis };
};

export const parseCommandOutput = (commandId: string, output: string, exitCode: number | null): ParseResult => {
  if (isUnsupportedPlatformOutput(output)) {
    return normalizeParseResult(parseUnsupportedPlatform(output));
  }

  let parsed: ParseResult;

  if (commandId === "ping_target") {
    parsed = parsePing(output);
  } else if (commandId === "dns_lookup") {
    parsed = parseDnsLookup(output);
  } else if (commandId === "trace_route") {
    parsed = parseTraceRoute(output);
  } else if (commandId === "default_route_check") {
    parsed = parseDefaultRouteCheck(output);
  } else if (commandId === "gateway_reachability") {
    parsed = parseGatewayReachability(output);
  } else if (commandId === "arp_neighbor_check") {
    parsed = parseArpNeighborCheck(output);
  } else if (commandId === "global_internet_icmp") {
    parsed = parseGlobalInternetIcmp(output);
  } else if (commandId === "global_dns_probe") {
    parsed = parseGlobalDnsProbe(output);
  } else if (commandId === "http_head") {
    parsed = parseHttp(output);
  } else if (commandId === "nic_link_status") {
    parsed = parseNicLinkStatus(output);
  } else if (commandId === "nic_ip_config") {
    parsed = parseNicIpConfig(output);
  } else if (commandId === "dhcp_status") {
    parsed = parseDhcpStatus(output);
  } else if (commandId === "dns_server_config") {
    parsed = parseDnsServerConfig(output);
  } else if (commandId === "dns_server_probe") {
    parsed = parseDnsServerProbe(output);
  } else if (commandId === "hosts_file_check") {
    parsed = parseHostsFileCheck(output);
  } else if (commandId === "lsp_catalog_check") {
    parsed = parseLspCatalogCheck(output);
  } else if (commandId === "ie_proxy_check") {
    parsed = parseIeProxyCheck(output);
  } else if (commandId === "proxy_conflict_check") {
    parsed = parseProxyConflictCheck(output);
  } else if (commandId === "network_env_vars") {
    parsed = parseNetworkEnvVars(output);
  } else {
    parsed = {
      structured: { exitCode: exitCode ?? -1 },
      diagnosis: ["命令执行完成，当前命令暂无结构化解析规则。"]
    };
  }

  return normalizeParseResult(parsed);
};

