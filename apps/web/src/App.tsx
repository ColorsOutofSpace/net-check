
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createJob, fetchCommands, subscribeJob } from "./api";
import {
  buildSummary,
  hasWarning,
  type LayerDefinition,
  type LayerStatus,
  type WorkflowItem,
  type WorkflowStatus
} from "./analysis";
import { CommandDefinition, JobSnapshot, StreamEvent } from "./types";

type PanelTab = "overview" | "output";

const orderStorageKey = "net-check.one-click-order.v1";
const concurrencyStorageKey = "net-check.one-click-concurrency.v1";
const defaultConcurrency = 4;
const minConcurrency = 1;
const maxConcurrency = 8;
const defaultRunCount = 4;
const defaultTimeoutSeconds = 10;
const sidebarWidthStorageKey = "net-check.sidebar-width.v1";
const defaultSidebarWidth = 340;
const minSidebarWidth = 280;
const maxSidebarWidth = 620;
const minContentWidth = 480;

const clampSidebarWidth = (value: number, viewportWidth?: number): number => {
  const width = Number.isFinite(value) ? Math.floor(value) : defaultSidebarWidth;
  const viewport = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const maxByViewport = Math.max(minSidebarWidth, viewport - minContentWidth);
  return Math.max(minSidebarWidth, Math.min(maxSidebarWidth, Math.min(width, maxByViewport)));
};

const readStoredSidebarWidth = (): number => {
  if (typeof window === "undefined") {
    return defaultSidebarWidth;
  }

  const raw = window.localStorage.getItem(sidebarWidthStorageKey);
  if (!raw) {
    return clampSidebarWidth(defaultSidebarWidth, window.innerWidth);
  }

  return clampSidebarWidth(Number(raw), window.innerWidth);
};

const globalPresetIds = [
  "nic_link_status",
  "nic_ip_config",
  "dhcp_status",
  "default_route_check",
  "gateway_reachability",
  "arp_neighbor_check",
  "dns_server_config",
  "dns_server_probe",
  "hosts_file_check",
  "lsp_catalog_check",
  "ie_proxy_check",
  "proxy_conflict_check",
  "network_env_vars",
  "global_internet_icmp",
  "global_dns_probe"
];

const layerDefinitions: LayerDefinition[] = [
  { id: "adapter", label: "适配器", commandIds: ["nic_link_status", "nic_ip_config", "dhcp_status"] },
  {
    id: "route",
    label: "路由",
    commandIds: ["default_route_check", "gateway_reachability", "arp_neighbor_check", "trace_route"]
  },
  {
    id: "dns",
    label: "DNS",
    commandIds: ["dns_server_config", "dns_server_probe", "hosts_file_check", "dns_lookup", "global_dns_probe"]
  },
  {
    id: "proxy",
    label: "代理",
    commandIds: ["ie_proxy_check", "proxy_conflict_check", "network_env_vars", "lsp_catalog_check"]
  },
  { id: "internet", label: "互联网", commandIds: ["global_internet_icmp", "http_head", "ping_target"] }
];

const buildGlobalPresetOrder = (loaded: CommandDefinition[]): string[] => {
  const available = new Set(loaded.map((command) => command.id));
  return globalPresetIds.filter((id) => available.has(id));
};

const formatDateTime = (value?: string): string => {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
};

const normalizeConcurrency = (value: number): number => {
  if (!Number.isFinite(value)) {
    return defaultConcurrency;
  }
  return Math.max(minConcurrency, Math.min(maxConcurrency, Math.floor(value)));
};

const durationBetween = (startedAt?: string, endedAt?: string): number | undefined => {
  if (!startedAt || !endedAt) {
    return undefined;
  }
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }
  return endMs - startMs;
};

