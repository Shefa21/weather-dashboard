
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function captureDashboardState(instructions = {}) {
  // instructions can include: { timeframe: "1h" | "24h" | ... }
  const browser = await chromium.launch({ headless: true }); // change to false for debug
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1800 }, // tall enough for all 6 graphs
    deviceScaleFactor: 1.2,
  });
  const page = await context.newPage();
  const snapshots = [];

  try {
    console.log("[Analyzer] Opening dashboard...");
    await page.goto("http://localhost:5175", { waitUntil: "networkidle", timeout: 60000 });

    // Wait for dashboard ready
    await page.waitForFunction(() => window.__DASH_READY__ === true, null, {
      timeout: 60000,
    });

    // 1. Apply timeframe if requested
    if (instructions.timeframe) {
      const timeframeMap = {
        "15m": "15m",
        "1h": "1h",
        "6h": "6h",
        "24h": "24h",
        "all": "All",
      };
      const label = timeframeMap[instructions.timeframe.toLowerCase()] || "1h";

      try {
        console.log(`[Analyzer] Setting timeframe to ${label}`);
        await page
          .locator("button.segBtn")
          .getByText(label, { exact: true })
          .click();
        await page.waitForTimeout(1500); // wait for charts to reload
      } catch (e) {
        console.warn(`[Analyzer] Could not set timeframe ${label}:`, e.message);
      }
    }

    // 2. Extra settle time for all graphs to render
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // 3. Take full screenshot
    const ts = Date.now();
    const filename = `chat_analysis_${ts}.png`;
    const dir = path.join(__dirname, "query_snapshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);

    console.log(`[Analyzer] Capturing screenshot: ${filename}`);
    await page.screenshot({ path: filepath, fullPage: true });

    snapshots.push({ path: filepath, label: "Current Dashboard" });

    return { success: true, snapshots };
  } catch (e) {
    console.error("[Analyzer] Error:", e.message);
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

module.exports = { captureDashboardState };