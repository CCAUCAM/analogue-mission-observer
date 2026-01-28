"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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
  createdAt: number; // ms
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

  zone: string; // derived
  note: string;
};

/* =======================
   ZONES (EDIT THESE)
   - Coordinates are NORMALIZED (0..1)
   - x1,y1 is top-left; x2,y2 bottom-right
   - Order matters: first match wins
======================= */

type ZoneRect = {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * IMPORTANT:
 * These are placeholder rectangles.
 * You’ll edit them to match your plan layout.
 *
 * Tip: Start with 6–10 big zones (Atrium, Lab, Hygiene, Dormitory, etc.)
 * then refine later.
 */
const ZONES: ZoneRect[] = [
  // Example rough blocks (EDIT!)
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
  for (const z of ZONES) {
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return z.name;
  }
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

function formatIntervalLabel(start: Date, durationSeconds: number) {
  const end = new Date(start.getTime() + durationSeconds * 1000);
  return `${formatHM(start)}–${formatHM(end)}`;
}

function csvEscape(value: string) {
  const v = value ?? "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/* =======================
   UI HELPERS
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
  buttonGhost: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid transparent",
    background: "transparent",
    color: "#111",
    fontWeight: 700,
    cursor: "pointer",
  } as React.CSSProperties,
};

/* =======================
   MAIN COMPONENT
======================= */

export default function Page() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [observerName, setObserverName] = useState("Observer 1");
  const [buildingSite, setBuildingSite] = useState("Habitat A");
  const [intervalMinutes, setIntervalMinutes] = useState(5);

  const intervalSeconds = useMemo(() => Math.max(1, intervalMinutes * 60), [intervalMinutes]);

  const [badgeNumber, setBadgeNumber] = useState("");
  const [role, setRole] = useState<RoleType>("pilot");
  const [activity, setActivity] = useState<ActivityType>("walking");
  const [isGroup, setIsGroup] = useState(false);
  const [note, setNote] = useState("");

  const [isRunning, setIsRunning] = useState(false);
  const [intervalIndex, setIntervalIndex] = useState(0);
  const [intervalStart, setIntervalStart] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(intervalSeconds);

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");

  const [lastRecorded, setLastRecorded] = useState<string>("");

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
      // resume: restart interval from now
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
      ].map(csvEscape);
    });

    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mission_observations_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function handleClick(e: React.MouseEvent) {
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

    const m: Marker = {
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
    };

    setMarkers((prev) => [...prev, m]);
    setLastRecorded(
      `Recorded: badge ${m.badgeNumber} · ${ROLES.find((r) => r.key === m.role)?.label} · ${selectedActivityMeta.label} · ${m.zone}`
    );
  }

  const thisIntervalCount = useMemo(
    () => markers.filter((m) => m.intervalIndex === intervalIndex).length,
    [markers, intervalIndex]
  );

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
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            Analogue Mission Observation Mapper
          </div>
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
              gridTemplateColumns: "1.2fr 1.2fr 0.8fr 1.4fr",
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

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
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
            </div>
          </div>

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

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
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

          {/* Status line */}
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <span style={{ fontWeight: 800 }}>
              Interval: {intervalLabel} · Time left: {timerText} · Markers: {markers.length} ·
              This interval: {thisIntervalCount}
            </span>
            {statusMsg ? (
              <span style={{ marginLeft: 10, color: "#b42318", fontWeight: 700 }}>
                {statusMsg}
              </span>
            ) : null}
            {lastRecorded ? (
              <div style={{ marginTop: 6, opacity: 0.8 }}>{lastRecorded}</div>
            ) : null}
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
          </div>

          <div
            ref={containerRef}
            onClick={handleClick}
            style={{
              position: "relative",
              height: "70vh", // BIGGER + field-friendly
              minHeight: 520,
              background: "#fafafa",
              cursor: isRunning ? "crosshair" : "not-allowed",
            }}
          >
            {/* Plan image */}
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

            {/* Dots layer (on top of image) */}
            {markers.map((m) => {
              const color = ACTIVITY.find((a) => a.key === m.activity)?.color ?? "#111";
              return (
                <div
                  key={m.id}
                  title={`Badge ${m.badgeNumber} · ${m.role} · ${m.activity} · ${m.zone} · ${m.intervalLabel}`}
                  style={{
                    position: "absolute",
                    left: `${m.x * 100}%`,
                    top: `${m.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: color,
                    border: "3px solid #fff",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                    zIndex: 5, // KEY: ensure dots are above the plan
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* ZONES NOTE */}
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Zones: edit the <b>ZONES</b> array near the top of the file to match your plan. Each zone is a
          rectangle in normalized coordinates (0..1). CSV includes a <b>zone</b> column.
        </div>
      </div>
    </div>
  );
}
