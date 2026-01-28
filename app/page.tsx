"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* =======================
   GOOGLE SHEETS (NO AUTH)
======================= */

const SHEETS_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbxU6RovW_blp676-YSxvcux6PBZWfhhYhQzDefXfX6ftQvY53UKUh2-PqQH8yPtJ3Df/exec";

/* =======================
   STORAGE KEYS
======================= */

const LS_ZONES_KEY = "cca_obs_zones_v2";
const LS_MARKERS_KEY = "cca_obs_markers_v2";

/* =======================
   TYPES & CONSTANTS
======================= */

type ActivityType =
  | "walking"
  | "sitting"
  | "standing"
  | "socializing"
  | "reading"
  | "computer_work"
  | "equipment_task"
  | "meal"
  | "sleep_rest";

const ACTIVITY: { key: ActivityType; label: string; color: string }[] = [
  { key: "walking", label: "Walking", color: "#1f77b4" },
  { key: "sitting", label: "Sitting", color: "#9467bd" },
  { key: "standing", label: "Standing", color: "#ff7f0e" },
  { key: "socializing", label: "Socializing", color: "#e377c2" },
  { key: "reading", label: "Reading", color: "#2ca02c" },
  { key: "computer_work", label: "Computer work", color: "#17becf" },
  { key: "equipment_task", label: "Equipment / procedure", color: "#8c564b" },
  { key: "meal", label: "Meal / hydration", color: "#bcbd22" },
  { key: "sleep_rest", label: "Rest / sleep", color: "#7f7f7f" },
];

type RoleType =
  | "commander"
  | "pilot"
  | "engineer"
  | "scientist"
  | "medic"
  | "mission_control"
  | "visitor_other";

const ROLES: { key: RoleType; label: string }[] = [
  { key: "commander", label: "Commander" },
  { key: "pilot", label: "Pilot" },
  { key: "engineer", label: "Engineer" },
  { key: "scientist", label: "Scientist" },
  { key: "medic", label: "Medic" },
  { key: "mission_control", label: "Mission control" },
  { key: "visitor_other", label: "Visitor / other" },
];

type Marker = {
  id: string;
  createdAt: number;
  intervalIndex: number;
  intervalLabel: string;

  observerName: string;
  buildingSite: string;

  badgeNumber: string;
  role: RoleType;

  activity: ActivityType;
  isGroup: boolean;

  x: number; // 0..1
  y: number; // 0..1

  zone: string;
  note: string;

  cloudStatus?: "pending" | "ok" | "fail";
  source?: "live" | "import";
};

type ZoneRect = {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  createdAt: number;
};

/* =======================
   HELPERS
======================= */

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatHM(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatHMS(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function formatIntervalLabel(start: Date, durationSeconds: number) {
  const end = new Date(start.getTime() + durationSeconds * 1000);
  return `${formatHM(start)}–${formatHM(end)}`;
}
function csvEscape(value: string) {
  const v = value ?? "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
function rectNormalize(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x1, y1, x2, y2 };
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c !== "\r") {
        cell += c;
      }
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/* =======================
   CLOUD WRITE (Sheets)
======================= */

async function sendToSheets(payload: Record<string, any>) {
  if (!SHEETS_WEBHOOK_URL) throw new Error("Sheets webhook URL missing.");
  await fetch(SHEETS_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return true;
}

/* =======================
   ZONES
======================= */

function zoneForPointFromZones(x: number, y: number, zones: ZoneRect[]): string {
  for (const z of zones) if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return z.name;
  return "Unassigned";
}

function zoneColorByIndex(i: number) {
  // Soft, readable fills (cycled)
  const palette = [
    "rgba(59,130,246,0.14)", // blue
    "rgba(16,185,129,0.14)", // green
    "rgba(245,158,11,0.16)", // amber
    "rgba(236,72,153,0.14)", // pink
    "rgba(168,85,247,0.14)", // purple
    "rgba(14,165,233,0.14)", // cyan
    "rgba(239,68,68,0.12)",  // red
    "rgba(99,102,241,0.14)", // indigo
  ];
  return palette[i % palette.length];
}

/* =======================
   HEATMAP (GRID)
======================= */

type HeatCell = { gx: number; gy: number; count: number; norm: number };

function buildHeatmapGrid(points: { x: number; y: number }[], grid: number): HeatCell[] {
  const g = Math.max(5, Math.min(200, Math.floor(grid)));
  const counts = new Map<number, number>();

  for (const p of points) {
    const gx = Math.max(0, Math.min(g - 1, Math.floor(p.x * g)));
    const gy = Math.max(0, Math.min(g - 1, Math.floor(p.y * g)));
    const key = gy * g + gx;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);

  const cells: HeatCell[] = [];
  for (const [key, count] of counts.entries()) {
    const gy = Math.floor(key / g);
    const gx = key % g;
    const norm = max > 0 ? count / max : 0;
    cells.push({ gx, gy, count, norm });
  }

  return cells;
}

/* =======================
   UI STYLES
======================= */

const styles = {
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d0d5dd",
    outline: "none",
    fontSize: 14,
    background: "#fff",
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d0d5dd",
    outline: "none",
    fontSize: 14,
    background: "#fff",
  } as React.CSSProperties,
  buttonPrimary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  } as React.CSSProperties,
  buttonSecondary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d0d5dd",
    background: "#fff",
    color: "#111",
    fontWeight: 800,
    cursor: "pointer",
  } as React.CSSProperties,
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #d0d5dd",
    background: "#fff",
    fontSize: 12,
    fontWeight: 800,
  } as React.CSSProperties,
};

