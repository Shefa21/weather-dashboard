import requests
import csv
import os
from datetime import datetime

CSV_PATH = "weather-dashboard/public/weather_log.csv"

# Your token
AQICN_TOKEN = "395b00a09007962c9a54a3f8e2c44baf1369a461"

# Use known Dhaka US Embassy station (reliable, always has data)
STATION_ID = 14139  # @14139 = Dhaka - US Embassy
URL = f"https://api.waqi.info/feed/@{STATION_ID}/?token={AQICN_TOKEN}"

HEADERS = {"User-Agent": "weather-dashboard-tracker"}

HEADER = [
    "fetched_at",
    "aqi",
    "pm25",
    "pm10",
    "o3",
    "no2",
    "so2",
    "co",
    "temperature",
    "humidity",
    "wind",
    "station_name",
    "time",
]

def main():
    fetched_at = datetime.now().isoformat(timespec="seconds")

    try:
        print(f"[DEBUG] Requesting station {STATION_ID}: {URL}")
        resp = requests.get(URL, headers=HEADERS, timeout=20)
        print(f"[DEBUG] Status code: {resp.status_code}")

        if resp.status_code != 200:
            print(f"[ERROR] HTTP {resp.status_code}: {resp.text[:500]}")
            return

        raw = resp.text
        print(f"[DEBUG] Raw response (first 300 chars): {raw[:300]}")

        data = resp.json()

        if data.get("status") != "ok":
            error_msg = data.get("data", "Unknown error")
            print(f"[ERROR] AQICN status not 'ok': {error_msg}")
            return

        iaqi = data["data"]["iaqi"]
        time_str = data["data"]["time"]["s"]
        station = data["data"].get("city", {}).get("name", "Unknown Station")

        row = {
    "fetched_at": fetched_at,
    "aqi": data["data"].get("aqi", 0),  # ← fixed: take from data["data"]["aqi"]
    "pm25": iaqi.get("pm25", {}).get("v", 0),
    "pm10": iaqi.get("pm10", {}).get("v", 0),
    "o3": iaqi.get("o3", {}).get("v", 0),
    "no2": iaqi.get("no2", {}).get("v", 0),
    "so2": iaqi.get("so2", {}).get("v", 0),
    "co": iaqi.get("co", {}).get("v", 0),
    "temperature": iaqi.get("t", {}).get("v", 0),
    "humidity": iaqi.get("h", {}).get("v", 0),
    "wind": iaqi.get("w", {}).get("v", 0),
    "station_name": station,
    "time": time_str,
}

        file_exists = os.path.isfile(CSV_PATH)

        with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=HEADER)
            if not file_exists:
                writer.writeheader()
            writer.writerow(row)

        print(f"Appended real AQICN data at {fetched_at} (AQI: {row['aqi']}, PM2.5: {row['pm25']}, Station: {row['station_name']})")

    except Exception as e:
        print(f"Error fetching AQICN: {e}")
        if 'resp' in locals():
            print(f"Raw response: {resp.text[:500]}")

if __name__ == "__main__":
    main()