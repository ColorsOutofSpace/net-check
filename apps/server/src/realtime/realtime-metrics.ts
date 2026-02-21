import { spawn, spawnSync } from "node:child_process";
import { RealtimeMetricsSnapshot, SignalQuality } from "../types";

const sampleIntervalMs = 2000;
export const defaultRealtimeLatencyTarget = "1.1.1.1";
export const realtimeAdminPermissionMessage = "实时面板需要管理员权限，请以管理员身份运行后端服务。";

type Subscriber = (snapshot: RealtimeMetricsSnapshot) => void;

interface AdapterSample {
  connected: boolean;
  interfaceName: string;
  interfaceAlias: string;
  linkSpeed: string;
  receivedBytes: number;
  sentBytes: number;
  signalPercent: number | null;
  note: string;
}

interface CounterSnapshot {
  interfaceName: string;
  receivedBytes: number;
  sentBytes: number;
  timestampMs: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface RealtimeChannel {
  latencyTarget: string;
  subscribers: Set<Subscriber>;
  timer: NodeJS.Timeout | null;
  collecting: boolean;
  lastCounters: CounterSnapshot | null;
  lastSnapshot: RealtimeMetricsSnapshot;
}

interface RealtimeAdminCapability {
  ready: boolean;
  reason: string;
  checkedAt: string;
}

const adminPermissionErrorPatterns = [/拒绝访问/i, /access is denied/i, /requires elevation/i, /0x80041003/i];

let cachedRealtimeAdminCapability: RealtimeAdminCapability | null = null;

const normalizeLatencyTarget = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : defaultRealtimeLatencyTarget;
};

const initialSnapshot = (latencyTarget: string): RealtimeMetricsSnapshot => ({
  timestamp: new Date().toISOString(),
  latencyTarget,
  connected: false,
  interfaceName: "",
  interfaceAlias: "",
  latencyMs: null,
  downloadBytesPerSecond: 0,
  uploadBytesPerSecond: 0,
  downloadMaxBytesPerSecond: null,
  uploadMaxBytesPerSecond: null,
  signalDbm: null,
  signalPercent: null,
  signalQuality: "none",
  note: "等待实时网络采样。"
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseLinkSpeedToBytes = (raw: string): number | null => {
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(",", ".").trim();
  const match = normalized.match(/([\d.]+)\s*([kmgt]?)(?:i)?\s*(?:b(?:it)?\/?s|bps)/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const unit = match[2].toUpperCase();
  const multiplier =
    unit === "K" ? 1_000 : unit === "M" ? 1_000_000 : unit === "G" ? 1_000_000_000 : unit === "T" ? 1_000_000_000_000 : 1;

  return (value * multiplier) / 8;
};

const parseLatencyMs = (output: string): number | null => {
  if (!output) {
    return null;
  }

  if (/(?:time|时间)\s*[=<]\s*1\s*ms/i.test(output) || /<\s*1\s*ms/i.test(output)) {
    return 1;
  }

  const match = output.match(/(?:time|时间)\s*[=<]\s*([\d.]+)\s*ms/i);
  if (!match) {
    return null;
  }

  const latency = Number(match[1]);
  if (!Number.isFinite(latency) || latency < 0) {
    return null;
  }

  return latency;
};

const decodeCommandOutput = (buffer: Buffer): string => {
  if (buffer.length === 0) {
    return "";
  }

  const utf8 = buffer.toString("utf8");

  // Some PowerShell hosts write UTF-16LE to pipes; handle that explicitly.
  if (buffer.includes(0)) {
    const utf16 = buffer.toString("utf16le").replace(/\u0000/g, "");
    if (utf16.trim().length > 0) {
      return utf16;
    }
  }

  return utf8;
};

const estimateSignalDbm = (signalPercent: number | null): number | null => {
  if (signalPercent === null || !Number.isFinite(signalPercent)) {
    return null;
  }
  const normalized = clamp(signalPercent, 0, 100);
  return Math.round(normalized / 2 - 100);
};

const resolveSignalQuality = (signalDbm: number | null): SignalQuality => {
  if (signalDbm === null) {
    return "none";
  }

  if (signalDbm >= -60) {
    return "excellent";
  }
  if (signalDbm >= -70) {
    return "good";
  }
  if (signalDbm >= -80) {
    return "fair";
  }
  return "weak";
};

const runCommand = (command: string, args: string[], timeoutMs: number): Promise<CommandResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const finish = (exitCode: number | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      const stdout = decodeCommandOutput(Buffer.concat(stdoutChunks));
      const stderr = decodeCommandOutput(Buffer.concat(stderrChunks));
      resolve({ stdout, stderr, exitCode });
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill();
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      stderrChunks.push(Buffer.from(error.message, "utf8"));
      clearTimeout(timeoutHandle);
      finish(null);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      finish(exitCode);
    });
  });

