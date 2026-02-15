import { CommandDefinition, JobSnapshot, StreamEvent } from "./types";

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