const formatDuration = (durationMs?: number): string => {
  if (durationMs === undefined) {
    return "-";
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
};

const toStatusClass = (status: LayerStatus | WorkflowStatus): string => {
  if (status === "passed") {
    return "completed";
  }
  return status;
};

const formatWorkflowStatus = (status: WorkflowStatus): string => {
  if (status === "pending") {
    return "待执行";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "completed") {
    return "已完成";
  }
  return "失败";
};

const formatLayerStatus = (status: LayerStatus): string => {
  if (status === "pending") {
    return "待执行";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "passed") {
    return "健康";
  }
  if (status === "warning") {
    return "告警";
  }
  return "失败";
};

const App = (): JSX.Element => {
  const [commands, setCommands] = useState<CommandDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCommandId, setSelectedCommandId] = useState<string>("");
  const [activeJob, setActiveJob] = useState<JobSnapshot | null>(null);
  const [output, setOutput] = useState("");
  const [statusMessage, setStatusMessage] = useState("空闲");
  const [activeTab, setActiveTab] = useState<PanelTab>("overview");
  const [oneClickOrder, setOneClickOrder] = useState<string[]>([]);
  const [oneClickConcurrency, setOneClickConcurrency] = useState<number>(defaultConcurrency);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [showOnlyIssues, setShowOnlyIssues] = useState(true);
  const [workflowItems, setWorkflowItems] = useState<WorkflowItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const stopStreamRef = useRef<(() => void) | null>(null);
  const batchStopRefs = useRef<Set<() => void>>(new Set());
  const resizeSessionRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const appendOutput = (text: string): void => {
    setOutput((current) => current + text);
  };

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        const loaded = await fetchCommands();
        setCommands(loaded);

        if (loaded.length > 0) {
          setSelectedCommandId(loaded[0].id);
        }

        const rawOrder = window.localStorage.getItem(orderStorageKey);
        let storedOrder: string[] = [];
        if (rawOrder) {
          try {
            const parsed = JSON.parse(rawOrder) as unknown;
            if (Array.isArray(parsed)) {
              storedOrder = parsed.filter((item): item is string => typeof item === "string");
            }
          } catch {
            storedOrder = [];
          }
        }

        const validStoredOrder = storedOrder.filter((id) => loaded.some((command) => command.id === id));
        setOneClickOrder(validStoredOrder.length > 0 ? validStoredOrder : buildGlobalPresetOrder(loaded));

        const rawConcurrency = window.localStorage.getItem(concurrencyStorageKey);
        const parsedConcurrency = rawConcurrency ? Number(rawConcurrency) : defaultConcurrency;
        setOneClickConcurrency(normalizeConcurrency(parsedConcurrency));
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载命令失败";
        setStatusMessage(message);
      } finally {
        setLoading(false);
      }
    };

    void init();

    return () => {
      if (stopStreamRef.current) {
        stopStreamRef.current();
      }

      batchStopRefs.current.forEach((stop) => stop());
      batchStopRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(orderStorageKey, JSON.stringify(oneClickOrder));
  }, [oneClickOrder]);

  useEffect(() => {
    window.localStorage.setItem(concurrencyStorageKey, String(oneClickConcurrency));
  }, [oneClickConcurrency]);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizingSidebar) {
      document.body.classList.remove("is-resizing-sidebar");
      return;
    }

    document.body.classList.add("is-resizing-sidebar");
    return () => {
      document.body.classList.remove("is-resizing-sidebar");
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const handleResize = (): void => {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const scrollContainers = Array.from(
      document.querySelectorAll<HTMLElement>(".command-list, .workflow-list, .panel, .terminal")
    );
    const hideTimers = new Map<HTMLElement, number>();
    const listeners: Array<{ element: HTMLElement; handler: () => void }> = [];

    scrollContainers.forEach((element) => {
      const handler = (): void => {
        element.classList.add("is-scrolling");
        const currentTimer = hideTimers.get(element);
        if (currentTimer) {
          window.clearTimeout(currentTimer);
        }
        const nextTimer = window.setTimeout(() => {
          element.classList.remove("is-scrolling");
          hideTimers.delete(element);
        }, 720);
        hideTimers.set(element, nextTimer);
      };

      element.addEventListener("scroll", handler, { passive: true });
      listeners.push({ element, handler });
    });

    return () => {
      listeners.forEach(({ element, handler }) => {
        element.removeEventListener("scroll", handler);
        element.classList.remove("is-scrolling");
      });
      hideTimers.forEach((timer) => window.clearTimeout(timer));
      hideTimers.clear();
    };
  }, [activeTab]);

  const oneClickCommands = useMemo(
    () =>
      oneClickOrder
        .map((commandId) => commands.find((command) => command.id === commandId))
        .filter((command): command is CommandDefinition => Boolean(command)),
    [commands, oneClickOrder]
  );

  const commandGroups = useMemo(() => {
    const groups = new Map<string, CommandDefinition[]>();

    commands.forEach((command) => {
      const list = groups.get(command.category) ?? [];
      list.push(command);
      groups.set(command.category, list);
    });

    return [...groups.entries()];
  }, [commands]);

  const visibleWorkflowItems = useMemo(() => {
    if (!showOnlyIssues) {
      return workflowItems;
    }

    return workflowItems.filter(
      (item) => item.status === "failed" || item.timedOut || hasWarning(item)
    );
  }, [showOnlyIssues, workflowItems]);

  const summary = useMemo(() => buildSummary(workflowItems, layerDefinitions), [workflowItems]);

  const resolveTarget = (command: CommandDefinition): string | null => {
    const defaultTarget = command.defaultTarget.trim();
    if (defaultTarget) {
      return defaultTarget;
    }

    if (command.requiresTarget) {
      return null;
    }

    return "localhost";
  };

  const handleEvent = (event: StreamEvent, streamLabel?: string): JobSnapshot | null => {
    const prefix = streamLabel ? `[${streamLabel}] ` : "";

    if (event.type === "start") {
      const line = `${prefix}[start] ${String(event.payload.commandTitle ?? "")}: ${String(event.payload.commandLine ?? "")}\n`;
      appendOutput(line);
      return null;
    }

    if (event.type === "log") {
      const chunk = String(event.payload.chunk ?? "");
      appendOutput(streamLabel ? `${prefix}${chunk}` : chunk);
      return null;
    }

    if (event.type === "error") {
      const chunk = String(event.payload.chunk ?? event.payload.message ?? "");
      appendOutput(`${prefix}[error] ${chunk}${chunk.endsWith("\n") ? "" : "\n"}`);
      return null;
    }

    if (event.type === "complete") {
      const nextJob = event.payload.job as JobSnapshot;
      setActiveJob(nextJob);
      return nextJob;
    }

    return null;
  };

  const executeCommand = async (
    command: CommandDefinition,
    options?: {
      resetOutput?: boolean;
      streamLabel?: string;
      useSingleStopRef?: boolean;
      suppressStatusUpdates?: boolean;
    }
  ): Promise<JobSnapshot> => {
    const runTarget = resolveTarget(command);
    if (!runTarget) {
      throw new Error("该检测项需要填写目标地址。");
    }

    const useSingleStopRef = options?.useSingleStopRef !== false;

    if (useSingleStopRef && stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }

    if (options?.resetOutput) {
      setOutput("");
    }

    setActiveTab("output");
    if (!options?.suppressStatusUpdates) {
      setStatusMessage(`正在运行 ${command.title}...`);
    }

    const response = await createJob({
      commandId: command.id,
      target: runTarget,
      count: defaultRunCount,
      timeoutSeconds: defaultTimeoutSeconds
    });

    setActiveJob(response.job);

    return await new Promise<JobSnapshot>((resolve, reject) => {
      let settled = false;
      let stopWrapper: (() => void) | null = null;

      const cleanup = (): void => {
        if (!stopWrapper) {
          return;
        }

        if (useSingleStopRef) {
          if (stopStreamRef.current === stopWrapper) {
            stopStreamRef.current = null;
          }
        } else {
          batchStopRefs.current.delete(stopWrapper);
        }
      };

      const stop = subscribeJob(
        response.jobId,
        (event) => {
          const completed = handleEvent(event, options?.streamLabel);
          if (!completed) {
            return;
          }

          settled = true;
          stop();
          cleanup();

          if (!options?.suppressStatusUpdates) {
            setStatusMessage(completed.status === "completed" ? "检测完成。" : "检测失败。");
          }

          resolve(completed);
        },
        (error) => {
          const prefix = options?.streamLabel ? `[${options.streamLabel}] ` : "";
          appendOutput(`${prefix}[stream] ${error}\n`);
          if (!options?.suppressStatusUpdates) {
            setStatusMessage("流式连接中断。");
          }

          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(error));
          }
        }
      );

      stopWrapper = () => {
        stop();
        cleanup();

        if (!settled) {
          settled = true;
          reject(new Error("执行已停止。"));
        }
      };

      if (useSingleStopRef) {
        stopStreamRef.current = stopWrapper;
      } else {
        batchStopRefs.current.add(stopWrapper);
      }
    });
  };

  const updateWorkflowItem = (commandId: string, updater: (current: WorkflowItem) => WorkflowItem): void => {
    setWorkflowItems((current) =>
      current.map((item) => (item.commandId === commandId ? updater(item) : item))
    );
  };

  const handleRun = async (command: CommandDefinition): Promise<void> => {
    if (isBatchRunning || isRunningSingle) {
      return;
    }

    const startedAt = new Date().toISOString();
    setWorkflowItems([
      {
        commandId: command.id,
        commandTitle: command.title,
        category: command.category,
        status: "running",
        startedAt,
        timedOut: false,
        diagnosis: [],
        evidence: [],
        structured: {}
      }
    ]);

    try {
      const result = await executeCommand(command, { resetOutput: true });
      const timedOut = result.structured.timedOut === true;
      setWorkflowItems([
        {
          commandId: command.id,
          commandTitle: command.title,
          category: command.category,
          status: result.status,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          durationMs: durationBetween(result.startedAt, result.endedAt),
          timedOut,
          diagnosis: result.diagnosis,
          evidence: result.evidence ?? [],
          structured: result.structured,
          errorMessage: result.status === "failed" ? result.diagnosis[0] : undefined
        }
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行失败";
      const endedAt = new Date().toISOString();
      setWorkflowItems([
        {
          commandId: command.id,
          commandTitle: command.title,
          category: command.category,
          status: "failed",
          startedAt,
          endedAt,
          durationMs: durationBetween(startedAt, endedAt),
          timedOut: false,
          diagnosis: [message],
          evidence: [message],
          structured: {},
          errorMessage: message
        }
      ]);
      setStatusMessage(message);
      appendOutput(`[fatal] ${message}\n`);
    }
  };

  const handleRunOneClick = async (): Promise<void> => {
    if (isBatchRunning || isRunningSingle) {
      return;
    }

    const workflow = oneClickCommands;
    if (workflow.length === 0) {
      setStatusMessage("请至少选择一个一键检测项。");
      return;
    }

    if (stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }

    setIsBatchRunning(true);
    setOutput("");
    setActiveTab("overview");
    setShowOnlyIssues(true);

    const total = workflow.length;
    const concurrency = Math.min(oneClickConcurrency, total);
    setStatusMessage(`正在执行一键检测（共 ${total} 项，并发 ${concurrency}）...`);
    appendOutput(`[流程] 并行执行 ${total} 项检测（最大并发 ${concurrency}）。\n`);

    setWorkflowItems(
      workflow.map((command) => ({
        commandId: command.id,
        commandTitle: command.title,
        category: command.category,
        status: "pending",
        timedOut: false,
        diagnosis: [],
        evidence: [],
        structured: {}
      }))
    );

    let successCount = 0;
    let failedCount = 0;
    let cursor = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;

        if (index >= total) {
          return;
        }

        const command = workflow[index];
        const streamLabel = `${index + 1}/${total} ${command.title}`;
        const startedAt = new Date().toISOString();

        updateWorkflowItem(command.id, (item) => ({
          ...item,
          status: "running",
          startedAt
        }));

        appendOutput(`${index === 0 ? "" : "\n"}========== [${index + 1}/${total}] ${command.title} ==========\n`);

        try {
          const result = await executeCommand(command, {
            streamLabel,
            useSingleStopRef: false,
            suppressStatusUpdates: true
          });

          const timedOut = result.structured.timedOut === true;
          updateWorkflowItem(command.id, (item) => ({
            ...item,
            status: result.status,
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            durationMs: durationBetween(result.startedAt, result.endedAt),
            timedOut,
            diagnosis: result.diagnosis,
            evidence: result.evidence ?? [],
            structured: result.structured,
            errorMessage: result.status === "failed" ? result.diagnosis[0] : undefined
          }));

          if (result.status === "completed") {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        } catch (error) {
          failedCount += 1;
          const message = error instanceof Error ? error.message : "执行失败";
          const endedAt = new Date().toISOString();

          updateWorkflowItem(command.id, (item) => ({
            ...item,
            status: "failed",
            endedAt,
            durationMs: durationBetween(item.startedAt, endedAt),
            diagnosis: [message],
            evidence: [message],
            errorMessage: message
          }));

          appendOutput(`[${streamLabel}] [流程错误] ${message}\n`);
        }
      }
    });

    await Promise.all(workers);

    setStatusMessage(`一键检测完成：成功 ${successCount}/${total}，失败 ${failedCount}。`);
    setIsBatchRunning(false);
  };

  const handleSelectCommand = (command: CommandDefinition): void => {
    setSelectedCommandId(command.id);
  };

  const toggleOneClickItem = (commandId: string): void => {
    setOneClickOrder((current) => {
      if (current.includes(commandId)) {
        return current.filter((id) => id !== commandId);
      }

      return [...current, commandId];
    });
  };

  const moveOneClickItem = (commandId: string, direction: "up" | "down"): void => {
    setOneClickOrder((current) => {
      const index = current.indexOf(commandId);
      if (index < 0) {
        return current;
      }

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const applyGlobalPreset = (): void => {
    setOneClickOrder(buildGlobalPresetOrder(commands));
  };

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeSessionRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    setIsResizingSidebar(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const session = resizeSessionRef.current;
      if (!session) {
        return;
      }

      const deltaX = moveEvent.clientX - session.startX;
      setSidebarWidth(clampSidebarWidth(session.startWidth + deltaX, window.innerWidth));
    };

    const handlePointerUp = (): void => {
      resizeSessionRef.current = null;
      setIsResizingSidebar(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const isRunningSingle = !isBatchRunning && activeJob?.status === "running";
  const statusClass = isBatchRunning ? "running" : activeJob?.status ?? "idle";
  const statusLabel =
    isBatchRunning
      ? "运行中"
      : activeJob?.status === "running"
        ? "运行中"
        : activeJob?.status === "completed"
          ? "已完成"
          : activeJob?.status === "failed"
            ? "失败"
            : "空闲";
  const appShellStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className="app-shell" style={appShellStyle}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-main">
            <h1>网络检测工作台</h1>
            <div className={`job-status ${statusClass}`}>{statusLabel}</div>
          </div>
        </div>

        <div className="workflow-card">
          <div className="workflow-head">
            <h2>一键检测流程</h2>
            <div className="workflow-head-actions">
              <button
                type="button"
                className="workflow-preset"
                onClick={applyGlobalPreset}
                disabled={isBatchRunning || commands.length === 0}
              >
                全局预设
              </button>
              <button
                type="button"
                className="workflow-run"
                onClick={() => void handleRunOneClick()}
                disabled={isBatchRunning || isRunningSingle || oneClickCommands.length === 0}
              >
                {isBatchRunning ? "运行中..." : "运行"}
              </button>
            </div>
          </div>

          <p className="workflow-hint">一键检测会并行执行，并优先显示异常项。</p>

          <div className="workflow-options">
            <label htmlFor="one-click-concurrency">并发数</label>
            <select
              id="one-click-concurrency"
              value={oneClickConcurrency}
              onChange={(event) => setOneClickConcurrency(normalizeConcurrency(Number(event.target.value)))}
              disabled={isBatchRunning}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="workflow-list">
            {oneClickCommands.length === 0 && <div className="empty">暂未选择检测项。</div>}

            {oneClickCommands.map((command, index) => (
              <div key={command.id} className="workflow-item">
                <span>
                  {index + 1}. {command.title}
                </span>
                <div className="workflow-actions">
                  <button
                    type="button"
                    onClick={() => moveOneClickItem(command.id, "up")}
                    disabled={index === 0 || isBatchRunning}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    onClick={() => moveOneClickItem(command.id, "down")}
                    disabled={index === oneClickCommands.length - 1 || isBatchRunning}
                  >
                    下移
                  </button>
                  <button type="button" onClick={() => toggleOneClickItem(command.id)} disabled={isBatchRunning}>
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="command-list">
          {loading && <div className="empty">正在加载命令...</div>}

          {!loading &&
            commandGroups.map(([category, group]) => (
              <section key={category} className="command-group">
                <h2>{category}</h2>

                {group.map((command) => {
                  const selected = command.id === selectedCommandId;
                  const running = isRunningSingle && activeJob?.commandId === command.id;
                  const queued = oneClickOrder.includes(command.id);

                  return (
                    <div
                      key={command.id}
                      className={`command-item ${selected ? "selected" : ""}`}
                      onClick={() => handleSelectCommand(command)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectCommand(command);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="command-main">
                        <strong>{command.title}</strong>
                        <span>{command.description}</span>
                      </div>

                      <div className="command-actions">
                        <button
                          type="button"
                          className="run-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRun(command);
                          }}
                          disabled={isBatchRunning || isRunningSingle}
                        >
                          {running ? "运行中" : "运行"}
                        </button>

                        <button
                          type="button"
                          className={`queue-action ${queued ? "selected" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleOneClickItem(command.id);
                          }}
                          disabled={isBatchRunning}
                        >
                          {queued ? "已添加" : "添加"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
        </div>
      </aside>

      <div
        className={`sidebar-resizer ${isResizingSidebar ? "active" : ""}`}
        role="separator"
        aria-label="调整左右分区宽度"
        aria-orientation="vertical"
        onPointerDown={handleSidebarResizeStart}
        onDoubleClick={() => setSidebarWidth(clampSidebarWidth(defaultSidebarWidth, window.innerWidth))}
      />

      <main className="content">
        <nav className="tabs">
          <button
            type="button"
            className={activeTab === "overview" ? "active" : ""}
            onClick={() => setActiveTab("overview")}
          >
            总览
          </button>
          <button
            type="button"
            className={activeTab === "output" ? "active" : ""}
            onClick={() => setActiveTab("output")}
          >
            实时输出
          </button>
        </nav>

        <section className="panel">
          {activeTab === "overview" && (
            <div className="overview">
              <div className="overview-stats">
                <div className="overview-stat">
                  <span>总数</span>
                  <strong>{summary.total}</strong>
                </div>
                <div className="overview-stat">
                  <span>运行中</span>
                  <strong>{summary.running}</strong>
                </div>
                <div className="overview-stat">
                  <span>失败</span>
                  <strong>{summary.failed}</strong>
                </div>
                <div className="overview-stat">
                  <span>告警</span>
                  <strong>{summary.warnings}</strong>
                </div>
              </div>

              <div className="layer-grid">
                {summary.layers.map((layer) => (
                  <div key={layer.id} className={`layer-card ${toStatusClass(layer.status)}`}>
                    <div className="layer-head">
                      <strong>{layer.label}</strong>
                      <span>{formatLayerStatus(layer.status)}</span>
                    </div>
                    <p>{layer.note}</p>
                  </div>
                ))}
              </div>

              <div className="root-cause-card">
                <h3>主要根因</h3>
                {summary.causes.length === 0 && <div className="empty">请先运行检测。</div>}
                {summary.causes.map((cause) => (
                  <div key={`${cause.title}-${cause.evidence}`} className={`root-cause-item ${cause.severity}`}>
                    <div className="root-cause-title">
                      <strong>{cause.title}</strong>
                      <span>{cause.severity === "high" ? "高" : cause.severity === "medium" ? "中" : "低"}</span>
                    </div>
                    <p>{cause.evidence}</p>
                  </div>
                ))}
              </div>

              <div className="matrix-card">
                <div className="matrix-head">
                  <h3>检测矩阵与诊断建议</h3>
                  <label className="issues-toggle">
                    <input
                      type="checkbox"
                      checked={showOnlyIssues}
                      onChange={(event) => setShowOnlyIssues(event.target.checked)}
                    />
                    仅看异常
                  </label>
                </div>

                <div className="matrix-table">
                  <div className="matrix-row head">
                    <span>检测项</span>
                    <span>状态</span>
                    <span>耗时</span>
                    <span>超时</span>
                    <span>诊断建议</span>
                  </div>

                  {visibleWorkflowItems.length === 0 && <div className="empty">暂无匹配项。</div>}

                  {visibleWorkflowItems.map((item) => {
                    const diagnosisText =
                      item.diagnosis.length > 0
                        ? item.diagnosis.join("；")
                        : item.errorMessage
                          ? item.errorMessage
                          : "-";

                    return (
                      <div key={item.commandId} className="matrix-row">
                        <span>{item.commandTitle}</span>
                        <span className={`matrix-status ${toStatusClass(item.status)}`}>{formatWorkflowStatus(item.status)}</span>
                        <span>{formatDuration(item.durationMs)}</span>
                        <span>{item.timedOut ? "是" : "否"}</span>
                        <span className="matrix-diagnosis">{diagnosisText}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "output" && <pre className="terminal">{output || "等待命令执行..."}</pre>}
        </section>

        <footer className="status-bar">
          <span>{statusMessage}</span>
          <span>
            开始: {formatDateTime(activeJob?.startedAt)} | 结束: {formatDateTime(activeJob?.endedAt)}
          </span>
        </footer>
      </main>
    </div>
  );
};

export default App;
