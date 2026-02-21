const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const db = require("./db");
const { analyzeDashboardScreenshot } = require("./llamaClient");

const DASHBOARD_URL = "http://localhost:5175/";
const LLAMA_ENDPOINT = "http://127.0.0.1:11434";
const PROMPT_VERSION = "v8-detailed-6graphs-15m";

// trusted context
const META_STATIC = {
  refresh_interval_sec: 60,
  snapshot_interval_min: 0, // on-demand now
};

const SNAP_DIR = path.join(__dirname, "snapshots");
if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function safeName(tsIso) {
  return tsIso.replace(/[:.]/g, "-");
}

function tryParseJsonStrict(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function runAnalysisOnce() {
  const ts = nowIso();
  const base = `dash_${safeName(ts)}`;
  const outPath = path.join(SNAP_DIR, `${base}__dashboard.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1800 }, // much taller to fit 6 graphs
    deviceScaleFactor: 1.2, // sharper text for better VLM reading
  });
  const page = await context.newPage();

  try {
    await page.goto(DASHBOARD_URL, {
      waitUntil: "networkidle", // wait for all data to load
      timeout: 90_000,
    });

    await page.waitForFunction(() => window.__DASH_READY__ === true, null, {
      timeout: 90_000,
    });

    // Extra settle + scroll to bottom
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000); // wait for any lazy loading

    // Full-page screenshot – captures everything
    await page.screenshot({
      path: outPath,
      fullPage: true,
    });

    const meta = {
      captured_at_iso: ts,
      dashboard_url: DASHBOARD_URL,
      ...META_STATIC,
    };

    const { raw } = await analyzeDashboardScreenshot({
      llamaEndpoint: LLAMA_ENDPOINT,
      screenshotPath: outPath,
      meta,
    });

    const parsed = tryParseJsonStrict(raw);

    const stmt = db.prepare(`
      INSERT INTO analyses (
        created_at, dashboard_url, screenshot_path,
        prompt_version, model_endpoint,
        raw_response, model_output_raw, parsed_json,
        screenshots_json, meta_json, parse_ok
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      ts,
      DASHBOARD_URL,
      outPath,
      PROMPT_VERSION,
      LLAMA_ENDPOINT,
      raw,
      raw,
      parsed ? JSON.stringify(parsed) : null,
      JSON.stringify([outPath]),
      JSON.stringify(meta),
      parsed ? 1 : 0
    );

    const row = db
      .prepare("SELECT * FROM analyses ORDER BY id DESC LIMIT 1")
      .get();

    return {
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
    };
  } catch (err) {
    console.error("[runAnalysisOnce] Error:", err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { runAnalysisOnce };