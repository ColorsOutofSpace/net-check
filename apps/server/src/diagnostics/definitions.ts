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


