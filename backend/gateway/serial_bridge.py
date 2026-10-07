"""ESP32 serial bridge – a standalone process that reads from a real or mock
serial port and forwards parsed packets to the backend via POST /bridge/ingest.

Usage
-----
Mock mode (reads from default mock_serial.txt, runs once):
    py -m backend.gateway.serial_bridge --mock

Mock mode with custom file and looping:
    py -m backend.gateway.serial_bridge --mock path/to/file.txt --loop

Real ESP32 on COM3:
    py -m backend.gateway.serial_bridge --port COM3

Full options:
    --port PORT           Serial port (default: COM3 / /dev/ttyUSB0)
    --speed BAUD          Baud rate (default: 115200)
    --mock [FILE]         Use a mock text file (default: mock_serial.txt).
                          FILE is optional; omit for the bundled default.
    --loop                Loop the mock file indefinitely
    --backend-url URL     Backend base URL (default: http://localhost:8000)
    --delay SECONDS       Base delay between mock lines in seconds (default: 0.5)

Mock file directives (processed at read-time, not sent to backend):
    # wait N              Sleep N / speed seconds before the next line.
                          speed is args.delay (so --delay 0.1 speeds everything up).
    # comment             Any line starting with '#' (except '# wait') is skipped.
    blank lines           Silently skipped.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

import httpx

from backend.gateway.serial_parser import parse_line

_DEFAULT_MOCK_FILE = os.path.join(os.path.dirname(__file__), "mock_serial.txt")
RECONNECT_DELAY = 3.0       # seconds before retrying a dropped serial connection
STATUS_INTERVAL = 3.0       # seconds between POST /bridge/status heartbeats


# ---------------------------------------------------------------------------
# Shared counters (updated by both mock and serial runners)
# ---------------------------------------------------------------------------

class _Counters:
    received: int = 0
    ignored: int = 0


_cnt = _Counters()


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

async def _post(client: httpx.AsyncClient, url: str, body: dict) -> None:
    try:
        r = await client.post(url, json=body, timeout=5.0)
        r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        print(f"[bridge] HTTP {exc.response.status_code}: {exc.response.text[:200]}")
    except Exception as exc:
        print(f"[bridge] POST failed: {exc}")


async def _report_status(
    client: httpx.AsyncClient,
    status_url: str,
    mode: str,
    port: str | None,
    connected: bool,
) -> None:
    body = {
        "mode": mode,
        "port": port,
        "connected": connected,
        "packets_received": _cnt.received,
        "packets_ignored": _cnt.ignored,
    }
    try:
        r = await client.post(status_url, json=body, timeout=5.0)
        r.raise_for_status()
    except Exception as exc:
        print(f"[bridge] status report failed: {exc}")


# ---------------------------------------------------------------------------
# Status heartbeat task (runs as a background asyncio task)
# ---------------------------------------------------------------------------

async def _status_loop(
    client: httpx.AsyncClient,
    status_url: str,
    mode: str,
    port: str | None,
    connected_flag: list[bool],   # mutable single-element list so callers can update it
) -> None:
    while True:
        await asyncio.sleep(STATUS_INTERVAL)
        await _report_status(client, status_url, mode, port, connected_flag[0])


# ---------------------------------------------------------------------------
# Mock source
# ---------------------------------------------------------------------------

async def _run_mock(
    client: httpx.AsyncClient,
    ingest_url: str,
    status_url: str,
    mock_file: str,
    delay: float,
    loop: bool,
) -> None:
    print(f"[bridge] Mock mode  file={mock_file}  delay={delay}s  loop={loop}")
    connected_flag = [True]

    # Report initial status
    await _report_status(client, status_url, "mock", mock_file, True)

    # Background heartbeat
    hb_task = asyncio.create_task(
        _status_loop(client, status_url, "mock", mock_file, connected_flag)
    )

    try:
        while True:
            try:
                with open(mock_file, encoding="utf-8") as fh:
                    lines = fh.readlines()
            except FileNotFoundError:
                print(f"[bridge] Mock file not found: {mock_file}")
                return

            for raw in lines:
                stripped = raw.strip()

                # Directive: # wait N
                if stripped.lower().startswith("# wait"):
                    parts = stripped.split()
                    try:
                        secs = float(parts[2]) * delay  # scale by delay factor
                    except (IndexError, ValueError):
                        secs = delay
                    await asyncio.sleep(secs)
                    continue

                # Any other comment or blank line
                if stripped.startswith("#") or not stripped:
                    continue

                parsed = parse_line(raw)
                if parsed is None:
                    _cnt.ignored += 1
                    continue

                _cnt.received += 1
                print(f"[bridge] mock -> {parsed['kind']}  node={parsed.get('node')}")
                await _post(client, ingest_url, parsed)
                await asyncio.sleep(delay)

            if not loop:
                break

    finally:
        hb_task.cancel()

    print("[bridge] Mock source exhausted – exiting.")
    connected_flag[0] = False
    await _report_status(client, status_url, "mock", mock_file, False)


# ---------------------------------------------------------------------------
# Real serial source
# ---------------------------------------------------------------------------

async def _run_serial(
    client: httpx.AsyncClient,
    ingest_url: str,
    status_url: str,
    port: str,
    speed: int,
) -> None:
    try:
        import serial          # type: ignore
        import serial.serialutil  # type: ignore
    except ImportError:
        print("[bridge] pyserial not installed. Run: pip install pyserial")
        sys.exit(1)

    print(f"[bridge] Real serial mode  port={port}  baud={speed}")
    connected_flag = [False]

    await _report_status(client, status_url, "live", port, False)
    hb_task = asyncio.create_task(
        _status_loop(client, status_url, "live", port, connected_flag)
    )

    try:
        while True:
            try:
                ser = serial.Serial(port, speed, timeout=1)
                connected_flag[0] = True
                print(f"[bridge] Connected to {port}")
                await _report_status(client, status_url, "live", port, True)

                while True:
                    try:
                        raw = ser.readline().decode("utf-8", errors="replace")
                    except Exception as exc:
                        print(f"[bridge] Read error: {exc}")
                        break

                    parsed = parse_line(raw)
                    if parsed is None:
                        _cnt.ignored += 1
                        continue

                    _cnt.received += 1
                    print(f"[bridge] hw -> {parsed['kind']}  node={parsed.get('node')}")
                    await _post(client, ingest_url, parsed)

                ser.close()

            except (OSError, serial.serialutil.SerialException) as exc:
                print(f"[bridge] Serial error: {exc}  retrying in {RECONNECT_DELAY}s …")

            connected_flag[0] = False
            await _report_status(client, status_url, "live", port, False)
            await asyncio.sleep(RECONNECT_DELAY)

    finally:
        hb_task.cancel()
        connected_flag[0] = False
        await _report_status(client, status_url, "live", port, False)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def _main(args: argparse.Namespace) -> None:
    base = args.backend_url.rstrip("/")
    ingest_url = base + "/bridge/ingest"
    status_url = base + "/bridge/status"
    print(f"[bridge] Ingesting to  {ingest_url}")
    print(f"[bridge] Status reports {status_url}")

    async with httpx.AsyncClient() as client:
        if args.mock is not None:
            # args.mock is either the explicit file path or the sentinel default
            mock_file = args.mock if args.mock else _DEFAULT_MOCK_FILE
            await _run_mock(
                client, ingest_url, status_url,
                mock_file=mock_file,
                delay=args.delay,
                loop=args.loop,
            )
        else:
            await _run_serial(client, ingest_url, status_url, port=args.port, speed=args.speed)


def main() -> None:
    import platform
    default_port = "COM3" if platform.system() == "Windows" else "/dev/ttyUSB0"

    parser = argparse.ArgumentParser(description="ESP32 serial bridge for Disha")
    parser.add_argument("--port", default=default_port, help="Serial port (live mode)")
    parser.add_argument("--speed", type=int, default=115200, help="Baud rate")
    # --mock accepts an optional file path; nargs='?' gives None when flag absent,
    # empty string '' when flag present with no value (we normalise below).
    parser.add_argument(
        "--mock",
        nargs="?",
        const=_DEFAULT_MOCK_FILE,   # value when --mock with no argument
        default=None,               # value when --mock not present at all
        metavar="FILE",
        help="Use mock text file (default: mock_serial.txt)",
    )
    parser.add_argument("--loop", action="store_true", help="Loop mock file")
    parser.add_argument("--backend-url", default="http://localhost:8000", help="Backend URL")
    parser.add_argument("--delay", type=float, default=0.5,
                        help="Base delay between mock lines in seconds (default: 0.5)")
    args = parser.parse_args()

    asyncio.run(_main(args))


if __name__ == "__main__":
    main()
