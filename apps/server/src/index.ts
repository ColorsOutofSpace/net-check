import cors from "cors";
import express from "express";
import { z } from "zod";
import { listCommandDefinitions } from "./diagnostics/definitions";
import { jobManager } from "./diagnostics/job-manager";
import {
  defaultRealtimeLatencyTarget,
  getRealtimeAdminCapability,
  realtimeAdminPermissionMessage,
  realtimeMetricsService
} from "./realtime/realtime-metrics";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

const createJobSchema = z.object({
  commandId: z.string().min(1),
  target: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9._:/-]+$/, "目标包含不支持的字符。"),
  count: z.number().int().min(1).max(20).optional(),
  timeoutSeconds: z.number().int().min(1).max(30).optional()
});

const realtimeTargetSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9._:-]+$/, "实时延迟目标格式无效。");

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "net-check-server",
    now: new Date().toISOString()
  });
});

app.get("/api/commands", (_req, res) => {
  res.json({ commands: listCommandDefinitions() });
});

app.post("/api/jobs", (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      message: "请求参数无效。",
      errors: parsed.error.issues
    });
    return;
  }

  try {
    const payload = parsed.data;
    const created = jobManager.createJob(payload.commandId, {
      target: payload.target.trim(),
      count: payload.count ?? 4,
      timeoutSeconds: payload.timeoutSeconds ?? 10
    });

    res.status(201).json({
      jobId: created.jobId,
      job: created
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误。";
    res.status(400).json({ message });
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job) {
    res.status(404).json({ message: "任务不存在。" });
    return;
  }

  res.json({ job });
});

app.get("/api/jobs/:jobId/stream", (req, res) => {
  const { jobId } = req.params;
  const snapshot = jobManager.getJob(jobId);

  if (!snapshot) {
    res.status(404).json({ message: "任务不存在。" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const unsubscribe = jobManager.subscribe(jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    if (event.type === "complete") {
      res.end();
    }
  });

  if (!unsubscribe) {
    res.end();
    return;
  }

  req.on("close", () => {
    if (unsubscribe) {
      unsubscribe();
    }
    res.end();
  });
});

app.get("/api/realtime/access", (_req, res) => {
  const capability = getRealtimeAdminCapability(true);

  if (!capability.ready) {
    res.status(403).json({
      message: realtimeAdminPermissionMessage,
      reason: capability.reason,
      checkedAt: capability.checkedAt
    });
    return;
  }

  res.json({ status: "ok", checkedAt: capability.checkedAt });
});

app.get("/api/realtime/stream", (req, res) => {
  const capability = getRealtimeAdminCapability(true);
  if (!capability.ready) {
    res.status(403).json({
      message: realtimeAdminPermissionMessage,
      reason: capability.reason,
      checkedAt: capability.checkedAt
    });
    return;
  }

  const targetQuery = Array.isArray(req.query.target) ? req.query.target[0] : req.query.target;
  const targetRaw = typeof targetQuery === "string" ? targetQuery.trim() : "";
  let latencyTarget = defaultRealtimeLatencyTarget;

  if (targetRaw.length > 0) {
    const parsed = realtimeTargetSchema.safeParse(targetRaw);
    if (!parsed.success) {
      res.status(400).json({ message: "实时延迟目标格式无效。" });
      return;
    }

    latencyTarget = parsed.data;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const unsubscribe = realtimeMetricsService.subscribe(latencyTarget, (snapshot) => {
    res.write(`data: ${JSON.stringify({ type: "metrics", payload: { snapshot } })}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});

app.listen(port, () => {
  console.log(`[net-check-server] listening on http://localhost:${port}`);
});