const collectLatencyMs = async (target: string): Promise<number | null> => {
  const args =
    process.platform === "win32"
      ? ["-n", "1", "-w", "1200", target]
      : process.platform === "linux"
        ? ["-c", "1", "-W", "1", target]
        : ["-c", "1", target];

  const result = await runCommand("ping", args, 2200);
  const combined = `${result.stdout}\n${result.stderr}`;
  return parseLatencyMs(combined);
};

const collectWindowsAdapterSample = async (): Promise<AdapterSample> => {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1",
    "if (-not $route) { [PSCustomObject]@{ connected = $false; note = 'NO_DEFAULT_ROUTE' } | ConvertTo-Json -Compress; exit 0 }",
    "$adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex | Select-Object -First 1",
    "if (-not $adapter) { [PSCustomObject]@{ connected = $false; note = 'NO_ADAPTER' } | ConvertTo-Json -Compress; exit 0 }",
    "$stats = Get-NetAdapterStatistics -Name $adapter.Name | Select-Object -First 1",
    "$wifi = netsh wlan show interfaces | Out-String",
    "$signalPercent = $null",
    "if ($wifi -match 'Signal\\s*:\\s*(\\d+)%' -or $wifi -match '信号\\s*:\\s*(\\d+)%') { $signalPercent = [int]$matches[1] }",
    "$result = [PSCustomObject]@{ connected = $true; interfaceName = \"$($adapter.Name)\"; interfaceAlias = \"$($route.InterfaceAlias)\"; linkSpeed = \"$($adapter.LinkSpeed)\"; receivedBytes = [double]$stats.ReceivedBytes; sentBytes = [double]$stats.SentBytes; signalPercent = $signalPercent; note = '' }",
    "$result | ConvertTo-Json -Compress"
  ].join("; ");

  const result = await runCommand("powershell", ["-NoProfile", "-Command", command], 2600);
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  const denied = adminPermissionErrorPatterns.some((pattern) => pattern.test(combinedOutput));

  if (result.exitCode === null) {
    return {
      connected: false,
      interfaceName: "",
      interfaceAlias: "",
      linkSpeed: "",
      receivedBytes: 0,
      sentBytes: 0,
      signalPercent: null,
      note: "实时采样超时。"
    };
  }

  if (result.exitCode !== 0) {
    return {
      connected: false,
      interfaceName: "",
      interfaceAlias: "",
      linkSpeed: "",
      receivedBytes: 0,
      sentBytes: 0,
      signalPercent: null,
      note: denied
        ? realtimeAdminPermissionMessage
        : combinedOutput
          ? `实时采样命令失败：${combinedOutput.split(/\r?\n/)[0]}`
          : "实时采样命令失败。"
    };
  }

  const raw = result.stdout.trim();
  if (!raw) {
    return {
      connected: false,
      interfaceName: "",
      interfaceAlias: "",
      linkSpeed: "",
      receivedBytes: 0,
      sentBytes: 0,
      signalPercent: null,
      note: denied ? realtimeAdminPermissionMessage : "未读取到网卡状态。"
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<{
      connected: boolean;
      interfaceName: string;
      interfaceAlias: string;
      linkSpeed: string;
      receivedBytes: number | string;
      sentBytes: number | string;
      signalPercent: number | string | null;
      note: string;
    }>;

    const connected = parsed.connected === true;
    const receivedBytes = parseNumber(parsed.receivedBytes) ?? 0;
    const sentBytes = parseNumber(parsed.sentBytes) ?? 0;
    const signalPercentRaw = parsed.signalPercent === null ? null : parseNumber(parsed.signalPercent);
    const signalPercent = signalPercentRaw === null ? null : clamp(Math.round(signalPercentRaw), 0, 100);

    return {
      connected,
      interfaceName: connected ? (parsed.interfaceName ?? "") : "",
      interfaceAlias: connected ? (parsed.interfaceAlias ?? "") : "",
      linkSpeed: connected ? (parsed.linkSpeed ?? "") : "",
      receivedBytes,
      sentBytes,
      signalPercent,
      note: parsed.note ?? ""
    };
  } catch {
    return {
      connected: false,
      interfaceName: "",
      interfaceAlias: "",
      linkSpeed: "",
      receivedBytes: 0,
      sentBytes: 0,
      signalPercent: null,
      note: "实时采样解析失败。"
    };
  }
};

