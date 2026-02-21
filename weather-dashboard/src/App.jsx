import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import Plotly from "plotly.js-dist-min";

const CSV_URL = "/weather_log.csv";
const POLL_MS = 60000; // 60 seconds

const WINDOWS = [
  { key: "15m", label: "15m", ms: 15 * 60000 },
  { key: "1h", label: "1h", ms: 60 * 60000 },
  { key: "6h", label: "6h", ms: 6 * 3600000 },
  { key: "24h", label: "24h", ms: 24 * 3600000 },
  { key: "all", label: "All", ms: null },
];

function safeParseDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isNaN(n) ? null : n;
}

function getThemeInitial() {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "dark";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

export default function App() {
  const [theme, setTheme] = useState(getThemeInitial);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [windowKey, setWindowKey] = useState("1h");
  const [showMarkers, setShowMarkers] = useState(true);

  // VLM analysis states
  const [latestAnalysis, setLatestAnalysis] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState("loading");
  const [analysisError, setAnalysisError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  // Chat states
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isSending]);

  // Open/close chat
  const openChat = () => setChatOpen(true);
  const closeChat = () => {
    setChatOpen(false);
    setChatInput("");
  };

  // Send chat message to backend
  const sendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending) return;

    const userMessage = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setChatInput("");
    setIsSending(true);

    try {
      // Show loading
      setChatMessages((prev) => [...prev, { role: "assistant", text: "Analyzing dashboard..." }]);

      const res = await fetch("/api/ask-vlm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMessage }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const { answer } = await res.json();

      // Replace loading with real answer
      setChatMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", text: answer || "Sorry, couldn't analyze that." },
      ]);
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", text: "Error: Could not connect to VLM." },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // Plot refs — 6 graphs
  const pmRef = useRef(null);
  const tempRef = useRef(null);
  const humRef = useRef(null);
  const aqiRef = useRef(null);
  const pieRef = useRef(null);
  const changeRef = useRef(null);

  async function fetchLatestAnalysis() {
    try {
      setAnalysisError("");
      const res = await fetch("/api/latest-analysis", { cache: "no-store" });
      if (res.status === 404) {
        setLatestAnalysis(null);
        setAnalysisStatus("none");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLatestAnalysis(data);
      setAnalysisStatus("ok");
    } catch (err) {
      setAnalysisStatus("error");
      setAnalysisError(err?.message || String(err));
    }
  }

  useEffect(() => {
    fetchLatestAnalysis();
  }, []);

  useEffect(() => {
    window.__DASH_READY__ = false;
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  async function fetchCsvOnce() {
    window.__DASH_READY__ = false;
    setLoadError("");
    setLoading(true);

    try {
      const url = `${CSV_URL}?t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);

      const text = await res.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      if (parsed.errors?.length) {
        throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
      }

      const cleaned = (parsed.data || [])
        .map((r) => ({
          fetched_at: safeParseDate(r.fetched_at),
          aqi: num(r.aqi),
          pm25: num(r.pm25),
          pm10: num(r.pm10),
          o3: num(r.o3),
          no2: num(r.no2),
          so2: num(r.so2),
          co: num(r.co),
          temperature: num(r.temperature),
          humidity: num(r.humidity),
          wind: num(r.wind),
          station_name: r.station_name || "Unknown",
          time: r.time || "",
        }))
        .filter((r) => r.fetched_at);

      cleaned.sort((a, b) => a.fetched_at - b.fetched_at);

      setRows(cleaned);
      setLoading(false);
    } catch (e) {
      setLoadError(e?.message || "Unknown error");
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCsvOnce();
    const id = setInterval(fetchCsvOnce, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const latestFetched = useMemo(() => rows[rows.length - 1]?.fetched_at ?? null, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows.length) return [];
    const w = WINDOWS.find((x) => x.key === windowKey);
    const ms = w?.ms ?? null;
    const maxT = latestFetched?.getTime() ?? 0;
    const minT = ms ? maxT - ms : 0;
    return rows.filter((r) => (r.fetched_at?.getTime() ?? 0) >= minT);
  }, [rows, windowKey, latestFetched]);

  const latestSnapshot = useMemo(() => {
    if (!rows.length) return null;
    const maxT = Math.max(...rows.map((r) => r.fetched_at?.getTime() ?? 0));
    return rows.find((r) => r.fetched_at?.getTime() === maxT);
  }, [rows]);

  function baseLayout(isDark) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: isDark ? "#e0e0e0" : "#333" },
      margin: { l: 60, r: 100, t: 50, b: 70 },
      xaxis: { gridcolor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
      yaxis: { gridcolor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
      legend: { orientation: "h", y: 1.1 },
    };
  }

  async function renderAll() {
    if (!pmRef.current || !tempRef.current || !humRef.current || !aqiRef.current || !pieRef.current || !changeRef.current) return;

    const isDark = theme === "dark";
    const layout = baseLayout(isDark);

    const x = filteredRows.map((r) => r.fetched_at);

    // 1. PM2.5 & PM10 over time
    Plotly.react(pmRef.current, [
      {
        x,
        y: filteredRows.map((r) => r.pm25),
        type: "scatter",
        mode: showMarkers ? "lines+markers" : "lines",
        name: "PM2.5",
        line: { color: "#f97316", width: 2 },
        marker: { size: 6 },
      },
      {
        x,
        y: filteredRows.map((r) => r.pm10),
        type: "scatter",
        mode: showMarkers ? "lines+markers" : "lines",
        name: "PM10",
        line: { color: "#84cc16", width: 2 },
        marker: { size: 6 },
      },
    ], {
      ...layout,
      title: { text: "PM2.5 & PM10 Over Time", x: 0.5 },
      yaxis: { title: "µg/m³" },
    }, { responsive: true });

    // 2. Temperature over time
    Plotly.react(tempRef.current, [
      {
        x,
        y: filteredRows.map((r) => r.temperature),
        type: "scatter",
        mode: showMarkers ? "lines+markers" : "lines",
        name: "Temperature (°C)",
        line: { color: "#ef4444", width: 2 },
        marker: { size: 6 },
      },
    ], {
      ...layout,
      title: { text: "Temperature Over Time", x: 0.5 },
      yaxis: { title: "°C" },
    }, { responsive: true });

    // 3. Humidity over time
    Plotly.react(humRef.current, [
      {
        x,
        y: filteredRows.map((r) => r.humidity),
        type: "scatter",
        mode: showMarkers ? "lines+markers" : "lines",
        name: "Humidity (%)",
        line: { color: "#3b82f6", width: 2 },
        marker: { size: 6 },
      },
    ], {
      ...layout,
      title: { text: "Humidity Over Time", x: 0.5 },
      yaxis: { title: "%" },
    }, { responsive: true });

    // 4. AQI bar chart
    Plotly.react(aqiRef.current, [
      {
        x,
        y: filteredRows.map((r) => r.aqi),
        type: "bar",
        name: "AQI",
        marker: {
          color: filteredRows.map((r) => {
            const v = r.aqi;
            if (v > 150) return "#ef4444";
            if (v > 100) return "#f59e0b";
            if (v > 50) return "#fbbf24";
            return "#22c55e";
          }),
        },
      },
    ], {
      ...layout,
      title: { text: "AQI Levels Over Time", x: 0.5 },
      yaxis: { title: "AQI", range: [0, 300] },
      bargap: 0.3,
    }, { responsive: true });

    // 5. Pie chart: Average Pollutant Distribution
    if (filteredRows.length > 0) {
      const avg = {
        pm25: filteredRows.reduce((sum, r) => sum + (r.pm25 || 0), 0) / filteredRows.length,
        pm10: filteredRows.reduce((sum, r) => sum + (r.pm10 || 0), 0) / filteredRows.length,
        o3: filteredRows.reduce((sum, r) => sum + (r.o3 || 0), 0) / filteredRows.length,
        no2: filteredRows.reduce((sum, r) => sum + (r.no2 || 0), 0) / filteredRows.length,
        so2: filteredRows.reduce((sum, r) => sum + (r.so2 || 0), 0) / filteredRows.length,
        co: filteredRows.reduce((sum, r) => sum + (r.co || 0), 0) / filteredRows.length,
      };

      const values = [avg.pm25, avg.pm10, avg.o3, avg.no2, avg.so2, avg.co];
      const labels = ["PM2.5", "PM10", "O3", "NO2", "SO2", "CO"];

      Plotly.react(pieRef.current, [{
        values,
        labels,
        type: "pie",
        marker: { colors: ["#f97316", "#84cc16", "#3b82f6", "#a78bfa", "#eab308", "#ef4444"] },
        textinfo: "label+percent",
        hole: 0.4,
      }], {
        ...layout,
        title: { text: `Pollutant Distribution (${windowKey})`, x: 0.5 },
        showlegend: false,
      }, { responsive: true });
    }

    // 6. Change Comparison
    if (filteredRows.length >= 2) {
      const earliest = filteredRows[0];
      const latest = filteredRows[filteredRows.length - 1];

      const earliestTime = earliest.fetched_at.toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      const latestTime = latest.fetched_at.toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const changes = [
        { name: "PM2.5", val: earliest.pm25 ? ((latest.pm25 - earliest.pm25) / earliest.pm25 * 100) : 0 },
        { name: "PM10", val: earliest.pm10 ? ((latest.pm10 - earliest.pm10) / earliest.pm10 * 100) : 0 },
        { name: "AQI", val: earliest.aqi ? ((latest.aqi - earliest.aqi) / earliest.aqi * 100) : 0 },
        { name: "O3", val: earliest.o3 ? ((latest.o3 - earliest.o3) / earliest.o3 * 100) : 0 },
        { name: "NO2", val: earliest.no2 ? ((latest.no2 - earliest.no2) / earliest.no2 * 100) : 0 },
        { name: "SO2", val: earliest.so2 ? ((latest.so2 - earliest.so2) / earliest.so2 * 100) : 0 },
        { name: "CO", val: earliest.co ? ((latest.co - earliest.co) / earliest.co * 100) : 0 },
        { name: "Temp", val: earliest.temperature ? ((latest.temperature - earliest.temperature) / earliest.temperature * 100) : 0 },
        { name: "Humidity", val: earliest.humidity ? ((latest.humidity - earliest.humidity) / earliest.humidity * 100) : 0 },
        { name: "Wind", val: earliest.wind ? ((latest.wind - earliest.wind) / earliest.wind * 100) : 0 },
      ];

      Plotly.react(changeRef.current, [
        {
          x: changes.map((c) => c.name),
          y: changes.map((c) => c.val),
          type: "bar",
          marker: { color: changes.map((c) => (c.val >= 0 ? "#22c55e" : "#ef4444")) },
          text: changes.map((c) => c.val.toFixed(1) + "%"),
          textposition: "auto",
          textfont: { size: 12 },
          hoverinfo: "x+y",
        },
      ], {
        ...layout,
        title: {
          text: `Change Over ${windowKey} (${earliestTime} → ${latestTime})`,
          x: 0.5,
        },
        yaxis: { title: "% Change" },
        bargap: 0.3,
        bargroupgap: 0.1,
        xaxis: {
          type: "category",
          categoryorder: "array",
          tickangle: -45,
          tickfont: { size: 11 },
        },
        showlegend: false,
      }, { responsive: true });
    } else {
      Plotly.react(changeRef.current, [], {
        ...layout,
        title: { text: `Change Over ${windowKey} (Only 1 point)`, x: 0.5 },
        annotations: [
          {
            text: "Not enough data to compare",
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { size: 16, color: isDark ? "#aaa" : "#666" },
          },
        ],
      }, { responsive: true });
    }

    window.__DASH_READY__ = true;
  }

  useEffect(() => {
    if (loading || !rows.length) return;
    renderAll();
  }, [rows, theme, windowKey, showMarkers, loading]);

  function formatUpdatedAt(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
  }

  return (
    <div className="app">
      <header className="topHeader">
        <div className="title">Weather & Air Quality Change Analyzer</div>
        <button
          className="themeToggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <div className="mainGrid">
        <section className="dashboard">
          <div className="filtersBar">
            <div className="segmented">
              {WINDOWS.map((w) => (
                <button
                  key={w.key}
                  className={`segBtn ${windowKey === w.key ? "segOn" : ""}`}
                  onClick={() => setWindowKey(w.key)}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={showMarkers}
                onChange={(e) => setShowMarkers(e.target.checked)}
              />
              <span>Markers</span>
            </label>

            <div className="meta">
              <div>
                Last fetched: {rows.length ? formatUpdatedAt(rows[rows.length - 1]?.fetched_at) : "—"}
              </div>
              <div>
                Latest PM2.5: {latestSnapshot ? num(latestSnapshot.pm25) ?? "—" : "—"} µg/m³
              </div>
            </div>
          </div>

          <div className="chartsScroll">
            {(loading || loadError) && (
              <div className={`stateBox ${loadError ? "error" : ""}`}>
                {loading ? "Loading data…" : `Error: ${loadError}`}
              </div>
            )}

            <div className="chartsGrid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
              <div className="card">
                <h3>PM2.5 & PM10 Over Time</h3>
                <div id="pmChart" style={{ height: "350px" }} ref={pmRef} />
              </div>

              <div className="card">
                <h3>Temperature Over Time</h3>
                <div id="tempChart" style={{ height: "350px" }} ref={tempRef} />
              </div>

              <div className="card">
                <h3>Humidity Over Time</h3>
                <div id="humChart" style={{ height: "350px" }} ref={humRef} />
              </div>

              <div className="card">
                <h3>AQI Levels (Bar)</h3>
                <div id="aqiChart" style={{ height: "350px" }} ref={aqiRef} />
              </div>

              <div className="card">
                <h3>Latest Pollutant Distribution</h3>
                <div id="pieChart" style={{ height: "350px" }} ref={pieRef} />
              </div>

              <div className="card">
                <h3>Change Comparison (Latest vs Previous)</h3>
                <div id="changeChart" style={{ height: "350px" }} ref={changeRef} />
              </div>
            </div>
          </div>
        </section>

        {/* VLM + Chat Panel */}
        <aside className="analysisPanel">
          {/* Your existing VLM analysis card */}
          <div className="analysisCard">
            <div className="analysisHeader">
              <div className="analysisHeaderLeft">
                <div className="analysisTitle">VLM Weather & Air Quality Analysis</div>

                <button
                  className="iconBtn"
                  onClick={async () => {
                    try {
                      setAnalysisStatus("loading");
                      setAnalysisError("");

                      const res = await fetch("/api/run-analysis", { method: "POST" });
                      if (res.status === 409) {
                        const data = await res.json();
                        setAnalysisStatus("error");
                        setAnalysisError(data.error || "Analysis already running.");
                        return;
                      }
                      if (!res.ok) {
                        const txt = await res.text();
                        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
                      }

                      const data = await res.json();
                      setLatestAnalysis(data);
                      setAnalysisStatus("ok");
                    } catch (err) {
                      setAnalysisStatus("error");
                      setAnalysisError(err?.message || String(err));
                    }
                  }}
                >
                  ↻
                </button>
              </div>

              <div className="analysisMeta">
                {analysisStatus === "ok" && latestAnalysis?.created_at
                  ? formatUpdatedAt(latestAnalysis.created_at)
                  : analysisStatus === "loading"
                  ? "Loading…"
                  : analysisStatus === "none"
                  ? "No analysis yet"
                  : "Error"}
              </div>
            </div>

            <div className="analysisBody">
              {analysisStatus === "loading" && <pre className="analysisText">Loading latest analysis…</pre>}

              {analysisStatus === "none" && (
                <pre className="analysisText">
                  No analysis yet.
                  {"\n"}Make sure snapshotter and llama-server are running.
                </pre>
              )}

              {analysisStatus === "error" && (
                <pre className="analysisText">
                  Failed to fetch analysis.
                  {"\n"}
                  {analysisError}
                </pre>
              )}

              {analysisStatus === "ok" && latestAnalysis && (
                <>
                  {latestAnalysis.parsed_json ? (
                    (() => {
                      const a = latestAnalysis.parsed_json;

                      const summary = a.summary ?? "No summary available.";
                      const graphs = a.graph_descriptions || [];
                      const pmGraph = graphs.find((g) => g.graph_title.includes("PM2.5")) || {};
                      const tempGraph = graphs.find((g) => g.graph_title.includes("Temperature")) || {};
                      const humGraph = graphs.find((g) => g.graph_title.includes("Humidity")) || {};
                      const aqiGraph = graphs.find((g) => g.graph_title.includes("AQI")) || {};
                      const pieGraph = graphs.find((g) => g.graph_title.includes("Pollutant")) || {};
                      const changeGraph = graphs.find((g) => g.graph_title.includes("Change")) || {};

                      return (
                        <div className="analysisText" style={{ whiteSpace: "normal", fontSize: "14px", lineHeight: 1.45 }}>
                          {/* Summary */}
                          <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #444" }}>
                            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "16px" }}>Summary</div>
                            <div>{summary}</div>
                          </div>

                          {/* PM2.5 & PM10 */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#f97316" }}>
                              PM2.5 & PM10 Over Time
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Visible recent values:</strong> {pmGraph.visible_recent_values || "—"}</div>
                              <div><strong>Trend:</strong> {pmGraph.trend || "—"}</div>
                              <div><strong>Recent change:</strong> {pmGraph.recent_change_3_5min || "—"}</div>
                            </div>
                          </div>

                          {/* Temperature */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#ef4444" }}>
                              Temperature Over Time
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Visible recent values:</strong> {tempGraph.visible_recent_values || "—"}</div>
                              <div><strong>Trend:</strong> {tempGraph.trend || "—"}</div>
                              <div><strong>Recent change:</strong> {tempGraph.recent_change_3_5min || "—"}</div>
                            </div>
                          </div>

                          {/* Humidity */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#3b82f6" }}>
                              Humidity Over Time
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Visible recent values:</strong> {humGraph.visible_recent_values || "—"}</div>
                              <div><strong>Trend:</strong> {humGraph.trend || "—"}</div>
                              <div><strong>Recent change:</strong> {humGraph.recent_change_3_5min || "—"}</div>
                            </div>
                          </div>

                          {/* AQI */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#ef4444" }}>
                              AQI Levels (Bar)
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Visible recent value:</strong> {aqiGraph.visible_recent_value || "—"}</div>
                              <div><strong>Trend:</strong> {aqiGraph.trend || "—"}</div>
                              <div><strong>Health risk:</strong>{" "}
                                <span style={{ color: aqiGraph.health_risk?.includes("Unhealthy") ? "#ef4444" : "#22c55e" }}>
                                  {aqiGraph.health_risk || "—"}
                                </span>
                              </div>
                              <div><strong>Recent change:</strong> {aqiGraph.recent_change_3_5min || "—"}</div>
                            </div>
                          </div>

                          {/* Pie */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>
                              Latest Pollutant Distribution
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Values:</strong> {pieGraph.visible_values || "—"}</div>
                              <div><strong>Dominant:</strong> {pieGraph.dominant_pollutant || "—"}</div>
                              <div>{pieGraph.description || "—"}</div>
                            </div>
                          </div>

                          {/* Change Comparison */}
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>
                              Change Comparison
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: "13px" }}>
                              <div><strong>Changes:</strong> {changeGraph.visible_changes || "—"}</div>
                              <div><strong>Trend:</strong> {changeGraph.overall_change_trend || "—"}</div>
                              <div>{changeGraph.description || "—"}</div>
                            </div>
                          </div>

                          {/* Overall */}
                          <div style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid #444" }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Overall</div>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div><strong>Trend:</strong> {a.overall_trend || "—"}</div>
                              <div><strong>Note:</strong> {a.health_weather_note || "—"}</div>
                            </div>
                          </div>

                          {/* Relationships */}
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Relationships</div>
                            {a.relationships?.length > 0 ? (
                              <ul style={{ margin: "0 0 0 18px", paddingLeft: 0, listStyle: "disc" }}>
                                {a.relationships.map((r, idx) => (
                                  <li key={idx} style={{ marginBottom: 6 }}>
                                    {r.statement}{" "}
                                    <span style={{ opacity: 0.7, fontSize: "12px" }}>
                                      (conf={typeof r.confidence === "number" ? r.confidence.toFixed(2) : "?"})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div style={{ opacity: 0.7 }}>No relationships returned.</div>
                            )}
                          </div>

                          {/* Confidence Notes */}
                          {a.confidence_notes?.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{ fontWeight: 700, marginBottom: 6 }}>Confidence notes</div>
                              <ul style={{ margin: "0 0 0 18px", paddingLeft: 0, listStyle: "disc", fontSize: "13px" }}>
                                {a.confidence_notes.map((note, idx) => (
                                  <li key={idx}>{note}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Raw */}
                          {showRaw && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontWeight: 700, marginBottom: 6 }}>Raw model output</div>
                              <pre style={{
                                background: "rgba(0,0,0,0.3)",
                                padding: "12px",
                                borderRadius: "6px",
                                overflowX: "auto",
                                fontSize: "12px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all"
                              }}>
                                {latestAnalysis.model_output_raw ?? "(missing)"}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <pre className="analysisText" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      Parsed JSON missing. Enable Raw to inspect output.
                    </pre>
                  )}
                </>
              )}
            </div>

            <div className="analysisFooter">
              <button className="btn secondary" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide Raw" : "Show Raw"}
              </button>
            </div>
          </div>

          {/* Interactive Chat Panel */}
          <button
            className="analysisChatFab"
            type="button"
            onClick={openChat}
            disabled={chatOpen}
            aria-label="Ask the VLM"
            title="Ask about the dashboard"
          >
            💬
          </button>

          <div
            className={`analysisChatOverlay ${chatOpen ? "open" : ""}`}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeChat();
            }}
          >
            <div className="analysisChatPanel">
              <div className="analysisChatHeader">
                <div className="analysisChatTitle">Ask the Dashboard</div>
                <button
                  className="analysisChatClose"
                  type="button"
                  onClick={closeChat}
                  aria-label="Close chat"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div className="analysisChatMessages">
                {chatMessages.length === 0 && (
                  <div className="analysisChatMsg isAssistant">
                    Hello! I can help you understand the weather and air quality data.  
                    Try asking:  
                    • "What is the current AQI?"  
                    • "Is PM2.5 increasing?"  
                    • "Compare temperature and humidity"  
                    • "Why is the air unhealthy?"
                  </div>
                )}

                {chatMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`analysisChatMsg ${m.role === "user" ? "isUser" : "isAssistant"}`}
                  >
                    {m.text}
                  </div>
                ))}

                {isSending && (
                  <div className="analysisChatMsg isAssistant">
                    <span className="typing-dot">Analyzing...</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <form className="analysisChatInputRow" onSubmit={sendChat}>
                <input
                  className="analysisChatInput"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={isSending ? "Thinking..." : "Ask about the dashboard…"}
                  autoFocus={chatOpen}
                  disabled={isSending}
                />
                <button
                  className="analysisChatSend"
                  type="submit"
                  disabled={isSending || !chatInput.trim()}
                >
                  {isSending ? "..." : "Send"}
                </button>
              </form>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}