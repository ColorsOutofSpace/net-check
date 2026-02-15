export interface DiagnosticCommandDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  targetHint: string;
  defaultTarget: string;
  supportsCount: boolean;
  requiresTarget: boolean;
}

export interface CommandInput {
  target: string;
  count: number;
  timeoutSeconds: number;
}

export interface CommandBuildResult {
  command: string;
  args: string[];
}

export interface CommandRuntimeDefinition extends DiagnosticCommandDefinition {
  build: (input: CommandInput) => CommandBuildResult;
}

export type JobStatus = "running" | "completed" | "failed";

export interface JobSnapshot {
  jobId: string;
  commandId: string;
  commandTitle: string;
  target: string;
  startedAt: string;
  endedAt?: string;
  status: JobStatus;
  exitCode: number | null;
  rawOutput: string;
  structured: Record<string, string | number | boolean>;
  diagnosis: string[];
}

export type StreamEventType = "start" | "log" | "error" | "complete";

export interface StreamEvent {
  type: StreamEventType;
  payload: Record<string, unknown>;
}
