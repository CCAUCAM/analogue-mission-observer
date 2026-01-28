"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* =======================
   GOOGLE SHEETS (NO AUTH)
======================= */

const SHEETS_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbxU6RovW_blp676-YSxvcux6PBZWfhhYhQzDefXfX6ftQvY53UKUh2-PqQH8yPtJ3Df/exec";

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

  x: number;
  y: number;

  zone: string;
  note: string;

  cloudStatus?: "pending" | "ok" | "fail";
  source?: "live" | "import";
};

/* =======================
   ZONES (EDIT THESE)
======================= */

type ZoneRect = { name: string; x1: number; y1: number; x2: number; y2: number };

const ZONES: ZoneRect[] = [
  { name: "Atrium/Operations", x1: 0.34, y1: 0.30, x2: 0.56, y2: 0.64 },
  { name: "Storage/Technical", x1: 0.30, y1: 0.05, x2: 0.52, y2: 0.30 },
  { name: "Hygiene Module", x1: 0.58, y1: 0.58, x2: 0.96, y2: 0.78 },
  { name: "Plant Cultivation", x1: 0.58, y1: 0.40, x2: 0.96, y2: 0.58 },
  { name: "Biological Lab", x1: 0.58, y1: 0.22, x2: 0.96, y2: 0.40 },
  { name: "Workshops", x1: 0.50, y1: 0.78, x2: 0.96, y2: 0.95 },
  { name: "Medical Module", x1: 0.05, y1: 0.52, x2: 0.28, y2: 0.72 },
  { name: "Airlock", x1: 0.18, y1: 0.72, x2: 0.34, y2: 0.90 },
];

function zoneForPoint(x: number, y: number): string {
  for (const z of ZONES) if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return z.name;
  return "Unassigned";
}

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

/**
 * Robust-enough CSV parser for our exported CSV.
 */
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
    fontWeight: 700,
    cursor: "pointer",
  } as React.CSSProperties,
  buttonSecondary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d0d5dd",
    background: "#fff",
    color: "#111",
    fontWeight: 700,
    cursor: "pointer",
  } as React.CSSProperties,
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #d0d5dd",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
  } as React.CSSProperties,
};

/* =======================
   CLOUD WRITE (Sheets)
   - no-cors + text/plain avoids CORS/preflight
======================= */