const collectAdapterSample = async (): Promise<AdapterSample> => {
  if (process.platform === "win32") {
    return collectWindowsAdapterSample();
  }

  return {
    connected: false,
    interfaceName: "",
    interfaceAlias: "",
    linkSpeed: "",
    receivedBytes: 0,
    sentBytes: 0,
    signalPercent: null,
    note: "当前平台暂不支持实时网卡采样。"
  };
};

const evaluateRealtimeAdminCapability = (): RealtimeAdminCapability => {
  const checkedAt = new Date().toISOString();

  if (process.platform !== "win32") {
    return {
      ready: false,
      reason: "当前平台暂不支持实时面板的管理员采样能力。",
      checkedAt
    };
  }

  const probe = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "$ErrorActionPreference='Stop'; Get-NetAdapter -IncludeHidden | Select-Object -First 1 | Out-Null; Get-NetAdapterStatistics | Select-Object -First 1 | Out-Null"
    ],
    {
      windowsHide: true,
      encoding: "utf8"
    }
  );

  if (probe.error) {
    return {
      ready: false,
      reason: probe.error.message || "管理员权限检查失败。",
      checkedAt
    };
  }

  const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim();
  const denied = adminPermissionErrorPatterns.some((pattern) => pattern.test(output));

  if (denied) {
    return {
      ready: false,
      reason: "系统拒绝访问网络配置查询（需要管理员权限）。",
      checkedAt
    };
  }

  if (probe.status === 0) {
    return {
      ready: true,
      reason: "管理员权限检查通过。",
      checkedAt
    };
  }

  return {
    ready: false,
    reason: output || "管理员权限检查失败。",
    checkedAt
  };
};

export const getRealtimeAdminCapability = (forceRefresh = false): RealtimeAdminCapability => {
  if (!cachedRealtimeAdminCapability || forceRefresh) {
    cachedRealtimeAdminCapability = evaluateRealtimeAdminCapability();
  }

  return cachedRealtimeAdminCapability;
};

class RealtimeMetricsService {
  private channels = new Map<string, RealtimeChannel>();

  subscribe(latencyTarget: string, onSnapshot: Subscriber): () => void {
    const normalizedTarget = normalizeLatencyTarget(latencyTarget);
    const channel = this.getOrCreateChannel(normalizedTarget);

    channel.subscribers.add(onSnapshot);
    onSnapshot(channel.lastSnapshot);

    if (!channel.timer) {
      this.startChannel(channel);
    }

    return () => {
      const current = this.channels.get(normalizedTarget);
      if (!current) {
        return;
      }

      current.subscribers.delete(onSnapshot);
      if (current.subscribers.size === 0) {
        this.stopChannel(current);
        this.channels.delete(normalizedTarget);
      }
    };
  }

