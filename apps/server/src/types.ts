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
  displayCommandLine?: string;
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
  evidence: string[];
}

export type StreamEventType = "start" | "log" | "error" | "complete";

export interface StreamEvent {
  type: StreamEventType;
  payload: Record<string, unknown>;
}

export type SignalQuality = "excellent" | "good" | "fair" | "weak" | "none";

export interface RealtimeMetricsSnapshot {
  timestamp: string;
  latencyTarget: string;
  connected: boolean;
  interfaceName: string;
  interfaceAlias: string;
  latencyMs: number | null;
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
  downloadMaxBytesPerSecond: number | null;
  uploadMaxBytesPerSecond: number | null;
  signalDbm: number | null;
  signalPercent: number | null;
  signalQuality: SignalQuality;
  note: string;
}
