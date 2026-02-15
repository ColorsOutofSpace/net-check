import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { TextDecoder } from "node:util";
import { getRuntimeDefinition } from "./definitions";
import { parseCommandOutput } from "./parsers";
import { CommandInput, JobSnapshot, StreamEvent } from "../types";

interface InternalJob {
  snapshot: JobSnapshot;
  events: StreamEvent[];
  emitter: EventEmitter;
}

const isWindows = process.platform === "win32";

const codePageToEncoding = (codePage?: string): string => {
  if (!codePage) {
    return "gbk";
  }

  if (codePage === "65001") {
    return "utf-8";
  }

  if (codePage === "936") {
    return "gbk";
  }

  if (codePage === "54936") {
    return "gb18030";
  }

  if (codePage === "950") {
    return "big5";
  }

  if (codePage === "932") {
    return "shift_jis";
  }

  if (codePage === "949") {
    return "euc-kr";
  }

  if (codePage === "1252") {
    return "windows-1252";
  }

  return "utf-8";
};

const resolveWindowsEncoding = (): string => {
  if (!isWindows) {
    return "utf-8";
  }

  try {
    const result = spawnSync("cmd", ["/d", "/s", "/c", "chcp"], {
      windowsHide: true,
      encoding: "utf8"
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const codePage = output.match(/(\d{3,5})/)?.[1];
    return codePageToEncoding(codePage);
  } catch {
    return "gbk";
  }
};

const windowsEncoding = resolveWindowsEncoding();

const createStreamDecoder = (): TextDecoder => {
  if (!isWindows) {
    return new TextDecoder("utf-8");
  }

  try {
    return new TextDecoder(windowsEncoding);
  } catch {
    return new TextDecoder("utf-8");
  }
};

const looksLikeLspMojibake = (text: string): boolean =>
  /鐩綍|鎻愪緵|绋嬪簭|鍗忚|鍦板潃|鏈嶅姟|绫诲瀷|鐗堟湰|璺緞|搴/.test(text);

class JobManager {
  private readonly jobs = new Map<string, InternalJob>();

  createJob(commandId: string, input: CommandInput): JobSnapshot {
    const runtimeDefinition = getRuntimeDefinition(commandId);

    if (!runtimeDefinition) {
      throw new Error("未知的检测命令。");
    }

    const snapshot: JobSnapshot = {
      jobId: randomUUID(),
      commandId,
      commandTitle: runtimeDefinition.title,
      target: input.target,
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      rawOutput: "",
      structured: {},
      diagnosis: []
    };

    const internalJob: InternalJob = {
      snapshot,
      events: [],
      emitter: new EventEmitter()
    };

    this.jobs.set(snapshot.jobId, internalJob);
    this.runJob(runtimeDefinition.id, input, internalJob);
    this.compactJobs();

    return snapshot;
  }

  getJob(jobId: string): JobSnapshot | undefined {
    return this.jobs.get(jobId)?.snapshot;
  }

  subscribe(jobId: string, onEvent: (event: StreamEvent) => void): (() => void) | undefined {
    const job = this.jobs.get(jobId);

    if (!job) {
      return undefined;
    }

    job.events.forEach((event) => onEvent(event));

    const listener = (event: StreamEvent): void => {
      onEvent(event);
    };

    job.emitter.on("event", listener);

    return () => {
      job.emitter.off("event", listener);
    };
  }

  private emit(job: InternalJob, event: StreamEvent): void {
    job.events.push(event);
    job.emitter.emit("event", event);
  }

  private runJob(commandId: string, input: CommandInput, job: InternalJob): void {
    const runtimeDefinition = getRuntimeDefinition(commandId);

    if (!runtimeDefinition) {
      job.snapshot.status = "failed";
      job.snapshot.endedAt = new Date().toISOString();
      this.emit(job, {
        type: "error",
        payload: { message: "检测命令定义缺失。" }
      });
      this.emit(job, { type: "complete", payload: { job: job.snapshot } });
      return;
    }

    const executable = runtimeDefinition.build(input);
    const commandLine = `${executable.command} ${executable.args.join(" ")}`;

    this.emit(job, {
      type: "start",
      payload: {
        commandLine,
        commandTitle: runtimeDefinition.title,
        target: input.target
      }
    });

    const child = spawn(executable.command, executable.args, {
      windowsHide: true
    });

    let stdoutDecoder = createStreamDecoder();
    let stderrDecoder = createStreamDecoder();
    let stdoutEncoding = isWindows ? windowsEncoding : "utf-8";
    let stderrEncoding = isWindows ? windowsEncoding : "utf-8";

    let finalized = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let decoderFlushed = false;

    const appendDecoded = (stream: "stdout" | "stderr", chunk: string): void => {
      if (!chunk) {
        return;
      }

      job.snapshot.rawOutput += chunk;
      this.emit(job, {
        type: stream === "stdout" ? "log" : "error",
        payload: { chunk, stream }
      });
    };

    const flushDecoders = (): void => {
      if (decoderFlushed) {
        return;
      }

      decoderFlushed = true;
      appendDecoded("stdout", stdoutDecoder.decode());
      appendDecoded("stderr", stderrDecoder.decode());
    };

    const finalize = (status: "completed" | "failed", exitCode: number | null): void => {
      if (finalized) {
        return;
      }

      finalized = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      job.snapshot.status = status;
      job.snapshot.exitCode = exitCode;
      job.snapshot.endedAt = new Date().toISOString();

      this.emit(job, {
        type: "complete",
        payload: {
          job: job.snapshot
        }
      });
    };

    const timeoutMs = Math.max(1000, input.timeoutSeconds * 1000 + 1000);
    timeoutHandle = setTimeout(() => {
      if (finalized) {
        return;
      }

      timedOut = true;
      flushDecoders();

      const parsed = parseCommandOutput(commandId, job.snapshot.rawOutput, null);
      job.snapshot.structured = {
        ...parsed.structured,
        timedOut: true,
        timeoutSeconds: input.timeoutSeconds
      };
      job.snapshot.diagnosis = [
        ...parsed.diagnosis,
        `命令执行超过 ${input.timeoutSeconds} 秒，已被系统终止。`
      ];

      this.emit(job, {
        type: "error",
        payload: { message: `命令执行超时（${input.timeoutSeconds} 秒）。` }
      });

      child.kill();
      finalize("failed", null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      let message = stdoutDecoder.decode(chunk, { stream: true });
      if (
        isWindows &&
        commandId === "lsp_catalog_check" &&
        stdoutEncoding !== "utf-8" &&
        looksLikeLspMojibake(message)
      ) {
        stdoutDecoder = new TextDecoder("utf-8");
        stdoutEncoding = "utf-8";
        message = stdoutDecoder.decode(chunk, { stream: true });
      }
      appendDecoded("stdout", message);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      let message = stderrDecoder.decode(chunk, { stream: true });
      if (
        isWindows &&
        commandId === "lsp_catalog_check" &&
        stderrEncoding !== "utf-8" &&
        looksLikeLspMojibake(message)
      ) {
        stderrDecoder = new TextDecoder("utf-8");
        stderrEncoding = "utf-8";
        message = stderrDecoder.decode(chunk, { stream: true });
      }
      appendDecoded("stderr", message);
    });

    child.on("error", (error) => {
      flushDecoders();
      job.snapshot.diagnosis = ["命令执行失败，请检查本机是否已安装所需网络工具。"];
      this.emit(job, {
        type: "error",
        payload: { message: error.message }
      });
      finalize("failed", null);
    });

    child.on("close", (exitCode) => {
      if (finalized) {
        return;
      }

      flushDecoders();

      const parsed = parseCommandOutput(commandId, job.snapshot.rawOutput, exitCode);
      job.snapshot.structured = {
        ...parsed.structured,
        timedOut
      };
      job.snapshot.diagnosis = parsed.diagnosis;

      finalize(exitCode === 0 ? "completed" : "failed", exitCode);
    });
  }

  private compactJobs(): void {
    if (this.jobs.size <= 50) {
      return;
    }

    const oldest = [...this.jobs.values()]
      .sort((left, right) => left.snapshot.startedAt.localeCompare(right.snapshot.startedAt))
      .slice(0, this.jobs.size - 50);

    oldest.forEach((job) => {
      this.jobs.delete(job.snapshot.jobId);
    });
  }
}

export const jobManager = new JobManager();
