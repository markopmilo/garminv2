import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine
} from "recharts";
import "./App.css";

const API = "http://127.0.0.1:5000";

/* -------------------------- helpers / normalization -------------------------- */

const toDay = (d) => (d ? (d.slice?.(0, 10) ?? String(d).slice(0, 10)) : "");
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sortAsc = (arr) => arr.slice().sort((a, b) => (toDay(a.date) > toDay(b.date) ? 1 : -1));

/* Endpoint-specific normalizers */
const normSteps = (rows) =>
    sortAsc((rows || []).map((r) => {
      const steps = numOrNull(r?.steps);
      const goal = numOrNull(r?.step_goal);
      const pct = steps != null && goal && goal > 0
          ? +(100 * steps / goal).toFixed(1)
          : 0; // changed from null to 0
      return {
        date: toDay(r?.date),
        steps,
        step_goal: goal,
        steps_pct_goal: pct,
      };
    }));

const normStress = (rows) =>
    sortAsc((rows || []).map((r) => ({
      date: toDay(r?.date),
      stress_avg: numOrNull(r?.stress_avg),
    })));

const normExercise = (rows) =>
    sortAsc((rows || []).map((r) => {
      const ms = numOrNull(r?.moderate_activity_seconds);
      const vs = numOrNull(r?.vigorous_activity_seconds);
      const goalS = numOrNull(r?.intensity_time_goal_seconds);
      const totalS = (ms ?? 0) + (vs ?? 0);

      const totalMin = Number.isFinite(totalS) ? +(totalS / 60).toFixed(1) : null;
      const goalMin  = goalS != null ? +(goalS / 60).toFixed(1) : null;

      // Percent of goal — connect missing with 0
      const pct = goalMin && goalMin > 0 && totalMin != null
          ? +(100 * totalMin / goalMin).toFixed(1)
          : 0;

      return {
        date: toDay(r?.date),
        moderate_min: ms != null ? +(ms / 60).toFixed(1) : null,
        vigorous_min: vs != null ? +(vs / 60).toFixed(1) : null,
        total_min: totalMin,
        exercise_pct_goal: pct,
        // optional extras
        distance: numOrNull(r?.distance),
        calories_active: numOrNull(r?.calories_active),
        calories_total: numOrNull(r?.calories_total),
      };
    }));

const normSleep = (rows) =>
    sortAsc((rows || []).map((r) => ({
      date: toDay(r?.date),
      total_sleep_hours: numOrNull(r?.total_sleep_hours),
      deep_sleep_hours:  numOrNull(r?.deep_sleep_hours),
      light_sleep_hours: numOrNull(r?.light_sleep_hours),
      rem_sleep_hours:   numOrNull(r?.rem_sleep_hours),
      awake_hours:       numOrNull(r?.awake_hours),
    })));

/* ------------------------------ main component ------------------------------ */