async function sendToSheets(payload: Record<string, any>) {
  if (!SHEETS_WEBHOOK_URL) throw new Error("Sheets webhook URL missing.");

  await fetch(SHEETS_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  // no-cors: we can't read response; resolved fetch means "sent".
  return true;
}

/* =======================
   MAIN COMPONENT
======================= */

export default function Page() {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // TEST status
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [testHint, setTestHint] = useState<string>("");

  // CSV import
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
  // Slider is 0..1000 (stable UI), maps to time window
  const [playbackPos, setPlaybackPos] = useState(1000);

  // keep timeLeft synced when not running
  useEffect(() => {
    if (!isRunning) setTimeLeft(intervalSeconds);
  }, [intervalSeconds, isRunning]);

  // timer tick
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

  // Sorted markers (stable for playback)
  const markersSorted = useMemo(() => {
    return [...markers].sort((a, b) => a.createdAt - b.createdAt);
  }, [markers]);

  const playbackWindow = useMemo(() => {
    if (markersSorted.length === 0) return null;
    const minT = markersSorted[0].createdAt;
    const maxT = markersSorted[markersSorted.length - 1].createdAt;
    return { minT, maxT };
  }, [markersSorted]);

  const playbackCutoffTime = useMemo(() => {
    if (!playbackWindow) return null;
    const { minT, maxT } = playbackWindow;
    const t = minT + ((maxT - minT) * playbackPos) / 1000;
    return t;
  }, [playbackWindow, playbackPos]);

  // playback tick
  useEffect(() => {
    if (!playbackEnabled || !isPlaying) return;
    if (!playbackWindow) return;

    const { minT, maxT } = playbackWindow;
    const total = Math.max(1, maxT - minT);
    const stepMs = 120 * playbackSpeed; // feel-good speed; adjust anytime

    const id = setInterval(() => {
      setPlaybackPos((p) => {
        const currentT = minT + (total * p) / 1000;
        const nextT = currentT + stepMs;
        const nextP = Math.round(((nextT - minT) / total) * 1000);

        if (nextP >= 1000) {
          // stop at end
          setIsPlaying(false);
          return 1000;
        }
        return Math.max(0, Math.min(1000, nextP));
      });
    }, 120);

    return () => clearInterval(id);
  }, [playbackEnabled, isPlaying, playbackSpeed, playbackWindow]);

  // If user turns on playback, default to end
  useEffect(() => {
    if (playbackEnabled) setPlaybackPos(1000);
    setIsPlaying(false);
  }, [playbackEnabled]);

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

  async function sendTestRow() {
    setTestStatus("sending");
    setTestHint("");

    try {
      const payload = {
        created_at_iso: new Date().toISOString(),
        observer: observerName,
        site: buildingSite,
        interval_minutes: intervalMinutes,
        interval_index: intervalIndex,
        interval_label: intervalLabel,
        badge: "TEST",
        role: role,
        activity: activity,
        group: false,
        x_norm: 0.5,
        y_norm: 0.5,
        zone: "TEST",
        note: "TEST ROW — sent from app",
      };

      await sendToSheets(payload);

      setTestStatus("sent");
      setTestHint("Sent ✓ Now check the Google Sheet (tab: observations).");
      window.setTimeout(() => setTestStatus("idle"), 3500);
    } catch {
      setTestStatus("failed");
      setTestHint("Failed. Likely deployment settings or URL mismatch.");
    }
  }

  function onPickCSV() {
    fileInputRef.current?.click();
  }

  async function handleImportCSV(file: File) {
    setStatusMsg("");
    try {
      const text = await file.text();
      const rows = parseCSV(text);

      if (rows.length < 2) {
        setStatusMsg("CSV looks empty.");
        return;
      }

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
      if (missing.length) {
        setStatusMsg(`CSV missing columns: ${missing.join(", ")}`);
        return;
      }

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

          x: isFinite(x) ? Math.min(1, Math.max(0, x)) : 0,
          y: isFinite(y) ? Math.min(1, Math.max(0, y)) : 0,

          zone: r[idx("zone")] || zoneForPoint(x, y),
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
    } catch (err: any) {
      setStatusMsg(`Import failed: ${String(err)}`);
    }
  }

  async function handleClick(e: React.MouseEvent) {
    setStatusMsg("");

    if (!isRunning || intervalStart === null) {
      setStatusMsg("Press Start to begin recording.");
      return;
    }

    if (!badgeNumber.trim()) {
      setStatusMsg("Enter a badge number before recording.");
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    const zone = zoneForPoint(x, y);

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
      cloudStatus: "pending",
      source: "live",
    };

    setMarkers((prev) => [...prev, base]);
    setLastRecorded(
      `Recorded: badge ${base.badgeNumber} · ${ROLES.find((r) => r.key === base.role)?.label} · ${
        ACTIVITY.find((a) => a.key === base.activity)?.label
      } · ${base.zone}`
    );

    sendToSheets({
      created_at_iso: new Date(base.createdAt).toISOString(),
      observer: base.observerName,
      site: base.buildingSite,
      interval_minutes: intervalMinutes,
      interval_index: base.intervalIndex,
      interval_label: base.intervalLabel,
      badge: base.badgeNumber,
      role: base.role,
      activity: base.activity,
      group: base.isGroup,
      x_norm: base.x,
      y_norm: base.y,
      zone: base.zone,
      note: base.note,
    })
      .then(() => {
        setMarkers((prev) => {
          const copy = [...prev];
          const i = copy.findIndex((m) => m.id === base.id);
          if (i >= 0) copy[i] = { ...copy[i], cloudStatus: "ok" };
          return copy;
        });
      })
      .catch(() => {
        setMarkers((prev) => {
          const copy = [...prev];
          const i = copy.findIndex((m) => m.id === base.id);
          if (i >= 0) copy[i] = { ...copy[i], cloudStatus: "fail" };
          return copy;
        });
        setStatusMsg("Saved locally; cloud may not have received it.");
      });
  }

  // Filter + playback pipeline
  const filteredMarkers = useMemo(() => {
    const badgeQ = filterBadge.trim().toLowerCase();

    return markersSorted.filter((m) => {
      if (filterRole !== "all" && m.role !== filterRole) return false;
      if (filterActivity !== "all" && m.activity !== filterActivity) return false;
      if (filterGroupOnly && !m.isGroup) return false;
      if (badgeQ) {
        const b = (m.badgeNumber || "").toLowerCase();
        if (!b.includes(badgeQ)) return false;
      }
      return true;
    });
  }, [markersSorted, filterBadge, filterRole, filterActivity, filterGroupOnly]);

  const playbackMarkers = useMemo(() => {
    if (!playbackEnabled || !playbackCutoffTime) return filteredMarkers;
    return filteredMarkers.filter((m) => m.createdAt <= playbackCutoffTime);
  }, [filteredMarkers, playbackEnabled, playbackCutoffTime]);

  const thisIntervalCount = useMemo(
    () => markers.filter((m) => m.intervalIndex === intervalIndex).length,
    [markers, intervalIndex]
  );

  const playbackLabel = useMemo(() => {
    if (!playbackEnabled || !playbackWindow || playbackCutoffTime === null) return null;
    const t = new Date(playbackCutoffTime);
    const minT = new Date(playbackWindow.minT);
    const maxT = new Date(playbackWindow.maxT);
    return `Playback time: ${formatHMS(t)} (from ${formatHMS(minT)} to ${formatHMS(maxT)})`;
  }, [playbackEnabled, playbackWindow, playbackCutoffTime]);

  function clearFilters() {
    setFilterBadge("");
    setFilterRole("all");
    setFilterActivity("all");
    setFilterGroupOnly(false);
  }

  const testButtonLabel =
    testStatus === "sending"
      ? "Sending…"
      : testStatus === "sent"
      ? "Sent ✓"
      : testStatus === "failed"
      ? "Failed ✕"
      : "Send TEST row";

  // Legend counts
  const legendCounts = useMemo(() => {
    const byActivity = new Map<ActivityType, number>();
    for (const a of ACTIVITY) byActivity.set(a.key, 0);
    for (const m of playbackMarkers) byActivity.set(m.activity, (byActivity.get(m.activity) || 0) + 1);

    const live = playbackMarkers.filter((m) => (m.source ?? "live") === "live").length;
    const imp = playbackMarkers.filter((m) => m.source === "import").length;

    return { byActivity, live, imp, total: playbackMarkers.length };
  }, [playbackMarkers]);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "#111" }}>
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
          <div style={{ fontWeight: 800, fontSize: 16 }}>Analogue Mission Observation Mapper</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>University of Cambridge</div>
        </div>
      </header>

      <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
        {/* CONTROLS CARD */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 14,
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          {/* Row 1 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1.2fr 0.8fr 1.6fr",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Observer</div>
              <select
                style={styles.select}
                value={observerName}
                onChange={(e) => setObserverName(e.target.value)}
              >
                <option>Observer 1</option>
                <option>Observer 2</option>
                <option>Observer 3</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Site</div>
              <select
                style={styles.select}
                value={buildingSite}
                onChange={(e) => setBuildingSite(e.target.value)}
              >
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
              <button style={styles.buttonSecondary} onClick={reset}>
                Reset
              </button>
              <button
                style={{
                  ...styles.buttonSecondary,
                  opacity: markers.length ? 1 : 0.5,
                  cursor: markers.length ? "pointer" : "not-allowed",
                }}
                onClick={exportCSV}
                disabled={markers.length === 0}
              >
                Export CSV
              </button>

              <button
                style={{
                  ...styles.buttonSecondary,
                  borderColor:
                    testStatus === "failed"
                      ? "#ef4444"
                      : testStatus === "sent"
                      ? "#22c55e"
                      : "#d0d5dd",
                }}
                onClick={sendTestRow}
                disabled={testStatus === "sending"}
              >
                {testButtonLabel}
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
            </div>
          </div>

          {/* Row 1.5: import mode + playback toggle */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 14,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                <input
                  type="checkbox"
                  checked={playbackEnabled}
                  onChange={(e) => setPlaybackEnabled(e.target.checked)}
                />
                Playback
              </label>

              {playbackEnabled && (
                <>
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
                </>
              )}
            </div>

            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {testHint ? (
                <span>{testHint}</span>
              ) : (
                <span>
                  Cloud test sends a row with badge <b>TEST</b> to your Sheet.
                </span>
              )}
            </div>
          </div>

          {/* Playback slider */}
          {playbackEnabled && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                {playbackLabel ?? "Playback: load data or record markers to enable timeline."}
              </div>
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
          )}

          {/* Row 2 */}
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
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                Badge number (shadowed person)
              </div>
              <input
                style={styles.input}
                value={badgeNumber}
                onChange={(e) => setBadgeNumber(e.target.value)}
                placeholder="e.g., 014"
              />
            </div>

            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Role</div>
              <select
                style={styles.select}
                value={role}
                onChange={(e) => setRole(e.target.value as RoleType)}
              >
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

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={isGroup}
                onChange={(e) => setIsGroup(e.target.checked)}
              />
              Group
            </label>
          </div>

          {/* Activity buttons */}
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
                      fontWeight: 800,
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

          {/* FILTERS */}
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid #eef2f7",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 13 }}>Filters (what you see on the plan)</div>
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
                <select
                  style={styles.select}
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value as any)}
                >
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

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                <input
                  type="checkbox"
                  checked={filterGroupOnly}
                  onChange={(e) => setFilterGroupOnly(e.target.checked)}
                />
                Group only
              </label>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={styles.pill}>Showing: {playbackMarkers.length}</span>
              <span style={styles.pill}>Total stored: {markers.length}</span>
              <span style={styles.pill}>Live: {legendCounts.live}</span>
              <span style={styles.pill}>Imported: {legendCounts.imp}</span>
            </div>
          </div>

          {/* Status line */}
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <span style={{ fontWeight: 900 }}>
              Interval: {intervalLabel} · Time left: {timerText} · Markers: {markers.length} · This
              interval: {thisIntervalCount}
            </span>
            {statusMsg ? (
              <span style={{ marginLeft: 10, color: "#b42318", fontWeight: 800 }}>
                {statusMsg}
              </span>
            ) : null}
            {lastRecorded ? <div style={{ marginTop: 6, opacity: 0.8 }}>{lastRecorded}</div> : null}
          </div>
        </div>

        {/* LEGEND */}
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
                  fontWeight: 800,
                }}
                title={`${a.label} (${legendCounts.byActivity.get(a.key) || 0})`}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: a.color,
                  }}
                />
                {a.label} ({legendCounts.byActivity.get(a.key) || 0})
              </span>
            ))}
          </div>

          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
            <span>
              <b>Dot ring</b>:{" "}
              <span style={{ borderBottom: "2px solid rgba(34,197,94,0.9)" }}>green</span> = cloud ok,{" "}
              <span style={{ borderBottom: "2px solid rgba(239,68,68,0.95)" }}>red</span> = cloud fail,{" "}
              <span style={{ borderBottom: "2px solid rgba(0,0,0,0.1)" }}>white</span> = pending
            </span>
            <span>
              <b>Source</b>: live = solid dot; imported = dashed outline
            </span>
          </div>
        </div>

        {/* PLAN CARD */}
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
            <b>Click on the plan</b> to record a point. (Badge required.) Selected activity:{" "}
            <b>{selectedActivityMeta.label}</b>
            {playbackEnabled ? (
              <span style={{ marginLeft: 10, opacity: 0.75 }}>
                · Playback ON (showing up to slider time)
              </span>
            ) : null}
          </div>

          <div
            ref={containerRef}
            onClick={handleClick}
            style={{
              position: "relative",
              height: "72vh",
              minHeight: 560,
              background: "#fafafa",
              cursor: isRunning ? "crosshair" : "not-allowed",
            }}
          >
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

            {playbackMarkers.map((m) => {
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
                    `Source: ${m.source ?? "live"}`,
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
                    zIndex: 5,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Zones: edit the <b>ZONES</b> array near the top of the file to match your plan.
        </div>
      </div>
    </div>
  );
}
