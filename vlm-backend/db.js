const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "vlm.sqlite");
const db = new Database(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    dashboard_url TEXT NOT NULL,
    screenshot_path TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model_endpoint TEXT NOT NULL,
    raw_response TEXT NOT NULL,
    parsed_json TEXT
  );
`);

function ensureColumn(table, columnName, columnType) {
  const cols = db.prepare(`PRAGMA table_info(${table});`).all();
  const exists = cols.some((c) => c.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnType};`);
  }
}

// New columns (normalized-ish)
ensureColumn("analyses", "screenshots_json", "TEXT"); // JSON array of screenshot paths
ensureColumn("analyses", "meta_json", "TEXT"); // JSON object (trusted context)
ensureColumn("analyses", "model_output_raw", "TEXT"); // raw text from model (should be JSON string)
ensureColumn("analyses", "parse_ok", "INTEGER"); // 1/0 quick filter

module.exports = db;