/* =======================
   MAIN COMPONENT
======================= */

type Tab = "collect" | "review";

export default function Page() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<Tab>("collect");

  // Session settings
  const [observerName, setObserverName] = useState("Observer 1");
  const [buildingSite, setBuildingSite] = useState("Habitat A");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const intervalSeconds = useMemo(() => Math.max(1, intervalMinutes * 60), [intervalMinutes]);

  // Current “recording” state
  const [badgeNumber, setBadgeNumber] = useState("");
  const [role, setRole] = useState<RoleType>("pilot");
  const [activity, setActivity] = useState<ActivityType>("walking");
  const [isGroup, setIsGroup] = useState(false);
  const [note, setNote] = useState("");

  // Timer
  const [isRunning, setIsRunning] = useState(false);
  const [intervalIndex, setIntervalIndex] = useState(0);
  const [intervalStart, setIntervalStart] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(intervalSeconds);

  // Data
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [lastRecorded, setLastRecorded] = useState<string>("");

  // Zones
  const [zones, setZones] = useState<ZoneRect[]>([]);

  // Auto-send
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [sendLoopStatus, setSendLoopStatus] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [lastSendAt, setLastSendAt] = useState<number | null>(null);

  // Review tools
  const [importMode, setImportMode] = useState<"replace" | "append">("replace");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filters
  const [filterBadge, setFilterBadge] = useState("");
  const [filterRole, setFilterRole] = useState<RoleType | "all">("all");
  const [filterActivity, setFilterActivity] = useState<ActivityType | "all">("all");
  const [filterGroupOnly, setFilterGroupOnly] = useState(false);

  // Playback
  const [playbackEnabled, setPlaybackEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 4 | 8>(2);
  const [playbackPos, setPlaybackPos] = useState(1000);

  // Zone editor
  const [zoneEditorOn, setZoneEditorOn] = useState(false);
  const [zoneDraftName, setZoneDraftName] = useState("New Zone");
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragNow, setDragNow] = useState<{ x: number; y: number } | null>(null);

  // Heatmap controls (Review)
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [heatGrid, setHeatGrid] = useState(60);
  const [heatStrength, setHeatStrength] = useState(0.55); // opacity multiplier 0..1

  // Load persisted zones + markers
  useEffect(() => {
    try {
      const rawZ = localStorage.getItem(LS_ZONES_KEY);
      if (rawZ) {
        const parsed = JSON.parse(rawZ) as ZoneRect[];
        if (Array.isArray(parsed)) setZones(parsed);
      }
    } catch {}
    try {
      const rawM = localStorage.getItem(LS_MARKERS_KEY);
      if (rawM) {
        const parsed = JSON.parse(rawM) as Marker[];
        if (Array.isArray(parsed)) setMarkers(parsed);
      }
    } catch {}
  }, []);

  // Persist zones + markers
  useEffect(() => {
    try {
      localStorage.setItem(LS_ZONES_KEY, JSON.stringify(zones));
    } catch {}
  }, [zones]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MARKERS_KEY, JSON.stringify(markers));
    } catch {}
  }, [markers]);

  // Keep timeLeft synced when not running
  useEffect(() => {
    if (!isRunning) setTimeLeft(intervalSeconds);
  }, [intervalSeconds, isRunning]);

  // Timer tick
  useEffect(() => {
    if (!isRunning || intervalStart === null) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - intervalStart) / 1000);
      if (elapsed >= intervalSeconds) {
        setIntervalIndex((i) => i + 1);
        setIntervalStart((prev) => (prev === null ? Date.now() : prev + intervalSeconds * 1000));
        setTimeLeft(intervalSeconds);
      } else {
        setTimeLeft(intervalSeconds - elapsed);
      }
    }, 250);
    return () => clearInterval(id);
  }, [isRunning, intervalStart, intervalSeconds]);

  const intervalLabel = useMemo(() => {
    if (!intervalStart) return "—";
    return formatIntervalLabel(new Date(intervalStart), intervalSeconds);
  }, [intervalStart, intervalSeconds]);

  const timerText = useMemo(() => {
    const mm = Math.floor(timeLeft / 60);
    const ss = timeLeft % 60;
    return `${mm}:${pad2(ss)}`;
  }, [timeLeft]);

  const selectedActivityMeta = useMemo(
    () => ACTIVITY.find((a) => a.key === activity)!,
    [activity]
  );

  // Sorted markers
  const markersSorted = useMemo(() => [...markers].sort((a, b) => a.createdAt - b.createdAt), [markers]);

  // Playback window
  const playbackWindow = useMemo(() => {
    if (markersSorted.length === 0) return null;
    return { minT: markersSorted[0].createdAt, maxT: markersSorted[markersSorted.length - 1].createdAt };
  }, [markersSorted]);

  const playbackCutoffTime = useMemo(() => {
    if (!playbackWindow) return null;
    const { minT, maxT } = playbackWindow;
    return minT + ((maxT - minT) * playbackPos) / 1000;
  }, [playbackWindow, playbackPos]);

  useEffect(() => {
    if (!playbackEnabled || !isPlaying) return;
    if (!playbackWindow) return;

    const { minT, maxT } = playbackWindow;
    const total = Math.max(1, maxT - minT);
    const stepMs = 120 * playbackSpeed;

    const id = setInterval(() => {
      setPlaybackPos((p) => {
        const currentT = minT + (total * p) / 1000;
        const nextT = currentT + stepMs;
        const nextP = Math.round(((nextT - minT) / total) * 1000);
        if (nextP >= 1000) {
          setIsPlaying(false);
          return 1000;
        }
        return Math.max(0, Math.min(1000, nextP));
      });
    }, 120);

    return () => clearInterval(id);
  }, [playbackEnabled, isPlaying, playbackSpeed, playbackWindow]);

  useEffect(() => {
    if (playbackEnabled) setPlaybackPos(1000);
    setIsPlaying(false);
  }, [playbackEnabled]);

  // Auto-send loop (1 per second)
  useEffect(() => {
    if (!autoSendEnabled) return;

    const id = window.setInterval(async () => {
      const candidate = markersSorted.find(
        (m) => (m.source ?? "live") !== "import" && (m.cloudStatus === "pending" || m.cloudStatus === "fail")
      );

      if (!candidate) {
        setSendLoopStatus("idle");
        return;
      }

      setSendLoopStatus("sending");
      try {
        await sendToSheets({
          created_at_iso: new Date(candidate.createdAt).toISOString(),
          observer: candidate.observerName,
          site: candidate.buildingSite,
          interval_minutes: intervalMinutes,
          interval_index: candidate.intervalIndex,
          interval_label: candidate.intervalLabel,
          badge: candidate.badgeNumber,
          role: candidate.role,
          activity: candidate.activity,
          group: candidate.isGroup,
          x_norm: candidate.x,
          y_norm: candidate.y,
          zone: candidate.zone,
          note: candidate.note,
        });

        setMarkers((prev) => {
          const copy = [...prev];
          const i = copy.findIndex((m) => m.id === candidate.id);
          if (i >= 0) copy[i] = { ...copy[i], cloudStatus: "ok" };
          return copy;
        });

        setSendLoopStatus("ok");
        setLastSendAt(Date.now());
      } catch {
        setMarkers((prev) => {
          const copy = [...prev];
          const i = copy.findIndex((m) => m.id === candidate.id);
          if (i >= 0) copy[i] = { ...copy[i], cloudStatus: "fail" };
          return copy;
        });
        setSendLoopStatus("fail");
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [autoSendEnabled, markersSorted, intervalMinutes]);

  // Controls
  function start() {
    const now = Date.now();
    setIntervalStart(now);
    setIntervalIndex(0);
    setTimeLeft(intervalSeconds);
    setIsRunning(true);
    setStatusMsg("");
  }
  function pauseResume() {
    if (!isRunning) {
      const now = Date.now();
      setIntervalStart(now);
      setTimeLeft(intervalSeconds);
      setIsRunning(true);
      setStatusMsg("");
    } else {
      setIsRunning(false);
      setStatusMsg("Paused");
    }
  }
  function reset() {
    setIsRunning(false);
    setIntervalStart(null);
    setIntervalIndex(0);
    setTimeLeft(intervalSeconds);
    setMarkers([]);
    setStatusMsg("Reset");
    setLastRecorded("");
    setIsPlaying(false);
    setPlaybackEnabled(false);
    setPlaybackPos(1000);
  }

  function exportCSV() {
    const header = [
      "created_at_iso",
      "observer",
      "site",
      "interval_minutes",
      "interval_index",
      "interval_label",
      "badge",
      "role",
      "activity",
      "group",
      "x_norm",
      "y_norm",
      "zone",
      "note",
      "cloud_status",
      "source",
    ];

    const rows = markers.map((m) => {
      return [
        new Date(m.createdAt).toISOString(),
        m.observerName,
        m.buildingSite,
        String(intervalMinutes),
        String(m.intervalIndex),
        m.intervalLabel,
        m.badgeNumber,
        m.role,
        m.activity,
        m.isGroup ? "1" : "0",
        m.x.toFixed(6),
        m.y.toFixed(6),
        m.zone,
        m.note ?? "",
        m.cloudStatus ?? "",
        m.source ?? "live",
      ].map(csvEscape);
    });

    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mission_observations_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function onPickCSV() {
    fileInputRef.current?.click();
  }

  async function handleImportCSV(file: File) {
    setStatusMsg("");
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) return setStatusMsg("CSV looks empty.");

      const header = rows[0].map((h) => h.trim());
      const idx = (name: string) => header.indexOf(name);

      const required = [
        "created_at_iso",
        "observer",
        "site",
        "interval_minutes",
        "interval_index",
        "interval_label",
        "badge",
        "role",
        "activity",
        "group",
        "x_norm",
        "y_norm",
        "zone",
        "note",
      ];
      const missing = required.filter((k) => idx(k) === -1);
      if (missing.length) return setStatusMsg(`CSV missing columns: ${missing.join(", ")}`);

      const roleKeys = new Set(ROLES.map((r) => r.key));
      const activityKeys = new Set(ACTIVITY.map((a) => a.key));

      const imported: Marker[] = rows.slice(1).map((r) => {
        const createdAt = Date.parse(r[idx("created_at_iso")] || "") || Date.now();
        const x = Number(r[idx("x_norm")] || 0);
        const y = Number(r[idx("y_norm")] || 0);

        const roleRaw = (r[idx("role")] || "pilot") as RoleType;
        const activityRaw = (r[idx("activity")] || "walking") as ActivityType;

        const safeRole: RoleType = roleKeys.has(roleRaw) ? roleRaw : "visitor_other";
        const safeActivity: ActivityType = activityKeys.has(activityRaw) ? activityRaw : "walking";

        const groupStr = String(r[idx("group")] || "").trim();
        const isGroup = groupStr === "1" || groupStr.toLowerCase() === "true";

        return {
          id: uid(),
          createdAt,
          intervalIndex: Number(r[idx("interval_index")] || 0),
          intervalLabel: r[idx("interval_label")] || "—",
          observerName: r[idx("observer")] || "Observer 1",
          buildingSite: r[idx("site")] || "Habitat A",
          badgeNumber: r[idx("badge")] || "",
          role: safeRole,
          activity: safeActivity,
          isGroup,
          x: clamp01(isFinite(x) ? x : 0),
          y: clamp01(isFinite(y) ? y : 0),
          zone: r[idx("zone")] || zoneForPointFromZones(x, y, zones),
          note: r[idx("note")] || "",
          cloudStatus: "ok",
          source: "import",
        };
      });

      if (importMode === "replace") setMarkers(imported);
      else setMarkers((prev) => [...prev, ...imported]);

      setPlaybackEnabled(true);
      setPlaybackPos(1000);
      setIsPlaying(false);
      setStatusMsg(`Loaded ${imported.length} markers from CSV (${importMode}).`);
      setTab("review");
    } catch (err: any) {
      setStatusMsg(`Import failed: ${String(err)}`);
    }
  }

  // Main click handler (collect)
  function handleCollectClick(e: React.MouseEvent) {
    setStatusMsg("");
    if (!isRunning || intervalStart === null) return setStatusMsg("Press Start to begin recording.");
    if (!badgeNumber.trim()) return setStatusMsg("Enter a badge number before recording.");

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);

    const zone = zoneForPointFromZones(x, y, zones);

    const base: Marker = {
      id: uid(),
      createdAt: Date.now(),
      intervalIndex,
      intervalLabel,
      observerName,
      buildingSite,
      badgeNumber: badgeNumber.trim(),
      role,
      activity,
      isGroup,
      x,
      y,
      zone,
      note,
      cloudStatus: autoSendEnabled ? "pending" : "fail",
      source: "live",
    };

    setMarkers((prev) => [...prev, base]);
    setLastRecorded(
      `Recorded: badge ${base.badgeNumber} · ${ROLES.find((r) => r.key === base.role)?.label} · ${
        ACTIVITY.find((a) => a.key === base.activity)?.label
      } · ${base.zone}`
    );
  }

  // Review pipeline: filters + playback
  const filteredMarkers = useMemo(() => {
    const badgeQ = filterBadge.trim().toLowerCase();
    return markersSorted.filter((m) => {
      if (filterRole !== "all" && m.role !== filterRole) return false;
      if (filterActivity !== "all" && m.activity !== filterActivity) return false;
      if (filterGroupOnly && !m.isGroup) return false;
      if (badgeQ && !(m.badgeNumber || "").toLowerCase().includes(badgeQ)) return false;
      return true;
    });
  }, [markersSorted, filterBadge, filterRole, filterActivity, filterGroupOnly]);

  const reviewMarkers = useMemo(() => {
    if (!playbackEnabled || !playbackCutoffTime) return filteredMarkers;
    return filteredMarkers.filter((m) => m.createdAt <= playbackCutoffTime);
  }, [filteredMarkers, playbackEnabled, playbackCutoffTime]);

  const thisIntervalCount = useMemo(
    () => markers.filter((m) => m.intervalIndex === intervalIndex).length,
    [markers, intervalIndex]
  );

  const playbackLabel = useMemo(() => {
    if (!playbackEnabled || !playbackWindow || playbackCutoffTime === null) return null;
    return `Playback time: ${formatHMS(new Date(playbackCutoffTime))}`;
  }, [playbackEnabled, playbackWindow, playbackCutoffTime]);

  const legendCounts = useMemo(() => {
    const byActivity = new Map<ActivityType, number>();
    for (const a of ACTIVITY) byActivity.set(a.key, 0);
    for (const m of reviewMarkers) byActivity.set(m.activity, (byActivity.get(m.activity) || 0) + 1);
    return { byActivity, total: reviewMarkers.length };
  }, [reviewMarkers]);

  function clearFilters() {
    setFilterBadge("");
    setFilterRole("all");
    setFilterActivity("all");
    setFilterGroupOnly(false);
  }

  // Heatmap computed from reviewMarkers (after filters + playback)
  const heatCells = useMemo(() => {
    if (!(tab === "review" && heatmapOn)) return [];
    const pts = reviewMarkers.map((m) => ({ x: m.x, y: m.y }));
    return buildHeatmapGrid(pts, heatGrid);
  }, [tab, heatmapOn, heatGrid, reviewMarkers]);

  // Zone drawing helpers
  function planPointFromEvent(e: React.MouseEvent) {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    return { x, y };
  }

  function onPlanMouseDown(e: React.MouseEvent) {
    if (!(tab === "review" && zoneEditorOn)) return;
    const p = planPointFromEvent(e);
    if (!p) return;
    setIsDrawingZone(true);
    setDragStart(p);
    setDragNow(p);
  }

  function onPlanMouseMove(e: React.MouseEvent) {
    if (!(tab === "review" && zoneEditorOn && isDrawingZone)) return;
    const p = planPointFromEvent(e);
    if (!p) return;
    setDragNow(p);
  }

  function onPlanMouseUp() {
    if (!(tab === "review" && zoneEditorOn && isDrawingZone && dragStart && dragNow)) {
      setIsDrawingZone(false);
      setDragStart(null);
      setDragNow(null);
      return;
    }

    const r = rectNormalize(dragStart, dragNow);
    const minSize = 0.01;
    if (r.x2 - r.x1 < minSize || r.y2 - r.y1 < minSize) {
      setIsDrawingZone(false);
      setDragStart(null);
      setDragNow(null);
      return;
    }

    const name = (zoneDraftName || "Zone").trim();
    const newZone: ZoneRect = {
      id: uid(),
      name,
      x1: r.x1,
      y1: r.y1,
      x2: r.x2,
      y2: r.y2,
      createdAt: Date.now(),
    };
    setZones((prev) => [newZone, ...prev]);
    setIsDrawingZone(false);
    setDragStart(null);
    setDragNow(null);
  }

  function deleteZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id));
  }

  function recomputeZonesForAllMarkers() {
    setMarkers((prev) =>
      prev.map((m) => ({
        ...m,
        zone: zoneForPointFromZones(m.x, m.y, zones),
      }))
    );
    setStatusMsg("Recomputed zones for all markers using current zone rectangles.");
  }

  function cloudBadgeText() {
    if (!autoSendEnabled) return "Auto-send: OFF";
    if (sendLoopStatus === "sending") return "Auto-send: sending…";
    if (sendLoopStatus === "ok") return "Auto-send: OK";
    if (sendLoopStatus === "fail") return "Auto-send: FAIL (retrying)";
    return "Auto-send: idle";
  }

  // Dots: Collect shows all; Review shows reviewMarkers
  const markersToRender = tab === "collect" ? markersSorted : reviewMarkers;

  // Zone overlay toggles (Review)
  const [showZonesFill, setShowZonesFill] = useState(true);
  const [showZonesOutline, setShowZonesOutline] = useState(true);
  const [showZoneLabels, setShowZoneLabels] = useState(false);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "#111", paddingBottom: 84 }}>
      {/* HEADER */}
      <header
        style={{
          borderBottom: "1px solid #e5e7eb",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <img src="/logoCCAweb.png" alt="CCA logo" style={{ height: 46 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Analogue Mission Observation Mapper</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>University of Cambridge</div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={styles.pill}>Tab: {tab === "collect" ? "Collect" : "Review"}</span>
          <span style={styles.pill}>Markers: {markers.length}</span>
          <span style={styles.pill}>{cloudBadgeText()}</span>
          {lastSendAt ? <span style={styles.pill}>Last send: {formatHMS(new Date(lastSendAt))}</span> : null}
        </div>
      </header>

      <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
        {/* ===== COLLECT TAB ===== */}
        {tab === "collect" && (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 14,
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.2fr 0.8fr 1.8fr",
                gap: 12,
                alignItems: "end",
              }}
            >
              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Observer</div>
                <select style={styles.select} value={observerName} onChange={(e) => setObserverName(e.target.value)}>
                  <option>Observer 1</option>
                  <option>Observer 2</option>
                  <option>Observer 3</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Site</div>
                <select style={styles.select} value={buildingSite} onChange={(e) => setBuildingSite(e.target.value)}>
                  <option>Habitat A</option>
                  <option>Habitat B</option>
                  <option>Control Room</option>
                  <option>Lab Module</option>
                  <option>Airlock / EVA Prep</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Interval (min)</div>
                <input
                  style={styles.input}
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  disabled={isRunning}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value || 5))}
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button style={styles.buttonPrimary} onClick={start}>
                  Start
                </button>
                <button style={styles.buttonSecondary} onClick={pauseResume}>
                  {isRunning ? "Pause" : "Resume"}
                </button>
                <button style={styles.buttonSecondary} onClick={exportCSV} disabled={!markers.length}>
                  Export CSV
                </button>
                <button
                  style={{
                    ...styles.buttonSecondary,
                    borderColor: autoSendEnabled ? "#111" : "#d0d5dd",
                    background: autoSendEnabled ? "#111" : "#fff",
                    color: autoSendEnabled ? "#fff" : "#111",
                  }}
                  onClick={() => setAutoSendEnabled((v) => !v)}
                >
                  Auto-send {autoSendEnabled ? "ON" : "OFF"}
                </button>
                <button style={styles.buttonSecondary} onClick={reset}>
                  Reset
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr auto",
                gap: 12,
                marginTop: 12,
                alignItems: "end",
              }}
            >
              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Badge number (shadowed person)</div>
                <input
                  style={styles.input}
                  value={badgeNumber}
                  onChange={(e) => setBadgeNumber(e.target.value)}
                  placeholder="e.g., 014"
                />
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Role</div>
                <select style={styles.select} value={role} onChange={(e) => setRole(e.target.value as RoleType)}>
                  {ROLES.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Note (optional)</div>
                <input
                  style={styles.input}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., pre-EVA checklist / quiet reading"
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} />
                Group
              </label>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Activity</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ACTIVITY.map((a) => {
                  const selected = a.key === activity;
                  return (
                    <button
                      key={a.key}
                      onClick={() => setActivity(a.key)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 999,
                        border: selected ? "2px solid #111" : "1px solid #d0d5dd",
                        background: selected ? "#111" : "#fff",
                        color: selected ? "#fff" : "#111",
                        fontWeight: 900,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: a.color,
                          outline: selected ? "2px solid rgba(255,255,255,0.7)" : "none",
                        }}
                      />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 13 }}>
              <span style={{ fontWeight: 900 }}>
                Interval: {intervalLabel} · Time left: {timerText} · Markers: {markers.length} · This interval:{" "}
                {thisIntervalCount}
              </span>
              {statusMsg ? (
                <span style={{ marginLeft: 10, color: "#b42318", fontWeight: 900 }}>
                  {statusMsg}
                </span>
              ) : null}
              {lastRecorded ? <div style={{ marginTop: 6, opacity: 0.8 }}>{lastRecorded}</div> : null}
            </div>
          </div>
        )}

        {/* ===== REVIEW TAB ===== */}
        {tab === "review" && (
          <>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 14,
                background: "#fff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={styles.buttonSecondary} onClick={exportCSV} disabled={!markers.length}>
                    Export CSV
                  </button>

                  <button style={styles.buttonSecondary} onClick={onPickCSV}>
                    Load CSV (replay)
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImportCSV(f);
                      if (e.target) e.target.value = "";
                    }}
                  />

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span style={{ opacity: 0.75 }}>Import mode</span>
                    <select
                      style={{ ...styles.select, width: 160, padding: "8px 10px" }}
                      value={importMode}
                      onChange={(e) => setImportMode(e.target.value as any)}
                    >
                      <option value="replace">Replace</option>
                      <option value="append">Append</option>
                    </select>
                  </label>

                  <button
                    style={styles.buttonSecondary}
                    onClick={() => {
                      setPlaybackEnabled((v) => !v);
                      setIsPlaying(false);
                    }}
                  >
                    Playback {playbackEnabled ? "ON" : "OFF"}
                  </button>

                  <button style={styles.buttonSecondary} onClick={recomputeZonesForAllMarkers} disabled={!zones.length}>
                    Recompute zones
                  </button>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Heatmap + zones are based on filtered markers (and playback if enabled).
                </div>
              </div>

              {/* Playback row */}
              {playbackEnabled && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid #eef2f7",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    style={styles.buttonSecondary}
                    onClick={() => setIsPlaying((p) => !p)}
                    disabled={markersSorted.length === 0}
                  >
                    {isPlaying ? "Pause replay" : "Play replay"}
                  </button>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span style={{ opacity: 0.75 }}>Speed</span>
                    <select
                      style={{ ...styles.select, width: 110, padding: "8px 10px" }}
                      value={playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(Number(e.target.value) as any)}
                    >
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                      <option value={4}>4×</option>
                      <option value={8}>8×</option>
                    </select>
                  </label>

                  <button
                    style={styles.buttonSecondary}
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackPos(0);
                    }}
                    disabled={markersSorted.length === 0}
                  >
                    Rewind
                  </button>

                  <button
                    style={styles.buttonSecondary}
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackPos(1000);
                    }}
                    disabled={markersSorted.length === 0}
                  >
                    End
                  </button>

                  <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
                    {playbackLabel ?? "Playback: no data yet."}
                  </div>

                  <div style={{ width: "100%" }}>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      value={playbackPos}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setPlaybackPos(Number(e.target.value));
                      }}
                      style={{ width: "100%" }}
                      disabled={markersSorted.length === 0}
                    />
                  </div>
                </div>
              )}

              {/* Filters */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f7" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 900, fontSize: 13 }}>Filters</div>
                  <button style={styles.buttonSecondary} onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr auto",
                    gap: 12,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Badge contains</div>
                    <input
                      style={styles.input}
                      value={filterBadge}
                      onChange={(e) => setFilterBadge(e.target.value)}
                      placeholder="e.g., 014"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Role</div>
                    <select style={styles.select} value={filterRole} onChange={(e) => setFilterRole(e.target.value as any)}>
                      <option value="all">All roles</option>
                      {ROLES.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Activity</div>
                    <select
                      style={styles.select}
                      value={filterActivity}
                      onChange={(e) => setFilterActivity(e.target.value as any)}
                    >
                      <option value="all">All activities</option>
                      {ACTIVITY.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                    <input type="checkbox" checked={filterGroupOnly} onChange={(e) => setFilterGroupOnly(e.target.checked)} />
                    Group only
                  </label>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={styles.pill}>Showing: {reviewMarkers.length}</span>
                  <span style={styles.pill}>Total stored: {markers.length}</span>
                  <span style={styles.pill}>Zones: {zones.length}</span>
                </div>
              </div>

              {/* Heatmap + zone overlay controls */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f7" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    style={{
                      ...styles.buttonSecondary,
                      borderColor: heatmapOn ? "#111" : "#d0d5dd",
                      background: heatmapOn ? "#111" : "#fff",
                      color: heatmapOn ? "#fff" : "#111",
                    }}
                    onClick={() => setHeatmapOn((v) => !v)}
                  >
                    Heatmap {heatmapOn ? "ON" : "OFF"}
                  </button>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span style={{ opacity: 0.75 }}>Grid</span>
                    <input
                      type="range"
                      min={20}
                      max={120}
                      value={heatGrid}
                      onChange={(e) => setHeatGrid(Number(e.target.value))}
                    />
                    <span style={{ width: 34, textAlign: "right" }}>{heatGrid}</span>
                  </label>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span style={{ opacity: 0.75 }}>Strength</span>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={heatStrength}
                      onChange={(e) => setHeatStrength(Number(e.target.value))}
                    />
                    <span style={{ width: 42, textAlign: "right" }}>{heatStrength.toFixed(2)}</span>
                  </label>

                  <button
                    style={{
                      ...styles.buttonSecondary,
                      borderColor: showZonesFill ? "#111" : "#d0d5dd",
                      background: showZonesFill ? "#111" : "#fff",
                      color: showZonesFill ? "#fff" : "#111",
                    }}
                    onClick={() => setShowZonesFill((v) => !v)}
                  >
                    Zones fill {showZonesFill ? "ON" : "OFF"}
                  </button>

                  <button
                    style={{
                      ...styles.buttonSecondary,
                      borderColor: showZonesOutline ? "#111" : "#d0d5dd",
                      background: showZonesOutline ? "#111" : "#fff",
                      color: showZonesOutline ? "#fff" : "#111",
                    }}
                    onClick={() => setShowZonesOutline((v) => !v)}
                  >
                    Zone outline {showZonesOutline ? "ON" : "OFF"}
                  </button>

                  <button
                    style={{
                      ...styles.buttonSecondary,
                      borderColor: showZoneLabels ? "#111" : "#d0d5dd",
                      background: showZoneLabels ? "#111" : "#fff",
                      color: showZoneLabels ? "#fff" : "#111",
                    }}
                    onClick={() => setShowZoneLabels((v) => !v)}
                  >
                    Labels {showZoneLabels ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              {/* Zone editor */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f7" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    style={{
                      ...styles.buttonSecondary,
                      borderColor: zoneEditorOn ? "#111" : "#d0d5dd",
                      background: zoneEditorOn ? "#111" : "#fff",
                      color: zoneEditorOn ? "#fff" : "#111",
                    }}
                    onClick={() => {
                      setZoneEditorOn((v) => !v);
                      setIsDrawingZone(false);
                      setDragStart(null);
                      setDragNow(null);
                    }}
                  >
                    Zone editor {zoneEditorOn ? "ON" : "OFF"}
                  </button>

                  <div style={{ width: 260 }}>
                    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Zone name for next rectangle</div>
                    <input
                      style={styles.input}
                      value={zoneDraftName}
                      onChange={(e) => setZoneDraftName(e.target.value)}
                      placeholder="e.g., Lab / Galley / EVA prep"
                      disabled={!zoneEditorOn}
                    />
                  </div>

                  <span style={{ fontSize: 12, opacity: 0.75 }}>When ON: drag on the plan to create zone rectangles.</span>
                </div>

                {zones.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Zones</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {zones
                        .slice()
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((z, idx) => (
                          <div
                            key={z.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              border: "1px solid #e5e7eb",
                              borderRadius: 10,
                              padding: "8px 10px",
                              fontSize: 12,
                              gap: 10,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: 4,
                                  background: zoneColorByIndex(idx),
                                  border: "1px solid rgba(0,0,0,0.25)",
                                }}
                              />
                              <div>
                                <b>{z.name}</b>{" "}
                                <span style={{ opacity: 0.7 }}>
                                  ({z.x1.toFixed(3)},{z.y1.toFixed(3)})–({z.x2.toFixed(3)},{z.y2.toFixed(3)})
                                </span>
                              </div>
                            </div>

                            <button style={styles.buttonSecondary} onClick={() => deleteZone(z.id)}>
                              Delete
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div
              style={{
                marginTop: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 12,
                background: "#fff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Legend</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                {ACTIVITY.map((a) => (
                  <span
                    key={a.key}
                    style={{
                      display: "inline-flex",
                      gap: 8,
                      alignItems: "center",
                      border: "1px solid #e5e7eb",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                    title={`${a.label} (${legendCounts.byActivity.get(a.key) || 0})`}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: a.color }} />
                    {a.label} ({legendCounts.byActivity.get(a.key) || 0})
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
                <span>
                  <b>Dot ring</b>: green = cloud ok, red = cloud fail, white = pending
                </span>
                <span>
                  <b>Heatmap</b>: grid-based density from filtered markers (strength & grid adjustable)
                </span>
                <span>
                  <b>Zones</b>: colored rectangles (fill + outline toggles)
                </span>
              </div>
            </div>
          </>
        )}

        {/* PLAN CARD (shared) */}
        <div
          style={{
            marginTop: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            overflow: "hidden",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid #eef2f7", fontSize: 13 }}>
            <b>Plan</b> · Mode: <b>{tab === "collect" ? "Collect" : "Review"}</b>{" "}
            {tab === "collect" ? (
              <>
                · Click to record. Selected activity: <b>{selectedActivityMeta.label}</b>
              </>
            ) : (
              <>
                · Showing filtered markers {playbackEnabled ? "(with playback)" : ""}{" "}
                {zoneEditorOn ? "· Zone editor ON (drag to create rectangles)" : ""}
              </>
            )}
          </div>

          <div
            ref={containerRef}
            onClick={(e) => {
              if (tab === "collect") handleCollectClick(e);
            }}
            onMouseDown={tab === "review" && zoneEditorOn ? onPlanMouseDown : undefined}
            onMouseMove={tab === "review" && zoneEditorOn ? onPlanMouseMove : undefined}
            onMouseUp={tab === "review" && zoneEditorOn ? onPlanMouseUp : undefined}
            style={{
              position: "relative",
              height: "72vh",
              minHeight: 560,
              background: "#fafafa",
              cursor:
                tab === "review" && zoneEditorOn
                  ? "crosshair"
                  : tab === "collect" && isRunning
                  ? "crosshair"
                  : "default",
              userSelect: "none",
            }}
          >
            {/* PLAN IMAGE */}
            <img
              src="/plan.png"
              alt="Floorplan"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />

            {/* HEATMAP (Review only) */}
            {tab === "review" && heatmapOn ? (
              <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
                {heatCells.map((c) => {
                  const g = Math.max(5, Math.min(200, Math.floor(heatGrid)));
                  const cellW = 100 / g;
                  const cellH = 100 / g;

                  // opacity from density; boosted slightly for visibility
                  const alpha = clamp01(c.norm * heatStrength);

                  return (
                    <div
                      key={`${c.gx}-${c.gy}`}
                      title={`Heat cell count: ${c.count}`}
                      style={{
                        position: "absolute",
                        left: `${c.gx * cellW}%`,
                        top: `${c.gy * cellH}%`,
                        width: `${cellW}%`,
                        height: `${cellH}%`,
                        background: `rgba(255, 0, 0, ${alpha})`,
                        // For a slightly softer look:
                        filter: "blur(0.2px)",
                      }}
                    />
                  );
                })}
              </div>
            ) : null}

            {/* ZONE OVERLAYS (Review only) */}
            {tab === "review" && (showZonesFill || showZonesOutline || showZoneLabels) ? (
              <div style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}>
                {zones.map((z, idx) => {
                  const fill = zoneColorByIndex(idx);
                  const outline = "rgba(0,0,0,0.35)";
                  return (
                    <div
                      key={z.id}
                      title={`Zone: ${z.name}`}
                      style={{
                        position: "absolute",
                        left: `${z.x1 * 100}%`,
                        top: `${z.y1 * 100}%`,
                        width: `${(z.x2 - z.x1) * 100}%`,
                        height: `${(z.y2 - z.y1) * 100}%`,
                        background: showZonesFill ? fill : "transparent",
                        border: showZonesOutline ? `2px solid ${outline}` : "none",
                      }}
                    >
                      {showZoneLabels ? (
                        <div
                          style={{
                            position: "absolute",
                            left: 6,
                            top: 6,
                            fontSize: 12,
                            fontWeight: 900,
                            padding: "4px 6px",
                            borderRadius: 8,
                            background: "rgba(255,255,255,0.85)",
                            border: "1px solid rgba(0,0,0,0.15)",
                          }}
                        >
                          {z.name}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Draft rectangle while drawing zones */}
            {tab === "review" && zoneEditorOn && isDrawingZone && dragStart && dragNow ? (
              (() => {
                const r = rectNormalize(dragStart, dragNow);
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: `${r.x1 * 100}%`,
                      top: `${r.y1 * 100}%`,
                      width: `${(r.x2 - r.x1) * 100}%`,
                      height: `${(r.y2 - r.y1) * 100}%`,
                      border: "2px dashed rgba(17,17,17,0.7)",
                      background: "rgba(17,17,17,0.06)",
                      zIndex: 4,
                      pointerEvents: "none",
                    }}
                  />
                );
              })()
            ) : null}

            {/* MARKERS */}
            <div style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none" }}>
              {markersToRender.map((m) => {
                const color = ACTIVITY.find((a) => a.key === m.activity)?.color ?? "#111";
                const ring =
                  m.cloudStatus === "ok"
                    ? "2px solid rgba(34,197,94,0.9)"
                    : m.cloudStatus === "fail"
                    ? "2px solid rgba(239,68,68,0.95)"
                    : "2px solid rgba(255,255,255,0.95)";
                const isImport = (m.source ?? "live") === "import";

                return (
                  <div
                    key={m.id}
                    title={[
                      `Time: ${formatHMS(new Date(m.createdAt))}`,
                      `Badge: ${m.badgeNumber}`,
                      `Role: ${m.role}`,
                      `Activity: ${m.activity}`,
                      `Zone: ${m.zone}`,
                      `Interval: ${m.intervalLabel}`,
                      `Cloud: ${m.cloudStatus ?? "pending"}`,
                      m.note ? `Note: ${m.note}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    style={{
                      position: "absolute",
                      left: `${m.x * 100}%`,
                      top: `${m.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: color,
                      border: ring,
                      outline: isImport ? "2px dashed rgba(0,0,0,0.35)" : "none",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Heatmap uses the <b>filtered markers</b> (and playback cutoff, if enabled). Zones are rectangles drawn on the plan (saved locally).
        </div>
      </div>

      {/* ===== BOTTOM TAB BAR ===== */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          borderTop: "1px solid #e5e7eb",
          background: "rgba(255,255,255,0.98)",
          backdropFilter: "blur(8px)",
          padding: "10px 14px",
          display: "flex",
          justifyContent: "center",
          gap: 10,
          zIndex: 50,
        }}
      >
        <button
          onClick={() => setTab("collect")}
          style={{
            ...styles.buttonSecondary,
            borderColor: tab === "collect" ? "#111" : "#d0d5dd",
            background: tab === "collect" ? "#111" : "#fff",
            color: tab === "collect" ? "#fff" : "#111",
            minWidth: 140,
          }}
        >
          Collect
        </button>
        <button
          onClick={() => setTab("review")}
          style={{
            ...styles.buttonSecondary,
            borderColor: tab === "review" ? "#111" : "#d0d5dd",
            background: tab === "review" ? "#111" : "#fff",
            color: tab === "review" ? "#fff" : "#111",
            minWidth: 140,
          }}
        >
          Review
        </button>
      </div>
    </div>
  );
}