  private getOrCreateChannel(latencyTarget: string): RealtimeChannel {
    const existing = this.channels.get(latencyTarget);
    if (existing) {
      return existing;
    }

    const channel: RealtimeChannel = {
      latencyTarget,
      subscribers: new Set<Subscriber>(),
      timer: null,
      collecting: false,
      lastCounters: null,
      lastSnapshot: initialSnapshot(latencyTarget)
    };
    this.channels.set(latencyTarget, channel);
    return channel;
  }

  private startChannel(channel: RealtimeChannel): void {
    void this.collectAndPublish(channel);
    channel.timer = setInterval(() => {
      void this.collectAndPublish(channel);
    }, sampleIntervalMs);
  }

  private stopChannel(channel: RealtimeChannel): void {
    if (channel.timer) {
      clearInterval(channel.timer);
      channel.timer = null;
    }
    channel.lastCounters = null;
  }

  private publish(channel: RealtimeChannel, snapshot: RealtimeMetricsSnapshot): void {
    channel.subscribers.forEach((subscriber) => {
      subscriber(snapshot);
    });
  }

  private async collectAndPublish(channel: RealtimeChannel): Promise<void> {
    if (channel.collecting) {
      return;
    }

    channel.collecting = true;

    try {
      const [adapter, latencyMs] = await Promise.all([collectAdapterSample(), collectLatencyMs(channel.latencyTarget)]);
      const nowMs = Date.now();
      const timestamp = new Date(nowMs).toISOString();

      let downloadBytesPerSecond = 0;
      let uploadBytesPerSecond = 0;

      if (adapter.connected) {
        const previous = channel.lastCounters;
        if (previous && previous.interfaceName === adapter.interfaceName) {
          const elapsedSeconds = Math.max((nowMs - previous.timestampMs) / 1000, 0.5);
          const downloadDelta = adapter.receivedBytes - previous.receivedBytes;
          const uploadDelta = adapter.sentBytes - previous.sentBytes;

          if (downloadDelta > 0) {
            downloadBytesPerSecond = downloadDelta / elapsedSeconds;
          }
          if (uploadDelta > 0) {
            uploadBytesPerSecond = uploadDelta / elapsedSeconds;
          }
        }

        channel.lastCounters = {
          interfaceName: adapter.interfaceName,
          receivedBytes: adapter.receivedBytes,
          sentBytes: adapter.sentBytes,
          timestampMs: nowMs
        };
      } else {
        channel.lastCounters = null;
      }

      const maxBytes = parseLinkSpeedToBytes(adapter.linkSpeed);
      const signalDbm = estimateSignalDbm(adapter.signalPercent);
      const signalQuality = resolveSignalQuality(signalDbm);

      const snapshot: RealtimeMetricsSnapshot = {
        timestamp,
        latencyTarget: channel.latencyTarget,
        connected: adapter.connected,
        interfaceName: adapter.interfaceName,
        interfaceAlias: adapter.interfaceAlias,
        latencyMs,
        downloadBytesPerSecond,
        uploadBytesPerSecond,
        downloadMaxBytesPerSecond: maxBytes,
        uploadMaxBytesPerSecond: maxBytes,
        signalDbm,
        signalPercent: adapter.signalPercent,
        signalQuality,
        note: !adapter.connected
          ? adapter.note || "未检测到活动网络接口。"
          : adapter.signalPercent === null
            ? "当前接口可能不是 Wi-Fi，信号强度不可用。"
            : adapter.note || "数据每 2 秒刷新一次。"
      };

      channel.lastSnapshot = snapshot;
      this.publish(channel, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "实时采样失败。";
      const snapshot: RealtimeMetricsSnapshot = {
        ...initialSnapshot(channel.latencyTarget),
        timestamp: new Date().toISOString(),
        note: message
      };
      channel.lastSnapshot = snapshot;
      this.publish(channel, snapshot);
    } finally {
      channel.collecting = false;
    }
  }
}

export const realtimeMetricsService = new RealtimeMetricsService();
