import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommandOutput } from "../../apps/server/src/diagnostics/parsers";

const ensureEvidence = (value: unknown): string[] => {
  assert.ok(Array.isArray(value), "evidence 应为数组");
  assert.ok(value.length > 0, "evidence 不应为空");
  value.forEach((item) => assert.equal(typeof item, "string"));
  return value as string[];
};

test("parseCommandOutput: ping_target 0% 丢包与平均时延", () => {
  const output = [
    "Pinging 1.1.1.1 with 32 bytes of data:",
    "Reply from 1.1.1.1: bytes=32 time=20ms TTL=56",
    "",
    "Ping statistics for 1.1.1.1:",
    "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
    "Approximate round trip times in milli-seconds:",
    "    Minimum = 18ms, Maximum = 22ms, Average = 20ms",
    ""
  ].join("\n");

  const result = parseCommandOutput("ping_target", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.packetLossPercent, 0);
  assert.equal(result.structured.avgLatencyMs, 20);
  assert.ok(result.diagnosis.join("；").includes("丢包率在可接受范围内"));
  const evidence = ensureEvidence(result.evidence);
  assert.ok(evidence.join("；").includes("丢包率在可接受范围内"));
});

test("parseCommandOutput: ping_target 100% 丢包", () => {
  const output = [
    "Ping statistics for 8.8.8.8:",
    "    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),",
    ""
  ].join("\n");

  const result = parseCommandOutput("ping_target", output, 1) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.packetLossPercent, 100);
  assert.ok(result.diagnosis.join("；").includes("丢包率为 100%"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: ping_target 无法解析丢包率", () => {
  const output = "Ping request could not find host invalid.example. Please check the name and try again.\n";
  const result = parseCommandOutput("ping_target", output, 1) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.ok(result.diagnosis.join("；").includes("无法解析丢包率"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: global_internet_icmp 会补充 probeTarget", () => {
  const output = [
    "Ping statistics for 1.1.1.1:",
    "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
    ""
  ].join("\n");
  const result = parseCommandOutput("global_internet_icmp", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.probeTarget, "1.1.1.1");
  assert.equal(result.structured.packetLossPercent, 0);
  assert.ok(result.diagnosis.join("；").includes("全局 ICMP 探测正常"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: dns_lookup 解析成功", () => {
  const output = [
    "Server:  resolver1.opendns.com",
    "Address:  208.67.222.222",
    "",
    "Non-authoritative answer:",
    "Name:    openai.com",
    "Addresses:  104.18.12.123",
    "          104.18.13.123",
    ""
  ].join("\n");
  const result = parseCommandOutput("dns_lookup", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.resolved, true);
  assert.ok(typeof result.structured.ipv4Count === "number");
  assert.ok((result.structured.ipv4Count as number) >= 1);
  assert.ok(result.diagnosis.join("；").includes("DNS 解析成功"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: dns_lookup 解析失败", () => {
  const output = "*** Can't find openai.com: Non-existent domain\n";
  const result = parseCommandOutput("dns_lookup", output, 1) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.resolved, false);
  assert.ok(result.diagnosis.join("；").includes("DNS 解析失败"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: global_dns_probe 会补充 probeDomain", () => {
  const output = [
    "Name:    example.com",
    "Address: 93.184.216.34",
    ""
  ].join("\n");

  const result = parseCommandOutput("global_dns_probe", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.probeDomain, "example.com");
  assert.equal(result.structured.resolved, true);
  assert.ok(result.diagnosis.join("；").includes("全局 DNS 探测可解析 example.com"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: default_route_check 可识别默认路由", () => {
  const output = [
    "IPv4 Route Table",
    "=========================================================================",
    "Active Routes:",
    "Network Destination        Netmask          Gateway       Interface  Metric",
    "          0.0.0.0          0.0.0.0      192.168.1.1   192.168.1.10     25",
    ""
  ].join("\n");
  const result = parseCommandOutput("default_route_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.hasDefaultRoute, true);
  assert.ok(result.diagnosis.join("；").includes("默认路由存在"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: gateway_reachability 可解析网关与连通性", () => {
  const output = [
    "GATEWAY:192.168.1.1",
    "Ping statistics for 192.168.1.1:",
    "    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),",
    ""
  ].join("\n");

  const result = parseCommandOutput("gateway_reachability", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.gatewayFound, true);
  assert.equal(result.structured.gateway, "192.168.1.1");
  assert.equal(result.structured.packetLossPercent, 0);
  assert.ok(result.diagnosis.join("；").includes("默认网关可达"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: arp_neighbor_check 可识别网关邻居状态", () => {
  const output = [
    "GATEWAY:192.168.1.1",
    "IPAddress      LinkLayerAddress      State       InterfaceAlias",
    "---------      ----------------      -----       --------------",
    "192.168.1.1    00-11-22-33-44-55      Reachable   Ethernet",
    "192.168.1.100  66-77-88-99-AA-BB      Stale       Ethernet",
    ""
  ].join("\n");

  const result = parseCommandOutput("arp_neighbor_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.gatewayFound, true);
  assert.equal(result.structured.gateway, "192.168.1.1");
  assert.equal(result.structured.gatewayState, "Reachable");
  assert.ok((result.structured.neighborCount as number) >= 2);
  assert.ok(result.diagnosis.join("；").includes("ARP 已解析"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: trace_route 可统计 hop/timeout", () => {
  const output = [
    "Tracing route to 1.1.1.1 over a maximum of 30 hops",
    "",
    "  1     1 ms     1 ms     1 ms  192.168.1.1",
    "  2     *        *        *     Request timed out.",
    "  3    10 ms    11 ms    10 ms  10.0.0.1",
    ""
  ].join("\n");

  const result = parseCommandOutput("trace_route", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.hopCount, 3);
  assert.equal(result.structured.timeoutHopCount, 1);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: http_head 可解析状态码", () => {
  const output = [
    "HTTP/2 204",
    "date: Mon, 16 Feb 2026 00:00:00 GMT",
    ""
  ].join("\n");

  const result = parseCommandOutput("http_head", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.statusCode, 204);
  assert.ok(result.diagnosis.join("；").includes("HTTP 目标可达"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: nic_link_status 统计 Up/Down", () => {
  const output = [
    "Name                      Status       LinkSpeed",
    "----                      ------       ---------",
    "Ethernet0                 Up           1 Gbps",
    "Wi-Fi                     Disconnected 0 bps",
    "vEthernet (Default Switch) Up          10 Gbps",
    ""
  ].join("\n");

  const result = parseCommandOutput("nic_link_status", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.linkUpCount, 2);
  assert.equal(result.structured.linkDownOrDisabledCount, 1);
  assert.ok(result.diagnosis.length >= 1);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: virtual_adapter_check 识别虚拟网卡与默认路由", () => {
  const output = JSON.stringify({
    Adapters: [
      { Name: "Ethernet", InterfaceDescription: "Intel(R) Ethernet", Status: "Up", InterfaceIndex: 12 },
      {
        Name: "vEthernet (Default Switch)",
        InterfaceDescription: "Hyper-V Virtual Ethernet Adapter",
        Status: "Up",
        InterfaceIndex: 5
      }
    ],
    DefaultRoutes: [{ InterfaceIndex: 5, InterfaceAlias: "vEthernet", NextHop: "192.168.1.1" }]
  });

  const result = parseCommandOutput("virtual_adapter_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.virtualAdapterCount, 1);
  assert.equal(result.structured.physicalAdapterCount, 1);
  assert.equal(result.structured.defaultRouteIsVirtual, true);
  assert.ok(result.diagnosis.join("；").includes("虚拟网卡"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: virtual_adapter_check supports JSON prefix", () => {
  const json = JSON.stringify({
    Adapters: [
      { Name: "Ethernet", InterfaceDescription: "Intel(R) Ethernet", Status: "Up", InterfaceIndex: 12 },
      {
        Name: "vEthernet (Default Switch)",
        InterfaceDescription: "Hyper-V Virtual Ethernet Adapter",
        Status: "Up",
        InterfaceIndex: 5
      }
    ],
    DefaultRoutes: [{ InterfaceIndex: 5, InterfaceAlias: "vEthernet", NextHop: "192.168.1.1" }]
  });

  const output = ["Total adapters: 2", `JSON:${json}`].join("\n");

  const result = parseCommandOutput("virtual_adapter_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.virtualAdapterCount, 1);
  assert.equal(result.structured.physicalAdapterCount, 1);
  assert.equal(result.structured.defaultRouteIsVirtual, true);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: nic_ip_config 可解析 IPv4 与默认网关", () => {
  const output = [
    "Windows IP Configuration",
    "",
    "   IPv4 Address. . . . . . . . . . . : 192.168.1.10",
    "   Subnet Mask . . . . . . . . . . . : 255.255.255.0",
    "   Default Gateway . . . . . . . . . : 192.168.1.1",
    ""
  ].join("\n");

  const result = parseCommandOutput("nic_ip_config", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.ok(typeof result.structured.ipv4AddressCount === "number");
  assert.ok((result.structured.ipv4AddressCount as number) >= 1);
  assert.equal(result.structured.hasDefaultGateway, true);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: dhcp_status 可统计 DHCP Enabled/Disabled", () => {
  const output = [
    "InterfaceAlias Dhcp     ConnectionState",
    "-------------- ----     ---------------",
    "Ethernet       Enabled  Connected",
    "Wi-Fi          Disabled Disconnected",
    ""
  ].join("\n");

  const result = parseCommandOutput("dhcp_status", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.detectedDhcpFields, true);
  assert.ok((result.structured.dhcpEnabledCount as number) >= 1);
  assert.ok((result.structured.dhcpDisabledCount as number) >= 1);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: dns_server_config 可识别回环 DNS", () => {
  const output = [
    "InterfaceAlias : Ethernet",
    "ServerAddresses : {127.0.0.1, 8.8.8.8}",
    ""
  ].join("\n");

  const result = parseCommandOutput("dns_server_config", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.ok((result.structured.ipv4DnsServerCount as number) >= 1);
  assert.equal(result.structured.hasLoopbackDns, true);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: dns_server_probe 统计成功与失败", () => {
  const output = [
    "DNS_SERVER:8.8.8.8 OK",
    "DNS_SERVER:1.1.1.1 FAIL",
    ""
  ].join("\n");

  const result = parseCommandOutput("dns_server_probe", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.dnsServerCount, 2);
  assert.equal(result.structured.dnsServerSuccessCount, 1);
  assert.equal(result.structured.dnsServerFailCount, 1);
  assert.ok(result.diagnosis.join("；").includes("部分 DNS 服务器解析失败"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: hosts_file_check 可统计映射行/重复/localhost", () => {
  const output = [
    "# comment",
    "",
    "127.0.0.1 localhost",
    "10.0.0.1 internal.local",
    "10.0.0.2 internal.local",
    ""
  ].join("\n");

  const result = parseCommandOutput("hosts_file_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.entryCount, 3);
  assert.equal(result.structured.localhostMapped, true);
  assert.equal(result.structured.duplicateHostCount, 1);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: lsp_catalog_check 可统计分层条目数量", () => {
  const output = [
    "Catalog Entries : 10",
    "",
    "Layered Chain Entry",
    "Layered Chain Entry",
    ""
  ].join("\n");

  const result = parseCommandOutput("lsp_catalog_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.catalogEntries, 10);
  assert.equal(result.structured.layeredProviderCount, 2);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: ie_proxy_check 可解析 ProxyEnable/ProxyServer", () => {
  const output = [
    "ProxyEnable : 1",
    "ProxyServer : 127.0.0.1:7890",
    "AutoConfigURL :",
    "AutoDetect : 0",
    ""
  ].join("\n");

  const result = parseCommandOutput("ie_proxy_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.proxyEnabled, true);
  assert.equal(result.structured.hasProxyServer, true);
  assert.equal(result.structured.hasPacUrl, false);
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: winhttp_proxy_check 可解析代理与直连", () => {
  const output = [
    "Current WinHTTP proxy settings:",
    "",
    "    Proxy Server(s) :  http=proxy.local:8080;https=proxy.local:8080",
    "    Bypass List     :  *.local;127.0.0.1",
    ""
  ].join("\n");

  const result = parseCommandOutput("winhttp_proxy_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.winhttpProxyEnabled, true);
  assert.ok(String(result.structured.winhttpProxyServer ?? "").includes("proxy.local"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: proxy_conflict_check 识别冲突与 NO_PROXY", () => {
  const output = [
    "SYS_PROXY_ENABLED:True",
    "SYS_PROXY_SERVER:http://proxy.local:8080",
    "SYS_PAC:",
    "ENV_PROXY:http://proxy.local:8080",
    "ENV_NO_PROXY:",
    ""
  ].join("\n");

  const result = parseCommandOutput("proxy_conflict_check", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.hasSystemProxy, true);
  assert.equal(result.structured.hasEnvProxy, true);
  assert.equal(result.structured.proxyConflict, true);
  assert.equal(result.structured.hasNoProxy, false);
  assert.ok(result.diagnosis.join("；").includes("代理"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: UNSUPPORTED_PLATFORM 走统一平台不支持逻辑", () => {
  const output = "UNSUPPORTED_PLATFORM: DHCP 状态\n";
  const result = parseCommandOutput("dhcp_status", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.supportedOnCurrentPlatform, false);
  assert.equal(result.structured.feature, "DHCP 状态");
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: network_env_vars 会脱敏代理账号密码", () => {
  const output = [
    "Name       Value",
    "----       -----",
    "HTTP_PROXY http://user:pass@proxy.local:8080",
    "NO_PROXY   localhost,127.0.0.1",
    ""
  ].join("\n");

  const result = parseCommandOutput("network_env_vars", output, 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.proxyEnvVarCount, 2);
  const httpProxy = String(result.structured.env_HTTP_PROXY ?? "");
  assert.ok(httpProxy.includes("user:***@"));
  ensureEvidence(result.evidence);
});

test("parseCommandOutput: 未定义命令也必须有 evidence", () => {
  const result = parseCommandOutput("unknown_command", "hello", 0) as unknown as {
    structured: Record<string, unknown>;
    diagnosis: string[];
    evidence: unknown;
  };

  assert.equal(result.structured.exitCode, 0);
  ensureEvidence(result.evidence);
});
