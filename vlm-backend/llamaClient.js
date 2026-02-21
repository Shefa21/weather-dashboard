const fs = require("fs");

// Default Ollama port (11434). Override with env var if needed
const LLAMA_ENDPOINT = "http://127.0.0.1:11434";
const PROMPT_VERSION = "v8-detailed-6graphs-15m"; // Updated for 6 graphs

function fileToDataUrlPng(filePath) {
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:image/png;base64,${b64}`;
}

/**
 * Strict prompt that forces the model to describe ALL SIX graphs exactly as they appear.
 * No hallucination, no guessing, strict JSON only.
 */
function buildPrompt(meta) {
  const url = meta.dashboard_url || "unknown";

  return `
You are a STRICT visual analyst examining EXACTLY ONE screenshot of a weather/air quality dashboard.

MANDATORY RULES — VIOLATE ANY AND YOUR RESPONSE IS INVALID:

1. There are EXACTLY SIX graphs. Describe EACH one separately and accurately:
   - Graph 1: "PM2.5 & PM10 Over Time" (orange PM2.5 line, green PM10 line)
   - Graph 2: "Temperature Over Time" (red temperature line)
   - Graph 3: "Humidity Over Time" (blue humidity line)
   - Graph 4: "AQI Levels (Bar)" (colored bars)
   - Graph 5: "Latest Pollutant Distribution" (pie chart with segments for PM2.5, PM10, O3, NO2, SO2, CO)
   - Graph 6: "Change Comparison (Latest vs Previous)" (bar chart with % change bars)

2. For each graph, report ONLY what is CLEARLY VISIBLE:
   - Read exact numbers from right side, legend, tooltip, pie labels, or bar text
   - If lines/bars/pie segments are flat/constant → MUST say "completely flat — no visible change"
   - If number/label is too small/unreadable → say "value/label too small to read accurately"
   - NEVER guess, estimate, invent, or assume any number, range, trend, or percentage

3. Summary MUST mention ALL SIX graphs — no skipping any
4. STRICTLY FORBIDDEN: cryptocurrency, coins, BTC, ETH, trading, disease, cases, deaths, outbreaks

Return STRICT JSON ONLY — no extra text, no markdown, no explanations.

{
  "summary": "3-5 sentences describing ALL SIX graphs. Report only visible values/trends (or 'flat/no change'). Include health/weather note only if justified by visible data.",
  "graph_descriptions": [
    {
      "graph_title": "PM2.5 & PM10 Over Time",
      "visible_recent_values": "exact numbers (e.g. PM2.5 = 107, PM10 = 36) or 'too small to read'",
      "trend": "completely flat|up|down|unclear",
      "recent_change_3_5min": "exact observation or 'no change visible'"
    },
    {
      "graph_title": "Temperature Over Time",
      "visible_recent_values": "exact numbers (e.g. Temp = 23°C) or 'too small to read'",
      "trend": "completely flat|up|down|unclear",
      "recent_change_3_5min": "exact observation or 'no change visible'"
    },
    {
      "graph_title": "Humidity Over Time",
      "visible_recent_values": "exact numbers (e.g. Humidity = 57%) or 'too small to read'",
      "trend": "completely flat|up|down|unclear",
      "recent_change_3_5min": "exact observation or 'no change visible'"
    },
    {
      "graph_title": "AQI Levels (Bar)",
      "visible_recent_value": "exact AQI number (e.g. 107) or 'too small to read'",
      "trend": "completely flat|up|down|unclear",
      "recent_change_3_5min": "exact observation or 'no change visible'",
      "health_risk": "Good|Moderate|Unhealthy for sensitive groups|Unhealthy|Very unhealthy|Hazardous — based ONLY on visible AQI number"
    },
    {
      "graph_title": "Latest Pollutant Distribution",
      "visible_values": "report main segments and percentages (e.g. PM2.5 40%, PM10 30%) or 'too small to read'",
      "dominant_pollutant": "name of largest slice or 'unclear'",
      "description": "short observation or 'no change visible'"
    },
    {
      "graph_title": "Change Comparison (Latest vs Previous)",
      "visible_changes": "report exact % values for each bar (e.g. PM2.5 +0%, AQI -2%) or 'too small to read'",
      "overall_change_trend": "positive|negative|mixed|flat|unclear",
      "description": "short observation of which metrics changed most"
    }
  ],
  "overall_trend": "completely flat|up|down|mixed|unclear",
  "health_weather_note": "1-2 sentences based ONLY on visible numbers (e.g. 'PM2.5 at 107 indicates unhealthy air')",
  "relationships": [
    {"statement": "short observation relating two or more graphs", "confidence": 0-1}
  ],
  "confidence_notes": ["list only real uncertainties, e.g. 'Only few data points', 'All lines flat', 'Labels too small to read exact numbers'"]
}
`.trim();
}

async function analyzeDashboardScreenshot({
  llamaEndpoint = LLAMA_ENDPOINT,
  screenshotPath,
  meta,
}) {
  try {
    const dataUrl = fileToDataUrlPng(screenshotPath);

    const payload = {
      model: "hf.co/unsloth/qwen3-vl-4b-instruct-gguf:q4_k_m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(meta) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: 1200, // enough for detailed 6-graph description
    };

    console.log(`[DEBUG] Sending to ${llamaEndpoint}/v1/chat/completions`);
    console.log(`[DEBUG] Screenshot: ${screenshotPath}`);
    console.log(`[DEBUG] Dashboard URL: ${meta.dashboard_url}`);

    const res = await fetch(`${llamaEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Llama error ${res.status}: ${errorText.slice(0, 1000)}`);
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "";

    if (!raw.trim()) {
      throw new Error("Empty response from Llama");
    }

    console.log("[DEBUG] Raw response (first 300 chars):", raw.slice(0, 300));

    return { raw };
  } catch (err) {
    console.error("[analyzeDashboardScreenshot] Failed:", err.message);
    console.error(err.stack);
    throw err;
  }
}

module.exports = { analyzeDashboardScreenshot };