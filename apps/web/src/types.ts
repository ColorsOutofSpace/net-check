export interface CommandDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  targetHint: string;
  defaultTarget: string;
  supportsCount: boolean;
  requiresTarget: boolean;
}

export interface JobSnapshot {
  jobId: string;
  commandId: string;
  commandTitle: string;
  target: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  rawOutput: string;
  structured: Record<string, string | number | boolean>;
  diagnosis: string[];
  evidence: string[];
}

export interface StreamEvent {
  type: "start" | "log" | "error" | "complete";
  payload: Record<string, unknown>;
}