function App() {
  // Phase: 'setup' | 'updating' | 'ready'
  const [phase, setPhase] = useState("setup");

  // Data
  const [steps, setSteps] = useState([]);
  const [stress, setStress] = useState([]);
  const [exercise, setExercise] = useState([]);
  const [sleep, setSleep] = useState([]);
  const [loading, setLoading] = useState(false);

  // Onboarding
  const [cfgUser, setCfgUser] = useState("");
  const [cfgPass, setCfgPass] = useState("");
  const [cfgStart, setCfgStart] = useState("");

  // Quick range vs custom
  const [rangeDays, setRangeDays] = useState(90);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [useCustomRange, setUseCustomRange] = useState(false);

  // Bootstrap (prefill config and, if data exists, jump to dashboard)
  useEffect(() => {
    (async () => {
      try {
        const { data: current } = await axios.get(`${API}/api/config`);
        setCfgUser(current?.credentials?.user || "");
        const existingStart =
            current?.data?.sleep_start_date ||
            current?.data?.monitoring_start_date ||
            current?.data?.rhr_start_date ||
            current?.data?.weight_start_date ||
            "";
        setCfgStart(existingStart);

        const { data: st } = await axios.get(`${API}/api/steps`);
        if (Array.isArray(st) && st.length > 0) {
          await fetchAll();
          setPhase("ready");
        } // else: remain on setup by default
      } catch {
        // stay on setup if anything fails
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch & normalize
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [s2, s3, s4, s5] = await Promise.all([
        axios.get(`${API}/api/steps`),
        axios.get(`${API}/api/stress`),
        axios.get(`${API}/api/exercise`),
        axios.get(`${API}/api/sleep`),
      ]);

      setSteps(normSteps(Array.isArray(s2.data) ? s2.data : []));
      setStress(normStress(Array.isArray(s3.data) ? s3.data : []));
      setExercise(normExercise(Array.isArray(s4.data) ? s4.data : []));
      setSleep(normSleep(Array.isArray(s5.data) ? s5.data : []));
    } finally {
      setLoading(false);
    }
  };

  const runInitialUpdate = async () => {
    setPhase("updating");
    try {
      const dataFields = cfgStart
          ? {
            sleep_start_date: cfgStart,
            monitoring_start_date: cfgStart,
            rhr_start_date: cfgStart,
            weight_start_date: cfgStart,
          }
          : {};
      const payload = {
        credentials: { user: cfgUser, secure_password: false, ...(cfgPass ? { password: cfgPass } : {}) },
        data: dataFields,
      };
      await axios.post(`${API}/api/config`, payload);
      await axios.post(`${API}/api/ensure-folders`);
      await axios.post(`${API}/api/update`);
      await fetchAll();
      setPhase("ready");
    } catch (e) {
      console.error("Initial update failed:", e);
      alert(`Initial update failed: ${e?.message || "Unknown error"}`);
      setPhase("setup");
    } finally {
      setCfgPass("");
    }
  };

  const updateData = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/api/update`);
      await fetchAll();
    } finally {
      setLoading(false);
    }
  };

  const openSettings = async () => {
    try {
      const { data: current } = await axios.get(`${API}/api/config`);

      const currentStart =
          current?.data?.sleep_start_date ||
          current?.data?.monitoring_start_date ||
          current?.data?.rhr_start_date ||
          current?.data?.weight_start_date ||
          "";

      const unifiedStart = window.prompt(
          "Start date for data (M/D/YYYY):",
          currentStart
      );
      if (unifiedStart == null) return;

      const dataFields = unifiedStart
          ? {
            sleep_start_date: unifiedStart,
            monitoring_start_date: unifiedStart,
            rhr_start_date: unifiedStart,
            weight_start_date: unifiedStart,
          }
          : {};

      await axios.post(`${API}/api/config`, { data: dataFields });

      setCfgStart(unifiedStart || "");
      alert("Start date updated.");

    } catch (e) {
      console.error("Failed to update start date:", e?.response?.data || e);
      alert(
          `Failed to update start date${
              e?.response?.status ? ` (${e.response.status})` : ""
          }`
      );
    } finally {
      setLoading(false);
    }
  };

  const deleteData = async () => {
    if (!window.confirm("Are you sure you want to delete ALL HealthData contents?")) return;
    setLoading(true);
    try {
      await axios.delete(`${API}/api/erase?confirm=true`);
      setSteps([]); setStress([]); setExercise([]); setSleep([]);
      alert("All HealthData contents deleted.");
      setPhase("setup");
    } catch (err) {
      console.error(err);
      alert("Failed to erase.");
    } finally {
      setLoading(false);
    }
  };

  /* --------------------------- date filtering (UI) --------------------------- */

  const inRange = (dateStr, start, end) => {
    const d = toDay(dateStr);
    const s = toDay(start);
    const e = toDay(end);
    if (!d) return false;
    if (s && d < s) return false;
    return !(e && d > e);
  };

  const filterByDays = useCallback((arr) => {
    if (!arr?.length) return arr;

    if (useCustomRange && (customStart || customEnd)) {
      return arr.filter((r) => inRange(r?.date, customStart, customEnd));
    }

    if (!isFinite(rangeDays)) return arr; // "All"
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutISO = cutoff.toISOString().slice(0, 10);
    return arr.filter((r) => toDay(r?.date) >= cutISO);
  }, [useCustomRange, customStart, customEnd, rangeDays]);

  const dSteps = useMemo(() => filterByDays(steps),    [steps, filterByDays]);
  const dStress= useMemo(() => filterByDays(stress),   [stress, filterByDays]);
  const dEx    = useMemo(() => filterByDays(exercise), [exercise, filterByDays]);
  const dSleep = useMemo(() => filterByDays(sleep),    [sleep, filterByDays]);

  const Empty = ({ show }) => show ? (
      <div style={{position:'absolute', inset:0, display:'grid', placeItems:'center', color:'var(--muted)'}}>No data</div>
  ) : null;

  /* --------------------------------- render --------------------------------- */

  if (phase === "updating") {
    return (
        <div className="app center">
          <div className="card" style={{ maxWidth: 520 }}>
            <h2>Fetching your Garmin data…</h2>
            <p>Please wait. This can take a few minutes on the first run.</p>
            <div className="spinner" />
          </div>
        </div>
    );
  }

  if (phase === "setup") {
    return (
        <div className="app center">
          <div className="card" style={{ maxWidth: 520 }}>
            <h2>Welcome — let’s set things up</h2>
            <div className="form">
              {/* Username full-width */}
              <label>
                Garmin username/email
                <input
                    value={cfgUser}
                    onChange={(e) => setCfgUser(e.target.value)}
                    placeholder="you@example.com"
                />
              </label>

              {/* Password inline */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ margin: 0, whiteSpace: "nowrap" }}>
                  Garmin password
                </label>
                <input
                    style={{ flex: 1 }}
                    value={cfgPass}
                    onChange={(e) => setCfgPass(e.target.value)}
                    placeholder="••••••••"
                    type="password"
                />
              </div>

              {/* Start date inline */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ margin: 0, whiteSpace: "nowrap" }}>
                  Start date for Data (M/D/YYYY)
                </label>
                <input
                    style={{ flex: 1 }}
                    value={cfgStart}
                    onChange={(e) => setCfgStart(e.target.value)}
                    placeholder="6/1/2025"
                />
              </div>
            </div>

            <div
                className="toolbar"
                style={{ justifyContent: "flex-end", marginTop: 12 }}
            >
              <button className="btn" onClick={() => window.location.reload()}>
                Cancel
              </button>
              <button
                  className="btn primary"
                  onClick={runInitialUpdate}
                  disabled={!cfgUser?.trim()}
                  title={
                    !cfgUser?.trim()
                        ? "Username is required"
                        : "Save & fetch data"
                  }
              >
                Save & Pull Data
              </button>
            </div>

            <p className="muted" style={{ marginTop: 8 }}>
              We’ll save your config, run one full update, then take you to the
              dashboard.
            </p>
          </div>
        </div>
    );
  }


  return (
      <div className="app">
        <div className="header">
          <h1 className="title">
            Garmin Dashboard{" "}
            <span className="badge">
            {useCustomRange && (customStart || customEnd)
                ? `${customStart || "…"} to ${customEnd || "…"}`
                : (isFinite(rangeDays) ? `${rangeDays}d` : "All")}
          </span>
          </h1>
          <div className="toolbar">
            {loading && <span className="loading">Working…</span>}

            {/* Quick presets */}
            <div className="range" role="tablist" aria-label="Date range">
              <button className={rangeDays===30?"active":""} onClick={() => { setRangeDays(30); setUseCustomRange(false); }}>30d</button>
              <button className={rangeDays===90?"active":""} onClick={() => { setRangeDays(90); setUseCustomRange(false); }}>90d</button>
              <button className={rangeDays===365?"active":""} onClick={() => { setRangeDays(365); setUseCustomRange(false); }}>1y</button>
              <button className={!isFinite(rangeDays)?"active":""} onClick={() => { setRangeDays(Infinity); setUseCustomRange(false); }}>All</button>
            </div>

            {/* Custom date range */}
            <div className="custom-range" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label className="muted" htmlFor="start">From</label>
              <input id="start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <label className="muted" htmlFor="end">to</label>
              <input id="end" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              <button className="btn" onClick={() => setUseCustomRange(true)} disabled={!customStart && !customEnd}>Apply</button>
              <button className="btn" onClick={() => { setUseCustomRange(false); setCustomStart(""); setCustomEnd(""); }} disabled={!useCustomRange && !customStart && !customEnd}>Clear</button>
            </div>

            <button className="btn primary" onClick={updateData} disabled={loading}>
              {loading ? "Updating…" : "Update from Garmin"}
            </button>
            <button className="btn danger" onClick={deleteData} disabled={loading}>Erase HealthData</button>
            <button className="btn" onClick={openSettings} disabled={loading}>Settings</button>
          </div>
        </div>

        <div className="grid">
          {/* Steps */}
          <section className="card">
            <h2>Steps</h2>
            <div className="chart" style={{ position: 'relative' }}>
              <Empty show={!dSteps?.length} />
              <ResponsiveContainer>
                <LineChart data={dSteps}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis allowDecimals={false} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip labelFormatter={(label) => `Date: ${label}`} />
                  <Legend />
                  <Line type="monotone" dataKey="steps" name="Steps" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* % of goal chart */}
            <div className="chart" style={{ position: 'relative', height: 220, marginTop: 8 }}>
              <Empty show={!dSteps?.length} />
              <ResponsiveContainer>
                <LineChart data={dSteps}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis domain={[0, 120]} tickFormatter={(v) => `${v}%`} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip labelFormatter={(l) => `Date: ${l}`} formatter={(v) => [`${v}%`, "Goal %"]} />
                  <Legend />
                  {/* Goal line (dotted gray) */}
                  <ReferenceLine y={100} stroke="#9ca3af" strokeDasharray="4 4" />
                  {/* % of Goal line (solid blue) */}
                  <Line
                      type="monotone"
                      dataKey="steps_pct_goal"
                      name="% of Goal"
                      dot={false}
                      strokeWidth={2}
                      stroke="#3b82f6" // blue
                      connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Stress */}
          <section className="card">
            <h2>Stress (Daily Avg)</h2>
            <div className="chart" style={{ position:'relative' }}>
              <Empty show={!dStress?.length} />
              <ResponsiveContainer>
                <LineChart data={dStress}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis allowDecimals={false} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip labelFormatter={(label) => `Date: ${label}`} />
                  <Legend />
                  <Line type="monotone" dataKey="stress_avg" name="Avg Stress" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Exercise (Minutes) */}
          <section className="card">
            <h2>Exercise (Minutes)</h2>
            <div className="chart" style={{ height: 340, position:'relative' }}>
              <Empty show={!dEx?.length} />
              <ResponsiveContainer>
                <LineChart data={dEx}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis allowDecimals={false} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip
                      labelFormatter={(label) => `Date: ${label}`}
                      formatter={(val, name) => [`${val} min`, name.replace(/_/g, " ")]}
                  />
                  <Legend />
                  <Line
                      type="monotone"
                      dataKey="moderate_min"
                      name="Moderate (min)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#3b82f6" // blue
                  />
                  <Line
                      type="monotone"
                      dataKey="vigorous_min"
                      name="Vigorous (min)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#ef4444" // red
                  />
                  <Line
                      type="monotone"
                      dataKey="total_min"
                      name="Total (min)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#10b981" // green
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* % of goal for exercise */}
            <div className="chart" style={{ position:'relative', height: 220, marginTop: 8 }}>
              <Empty show={!dEx?.length} />
              <ResponsiveContainer>
                <LineChart data={dEx}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis domain={[0, 120]} tickFormatter={(v) => `${v}%`} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip labelFormatter={(l) => `Date: ${l}`} formatter={(v) => [`${v}%`, "Goal %"]} />
                  <Legend />
                  {/* dotted gray 100% reference */}
                  <ReferenceLine y={100} stroke="#9ca3af" strokeDasharray="4 4" />
                  {/* solid blue percent line */}
                  <Line
                      type="monotone"
                      dataKey="exercise_pct_goal"
                      name="% of Goal"
                      dot={false}
                      strokeWidth={2}
                      stroke="#3b82f6"
                      connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Sleep */}
          <section className="card">
            <h2>Sleep</h2>
            <div className="chart" style={{ height: 340, position:'relative' }}>
              <Empty show={!dSleep?.length} />
              <ResponsiveContainer>
                <LineChart data={dSleep}>
                  <XAxis dataKey={(d) => toDay(d.date)} angle={-30} textAnchor="end" height={60} tickMargin={8} />
                  <YAxis domain={[0, 12]} allowDecimals={false} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <Tooltip
                      labelFormatter={(label) => `Date: ${label}`}
                      formatter={(val, name) => [`${val} h`, name.replace(/_/g, " ")]}
                  />
                  <Legend />
                  <Line
                      dataKey="total_sleep_hours"
                      name="Total (h)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#3b82f6" // blue
                  />
                  <Line
                      dataKey="deep_sleep_hours"
                      name="Deep (h)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#8b5cf6" // purple
                  />
                  <Line
                      dataKey="light_sleep_hours"
                      name="Light (h)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#f59e0b" // amber
                  />
                  <Line
                      dataKey="rem_sleep_hours"
                      name="REM (h)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#ef4444" // red
                  />
                  <Line
                      dataKey="awake_hours"
                      name="Awake (h)"
                      connectNulls
                      dot={false}
                      strokeWidth={2}
                      stroke="#6b7280" // gray
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      </div>
  );
}

export default App;
