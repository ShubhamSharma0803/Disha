"""EventBus: emit structured events as JSON lines to stdout (and registered callbacks)."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Callable

_callbacks: list[Callable[[dict[str, Any]], None]] = []


def register(callback: Callable[[dict[str, Any]], None]) -> None:
    _callbacks.append(callback)


def unregister(callback: Callable[[dict[str, Any]], None]) -> None:
    _callbacks.remove(callback)


def clear() -> None:
    _callbacks.clear()


def emit(event: dict[str, Any]) -> dict[str, Any]:
    """Fill timestamp, ensure type matches event, print as JSON line, call all callbacks, return the event."""
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    if "event" in event and "type" not in event:
        event["type"] = event["event"]
    elif "type" in event and "event" not in event:
        event["event"] = event["type"]
    line = json.dumps(event, default=str)
    print(line, file=sys.stdout, flush=True)
    for cb in _callbacks:
        cb(event)
    return event
