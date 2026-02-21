import subprocess
import time
import sys

SCRIPT = "append_weather_snapshot.py"
INTERVAL = 900  # 15 minutes - Open-Meteo updates frequently

next_run = time.time()

while True:
    result = subprocess.run([sys.executable, SCRIPT])

    if result.returncode != 0:
        print(f"[WARN] {SCRIPT} exited with code {result.returncode}")

    next_run += INTERVAL
    sleep_time = max(0, next_run - time.time())
    time.sleep(sleep_time)