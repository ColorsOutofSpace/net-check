import {
  CommandBuildResult,
  CommandInput,
  CommandRuntimeDefinition,
  DiagnosticCommandDefinition
} from "../types";

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const isMacOS = process.platform === "darwin";

const normalizeHttpTarget = (target: string): string => {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }
  return `https://${target}`;
};

const unsupportedPlatform = (feature: string): CommandBuildResult => ({
  command: process.execPath,
  args: ["-e", `console.log(${JSON.stringify(`UNSUPPORTED_PLATFORM: ${feature}`)});`]
});

const commandDefinitions: CommandRuntimeDefinition[] = [
  {
    id: "ping_target",
    title: "Ping 连通性",
    description: "检测目标主机的丢包率与时延。",
    category: "连通性",
    targetHint: "例如 8.8.8.8 或 openai.com",
    defaultTarget: "8.8.8.8",
    supportsCount: true,
    requiresTarget: true,
    build: ({ target, count }: CommandInput) => {
      if (isWindows) {
        return { command: "ping", args: ["-n", String(count), target] };
      }
      return { command: "ping", args: ["-c", String(count), target] };
    }
  },
  {
    id: "dns_lookup",
    title: "DNS 解析",
    description: "查询 DNS 记录并检查域名解析是否成功。",
    category: "DNS",
    targetHint: "例如 openai.com",
    defaultTarget: "openai.com",
    supportsCount: false,
    requiresTarget: true,
    build: ({ target }: CommandInput) => ({
      command: "nslookup",
      args: [target]
    })
  },
  {
    id: "trace_route",
    title: "路由追踪",
    description: "识别链路跳点并定位潜在瓶颈。",
    category: "路径分析",
    targetHint: "例如 1.1.1.1 或 cloudflare.com",
    defaultTarget: "1.1.1.1",
    supportsCount: false,
    requiresTarget: true,
    build: ({ target }: CommandInput) => {
      if (isWindows) {
        return { command: "tracert", args: ["-d", target] };
      }
      return { command: "traceroute", args: ["-n", target] };
    }
  },
  {
    id: "http_head",
    title: "HTTP 可用性",
    description: "检查 HTTP 状态码与基本可达性。",
    category: "HTTP",
    targetHint: "例如 https://openai.com",
    defaultTarget: "https://openai.com",
    supportsCount: false,
    requiresTarget: true,
    build: ({ target, timeoutSeconds }: CommandInput) => ({
      command: "curl",
      args: ["-I", "--max-time", String(timeoutSeconds), normalizeHttpTarget(target)]
    })
  },
  {
    id: "default_route_check",
    title: "默认路由检测",
    description: "检查主机是否存在有效默认路由。",
    category: "连通性",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return { command: "route", args: ["print", "-4"] };
      }

      if (isLinux) {
        return { command: "ip", args: ["route"] };
      }

      if (isMacOS) {
        return { command: "netstat", args: ["-rn"] };
      }

      return unsupportedPlatform("默认路由检测");
    }
  },
  {
    id: "gateway_reachability",
    title: "默认网关可达性",
    description: "对默认网关执行 ICMP 探测，验证本地二层连通。",
    category: "连通性",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop; if (!$gw) { Write-Output 'GATEWAY:NOT_FOUND'; exit 1 }; Write-Output \"GATEWAY:$gw\"; ping -n 2 $gw"
          ]
        };
      }

      return unsupportedPlatform("默认网关可达性");
    }
  },
  {
    id: "arp_neighbor_check",
    title: "ARP 邻居表检测",
    description: "检查默认网关是否出现在邻居表中，并判断其状态。",
    category: "连通性",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop; if ($gw) { Write-Output \"GATEWAY:$gw\" } else { Write-Output 'GATEWAY:NOT_FOUND' }; Get-NetNeighbor -AddressFamily IPv4 | Select-Object IPAddress,LinkLayerAddress,State,InterfaceAlias | Format-Table -AutoSize"
          ]
        };
      }

      return unsupportedPlatform("ARP 邻居表检测");
    }
  },
  {
    id: "global_internet_icmp",
    title: "全局网络 ICMP",
    description: "通过公共 IP 检查外网连通性。",
    category: "连通性",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: true,
    requiresTarget: false,
    build: ({ count }: CommandInput) => {
      if (isWindows) {
        return { command: "ping", args: ["-n", String(count), "1.1.1.1"] };
      }
      return { command: "ping", args: ["-c", String(count), "1.1.1.1"] };
    }
  },
  {
    id: "global_dns_probe",
    title: "全局 DNS 探测",
    description: "通过本机 DNS 设置解析公共域名。",
    category: "DNS",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => ({
      command: "nslookup",
      args: ["example.com"]
    })
  },
  {
    id: "nic_link_status",
    title: "网卡链路状态",
    description: "检查网卡状态、链路速率和 MAC 信息。",
    category: "网络接口",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Get-NetAdapter | Select-Object Name,Status,LinkSpeed,MacAddress | Format-Table -AutoSize"
          ]
        };
      }

      if (isLinux) {
        return { command: "ip", args: ["-brief", "link"] };
      }

      if (isMacOS) {
        return { command: "ifconfig", args: [] };
      }

      return unsupportedPlatform("网卡链路状态");
    }
  },
  {
    id: "virtual_adapter_check",
    title: "虚拟网卡与路由检测",
    description: "识别虚拟网卡并判断默认路由是否由虚拟网卡承担。",
    category: "网络接口",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$adapters = Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,LinkSpeed,InterfaceIndex,MacAddress; " +
              "$routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 3 InterfaceIndex,InterfaceAlias,NextHop,RouteMetric; " +
              "$pattern = 'virtual|vmware|virtualbox|hyper-v|vethernet|tap|tun|wireguard|openvpn|anyconnect|fortinet|zscaler|wintun|loopback|npcap|vpn'; " +
              "$virtualAdapters = $adapters | Where-Object { (\"$($_.Name) $($_.InterfaceDescription)\") -match $pattern }; " +
              "$physicalAdapters = $adapters | Where-Object { (\"$($_.Name) $($_.InterfaceDescription)\") -notmatch $pattern }; " +
              "$total = ($adapters | Measure-Object).Count; " +
              "$virtualCount = ($virtualAdapters | Measure-Object).Count; " +
              "$physicalCount = ($physicalAdapters | Measure-Object).Count; " +
              "$virtualUpCount = ($virtualAdapters | Where-Object { $_.Status -match 'Up|Connected' } | Measure-Object).Count; " +
              "$physicalUpCount = ($physicalAdapters | Where-Object { $_.Status -match 'Up|Connected' } | Measure-Object).Count; " +
              "Write-Output '== 汇总 =='; " +
              "Write-Output \"适配器总数: $total\"; " +
              "Write-Output \"虚拟网卡数量: $virtualCount\"; " +
              "Write-Output \"物理网卡数量: $physicalCount\"; " +
              "Write-Output \"虚拟网卡(Up): $virtualUpCount\"; " +
              "Write-Output \"物理网卡(Up): $physicalUpCount\"; " +
              "if ($routes -and $routes.Count -gt 0) { " +
                "$primary = $routes | Select-Object -First 1; " +
                "$primaryAdapter = $null; " +
                "if ($primary.InterfaceIndex) { $primaryAdapter = $adapters | Where-Object { $_.InterfaceIndex -eq $primary.InterfaceIndex } | Select-Object -First 1 }; " +
                "$primaryType = '未知'; " +
                "if ($primaryAdapter) { $primaryType = if ((\"$($primaryAdapter.Name) $($primaryAdapter.InterfaceDescription)\") -match $pattern) { '虚拟网卡' } else { '物理网卡' } }; " +
                "Write-Output \"默认路由: $($primary.InterfaceAlias) -> $($primary.NextHop) (Metric=$($primary.RouteMetric))\"; " +
                "Write-Output \"默认路由类型: $primaryType\"; " +
              "} else { Write-Output '未检测到默认路由' }; " +
              "Write-Output ''; " +
              "Write-Output '== 虚拟网卡列表 =='; " +
              "if ($virtualAdapters -and $virtualCount -gt 0) { $virtualAdapters | Select-Object Name,InterfaceDescription,Status,LinkSpeed,InterfaceIndex | Format-Table -AutoSize | Out-String -Width 200 | Write-Output } else { Write-Output '无' }; " +
              "Write-Output ''; " +
              "Write-Output '== 物理网卡列表 =='; " +
              "if ($physicalAdapters -and $physicalCount -gt 0) { $physicalAdapters | Select-Object Name,InterfaceDescription,Status,LinkSpeed,InterfaceIndex | Format-Table -AutoSize | Out-String -Width 200 | Write-Output } else { Write-Output '无' }; " +
              "Write-Output ''; " +
              "Write-Output '== 默认路由候选 =='; " +
              "if ($routes -and $routes.Count -gt 0) { " +
                "$routeView = $routes | ForEach-Object { " +
                  "$route = $_; " +
                  "$adapter = $adapters | Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } | Select-Object -First 1; " +
                  "$type = '未知'; " +
                  "if ($adapter) { $type = if ((\"$($adapter.Name) $($adapter.InterfaceDescription)\") -match $pattern) { '虚拟网卡' } else { '物理网卡' } }; " +
                  "[PSCustomObject]@{ InterfaceAlias=$route.InterfaceAlias; NextHop=$route.NextHop; Metric=$route.RouteMetric; Type=$type } " +
                "}; " +
                "$routeView | Format-Table -AutoSize | Out-String -Width 200 | Write-Output; " +
              "} else { Write-Output '无' }; " +
              "Write-Output ''; " +
              "Write-Output '== JSON =='; " +
              "$json = [PSCustomObject]@{Adapters=$adapters; DefaultRoutes=$routes} | ConvertTo-Json -Depth 4; " +
              "Write-Output \"JSON:$json\""
          ],
          displayCommandLine: "PowerShell: 汇总虚拟网卡与默认路由信息"
        };
      }

      return unsupportedPlatform("虚拟网卡与路由检测");
    }
  },
  {
    id: "nic_ip_config",
    title: "网卡 IP 配置",
    description: "检查网卡 IP 配置及默认网关信息。",
    category: "网络接口",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return { command: "ipconfig", args: ["/all"] };
      }

      if (isLinux) {
        return { command: "ip", args: ["addr"] };
      }

      if (isMacOS) {
        return { command: "ifconfig", args: [] };
      }

      return unsupportedPlatform("网卡 IP 配置");
    }
  },
  {
    id: "dhcp_status",
    title: "DHCP 状态",
    description: "检查网卡使用 DHCP 还是静态地址。",
    category: "网络接口",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Get-NetIPInterface -AddressFamily IPv4 | Select-Object InterfaceAlias,Dhcp,ConnectionState | Format-Table -AutoSize"
          ]
        };
      }

      return unsupportedPlatform("DHCP 状态");
    }
  },
  {
    id: "dns_server_config",
    title: "DNS 服务器配置",
    description: "检查系统网络接口中的 DNS 服务器配置。",
    category: "DNS",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses | Format-List"
          ]
        };
      }

      if (isLinux) {
        return { command: "cat", args: ["/etc/resolv.conf"] };
      }

      if (isMacOS) {
        return { command: "scutil", args: ["--dns"] };
      }

      return unsupportedPlatform("DNS 服务器配置");
    }
  },
  {
    id: "dns_server_probe",
    title: "DNS 服务器可用性",
    description: "逐个验证本机 DNS 服务器是否能解析公共域名。",
    category: "DNS",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$servers = (Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses) | Where-Object { $_ }; $unique = $servers | Select-Object -Unique; if (-not $unique) { Write-Output 'DNS_SERVER:NONE'; exit 1 }; foreach ($s in $unique) { try { Resolve-DnsName -Name 'example.com' -Server $s -ErrorAction Stop | Out-Null; Write-Output \"DNS_SERVER:$s OK\" } catch { Write-Output \"DNS_SERVER:$s FAIL\" } }"
          ]
        };
      }

      return unsupportedPlatform("DNS 服务器可用性");
    }
  },
  {
    id: "hosts_file_check",
    title: "Hosts 文件检测",
    description: "检查 Hosts 映射并识别潜在风险覆盖项。",
    category: "DNS",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Get-Content -Path \"$env:SystemRoot\\System32\\drivers\\etc\\hosts\""
          ]
        };
      }

      return { command: "cat", args: ["/etc/hosts"] };
    }
  },
  {
    id: "lsp_catalog_check",
    title: "LSP 目录检测",
    description: "检查 Winsock 目录项与分层服务提供程序。",
    category: "Windows 协议栈",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return { command: "netsh", args: ["winsock", "show", "catalog"] };
      }

      return unsupportedPlatform("LSP 目录检测");
    }
  },
  {
    id: "ie_proxy_check",
    title: "IE 代理检测",
    description: "读取 Windows Internet Settings 代理与 PAC 配置。",
    category: "代理",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$setting = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; [PSCustomObject]@{ ProxyEnable = $setting.ProxyEnable; ProxyServer = $setting.ProxyServer; AutoConfigURL = $setting.AutoConfigURL; AutoDetect = $setting.AutoDetect } | Format-List"
          ]
        };
      }

      return unsupportedPlatform("IE 代理检测");
    }
  },
  {
    id: "winhttp_proxy_check",
    title: "WinHTTP 代理检测",
    description: "检查系统 WinHTTP 代理配置（可能与系统代理不同）。",
    category: "代理",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return { command: "netsh", args: ["winhttp", "show", "proxy"] };
      }

      return unsupportedPlatform("WinHTTP 代理检测");
    }
  },
  {
    id: "proxy_conflict_check",
    title: "代理冲突检测",
    description: "检查系统代理与环境变量代理是否存在冲突。",
    category: "代理",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "$setting = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; $proxyEnabled = $setting.ProxyEnable -eq 1; $proxyServer = $setting.ProxyServer; $autoConfigUrl = $setting.AutoConfigURL; $envProxy = $env:HTTP_PROXY; if (!$envProxy) { $envProxy = $env:HTTPS_PROXY }; $envNoProxy = $env:NO_PROXY; Write-Output \"SYS_PROXY_ENABLED:$proxyEnabled\"; Write-Output \"SYS_PROXY_SERVER:$proxyServer\"; Write-Output \"SYS_PAC:$autoConfigUrl\"; Write-Output \"ENV_PROXY:$envProxy\"; Write-Output \"ENV_NO_PROXY:$envNoProxy\""
          ]
        };
      }

      return unsupportedPlatform("代理冲突检测");
    }
  },
  {
    id: "network_env_vars",
    title: "网络环境变量",
    description: "检查工具链相关代理环境变量。",
    category: "环境",
    targetHint: "无需填写目标。",
    defaultTarget: "localhost",
    supportsCount: false,
    requiresTarget: false,
    build: () => {
      if (isWindows) {
        return {
          command: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "Get-ChildItem Env: | Where-Object { $_.Name -match '^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|ALL_PROXY|http_proxy|https_proxy|no_proxy|all_proxy)$' } | Sort-Object Name | Format-Table -AutoSize"
          ]
        };
      }

      return { command: "printenv", args: [] };
    }
  }
];

export const listCommandDefinitions = (): DiagnosticCommandDefinition[] =>
  commandDefinitions.map(({ build, ...rest }) => rest);

export const getRuntimeDefinition = (commandId: string): CommandRuntimeDefinition | undefined =>
  commandDefinitions.find((definition) => definition.id === commandId);


