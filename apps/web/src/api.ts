import {
  CommandDefinition,
  JobSnapshot,
  RealtimeMetricsEvent,
  RealtimeMetricsSnapshot,
  StreamEvent
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const fetchCommands = async (): Promise<CommandDefinition[]> => {
  const response = await fetch(`${API_BASE}/api/commands`);
  if (!response.ok) {
    throw new Error("加载命令列表失败");
  }
  const data = (await response.json()) as { commands: CommandDefinition[] };
  return data.commands;
};

export const createJob = async (payload: {
  commandId: string;
  target: string;
  count: number;
  timeoutSeconds: number;
}): Promise<{ jobId: string; job: JobSnapshot }> => {
  const response = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message: string | null = null;
    if (errorText) {
      try {
        const parsed = JSON.parse(errorText) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          message = parsed.message.trim();
        }
      } catch {
        message = null;
      }
    }
    throw new Error(message ?? "任务创建失败");
  }

  return (await response.json()) as { jobId: string; job: JobSnapshot };
};

export const subscribeJob = (
  jobId: string,
  onEvent: (event: StreamEvent) => void,
  onError: (error: string) => void
): (() => void) => {
  const source = new EventSource(`${API_BASE}/api/jobs/${jobId}/stream`);

  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as StreamEvent;
      onEvent(event);
      if (event.type === "complete") {
        source.close();
      }
    } catch (_error) {
      onError("流式消息解析失败");
    }
  };

  source.onerror = () => {
    onError("与后端的流式连接中断");
    source.close();
  };

  return () => source.close();
};

const isRealtimeMetricsEvent = (value: unknown): value is RealtimeMetricsEvent => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<RealtimeMetricsEvent>;
  if (event.type !== "metrics" || !event.payload || typeof event.payload !== "object") {
    return false;
  }

  const snapshot = (event.payload as { snapshot?: unknown }).snapshot;
  return Boolean(snapshot && typeof snapshot === "object");
};

const parseApiErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // ignore parse failure and fallback
  }

  return fallback;
};

export const subscribeRealtimeMetrics = (
  latencyTarget: string,
  onSnapshot: (snapshot: RealtimeMetricsSnapshot) => void,
  onError: (error: string) => void
): (() => void) => {
  let closed = false;
  let source: EventSource | null = null;
  const normalizedTarget = latencyTarget.trim();
  const query = normalizedTarget ? `?target=${encodeURIComponent(normalizedTarget)}` : "";
  const accessUrl = `${API_BASE}/api/realtime/access`;
  const streamUrl = `${API_BASE}/api/realtime/stream${query}`;

  const connect = (): void => {
    if (closed) {
      return;
    }

    source = new EventSource(streamUrl);

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as unknown;
        if (!isRealtimeMetricsEvent(event)) {
          onError("实时指标消息格式异常");
          return;
        }
        onSnapshot(event.payload.snapshot);
      } catch (_error) {
        onError("实时指标消息解析失败");
      }
    };

    source.onerror = () => {
      onError("实时连接中断，请确认后端仍以管理员身份运行。");
      source?.close();
      source = null;
    };
  };

  void fetch(accessUrl)
    .then(async (response) => {
      if (closed) {
        return;
      }

      if (!response.ok) {
        const message = await parseApiErrorMessage(
          response,
          "实时面板需要管理员权限，请以管理员身份运行后端服务。"
        );
        onError(message);
        return;
      }

      connect();
    })
    .catch(() => {
      if (!closed) {
        onError("无法连接实时服务，请检查后端是否已启动。");
      }
    });

  return () => {
    closed = true;
    source?.close();
    source = null;
  };
};
