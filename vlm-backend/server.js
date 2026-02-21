const express = require("express");
const db = require("./db");
const { runAnalysisOnce } = require("./runOnce");

// ✅ ADD THESE
const { captureDashboardState } = require("./interactiveAnalyzer");
const { analyzeDashboardScreenshot, setCustomPrompt } = require("./analyze"); // adjust path if needed

const app = express();
app.use(express.json());

let isRunning = false;

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ===============================
   ASK VLM ROUTE (NEW)
================================= */
app.post("/api/ask-vlm", async (req, res) => {
  const { question } = req.body;

  if (!question?.trim()) {
    return res.status(400).json({ error: "Question is required" });
  }

  try {
    // 1️⃣ Parse timeframe from question
    let timeframe = null;
    const timeframeMatch = question.match(/(15m|1h|6h|24h|all)/i);
    if (timeframeMatch) {
      timeframe = timeframeMatch[1].toLowerCase();
    }

    // 2️⃣ Capture dashboard screenshot
    const result = await captureDashboardState({ timeframe });

    if (!result.success) {
      return res
        .status(500)
        .json({ error: result.error || "Failed to capture dashboard" });
    }

    const screenshotPath = result.snapshots[0].path;

    // 3️⃣ Prepare meta info
    const meta = {
      captured_at_iso: new Date().toISOString(),
      dashboard_url: "http://localhost:5175",
    };

    // 4️⃣ Custom prompt (FIXED STRING)
    const customPrompt = `
You are analyzing ONE screenshot of a weather/air quality dashboard.
User question: "${question}"

Answer the question based ONLY on what is visible in the screenshot.
Focus on recent data (right side of lines/bars).
Use exact numbers if readable, or approximate ranges.
Be concise, natural, and accurate.
`.trim();

    setCustomPrompt(customPrompt);

    // 5️⃣ Send to VLM
    const { raw } = await analyzeDashboardScreenshot({
      llamaEndpoint: "http://127.0.0.1:11434",
      screenshotPath,
      meta,
    });

    // 6️⃣ Clean response
    const answer = raw
      ?.trim()
      ?.replace(/```json/g, "")
      ?.replace(/```/g, "")
      ?.trim();

    res.json({ answer });
  } catch (err) {
    console.error("Ask VLM error:", err);
    res.status(500).json({ error: "Could not reach the dashboard bot" });
  }
});

/* ===============================
   EXISTING ROUTES
================================= */

app.get("/api/latest-analysis", (req, res) => {
  const row = db
    .prepare("SELECT * FROM analyses ORDER BY created_at DESC LIMIT 1")
    .get();

  if (!row) return res.status(404).json({ error: "No analyses yet" });

  res.json({
    id: row.id,
    created_at: row.created_at,
    dashboard_url: row.dashboard_url,
    screenshot_path: row.screenshot_path,
    prompt_version: row.prompt_version,
    model_endpoint: row.model_endpoint,

    model_output_raw: row.model_output_raw ?? row.raw_response,
    parsed_json: row.parsed_json ? JSON.parse(row.parsed_json) : null,
    parse_ok: row.parse_ok === 1,

    screenshots: row.screenshots_json
      ? JSON.parse(row.screenshots_json)
      : [row.screenshot_path],
    meta: row.meta_json ? JSON.parse(row.meta_json) : null,
  });
});

app.get("/api/analyses", (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, created_at, screenshot_path, prompt_version FROM analyses ORDER BY created_at DESC LIMIT 50"
    )
    .all();

  res.json(rows);
});

app.post("/api/run-analysis", async (req, res) => {
  if (isRunning) {
    return res
      .status(409)
      .json({ error: "Analysis is already running. Try again in a moment." });
  }

  isRunning = true;
  try {
    const result = await runAnalysisOnce();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  } finally {
    isRunning = false;
  }
});

const PORT = 8787;
app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});