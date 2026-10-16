import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import pyautogui
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pywinauto import Desktop
from pywinauto.application import Application

app = FastAPI(title="Stargate Windows RPA Agent", version="0.2.0")

SCREENSHOT_DIR = Path(os.getenv("STARGATE_SCREENSHOT_DIR", "screenshots"))
LOG_DIR = Path(os.getenv("STARGATE_LOG_DIR", "logs"))
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

API_TOKEN = os.getenv("STARGATE_AGENT_TOKEN", "")
ALLOWED_EXECUTABLES = {
    x.strip().lower()
    for x in os.getenv("STARGATE_ALLOWED_EXECUTABLES", "notepad.exe,calc.exe").split(",")
    if x.strip()
}
ALLOWED_ORIGINS = [
    x.strip()
    for x in os.getenv(
        "STARGATE_ALLOWED_ORIGINS",
        "https://www.stargateedu.co.kr,https://stargateedu.co.kr,http://localhost:3000",
    ).split(",")
    if x.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

RUN_LOCK = threading.Lock()
RUN_HISTORY: list[dict] = []
MAX_HISTORY = 100


class Action(BaseModel):
    type: Literal[
        "launch",
        "focus",
        "click",
        "type",
        "hotkey",
        "wait",
        "screenshot",
        "list_windows",
    ]
    executable: Optional[str] = None
    window_title_re: Optional[str] = None
    control_title: Optional[str] = None
    control_type: Optional[str] = None
    text: Optional[str] = None
    keys: list[str] = Field(default_factory=list)
    seconds: float = Field(default=1.0, ge=0, le=60)
    screenshot_name: Optional[str] = None


class RunRequest(BaseModel):
    name: str = Field(default="manual-task", max_length=120)
    actions: list[Action] = Field(min_length=1, max_length=100)


def require_token(authorization: Optional[str] = Header(default=None)):
    if not API_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="STARGATE_AGENT_TOKEN is not configured on this PC",
        )
    expected = f"Bearer {API_TOKEN}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid agent token")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def append_log(record: dict):
    RUN_HISTORY.insert(0, record)
    del RUN_HISTORY[MAX_HISTORY:]
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LOG_DIR / f"runs-{day}.jsonl"
    with path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=False) + "\n")


def find_window(title_re: str):
    window = Desktop(backend="uia").window(title_re=title_re)
    window.wait("visible", timeout=15)
    return window


def safe_screenshot_name(name: Optional[str], run_id: str):
    raw = name or f"shot-{run_id}-{int(time.time())}.png"
    safe = "".join(c for c in raw if c.isalnum() or c in ("-", "_", "."))
    if not safe.lower().endswith(".png"):
        safe += ".png"
    return safe


def run_action(action: Action, run_id: str):
    if action.type == "launch":
        if not action.executable:
            raise ValueError("executable is required")
        executable = Path(action.executable).name.lower()
        if executable not in ALLOWED_EXECUTABLES:
            raise ValueError(f"executable is not allowlisted: {executable}")
        Application(backend="uia").start(action.executable)
        return {"ok": True, "action": "launch", "executable": executable}

    if action.type == "list_windows":
        titles = []
        for win in Desktop(backend="uia").windows():
            try:
                title = win.window_text().strip()
                if title:
                    titles.append(title)
            except Exception:
                pass
        return {"ok": True, "action": "list_windows", "windows": titles[:200]}

    if action.type == "wait":
        time.sleep(action.seconds)
        return {"ok": True, "action": "wait", "seconds": action.seconds}

    if action.type == "screenshot":
        filename = safe_screenshot_name(action.screenshot_name, run_id)
        path = SCREENSHOT_DIR / filename
        pyautogui.screenshot(str(path))
        return {"ok": True, "action": "screenshot", "path": str(path)}

    if not action.window_title_re:
        raise ValueError("window_title_re is required")

    window = find_window(action.window_title_re)

    if action.type == "focus":
        window.set_focus()
        return {"ok": True, "action": "focus"}

    if action.type == "hotkey":
        window.set_focus()
        if not action.keys:
            raise ValueError("keys are required")
        pyautogui.hotkey(*action.keys)
        return {"ok": True, "action": "hotkey", "keys": action.keys}

    if not action.control_type and not action.control_title:
        raise ValueError("control_title or control_type is required")

    child_args = {}
    if action.control_title:
        child_args["title"] = action.control_title
    if action.control_type:
        child_args["control_type"] = action.control_type
    control = window.child_window(**child_args)
    control.wait("visible", timeout=10)

    if action.type == "click":
        control.click_input()
        return {"ok": True, "action": "click"}

    if action.type == "type":
        if action.text is None:
            raise ValueError("text is required")
        control.click_input()
        control.type_keys(action.text, with_spaces=True, set_foreground=True)
        return {"ok": True, "action": "type", "length": len(action.text)}

    raise ValueError(f"Unsupported action: {action.type}")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "stargate-windows-agent",
        "version": "0.2.0",
        "token_configured": bool(API_TOKEN),
        "allowed_executables": sorted(ALLOWED_EXECUTABLES),
        "busy": RUN_LOCK.locked(),
    }


@app.get("/runs", dependencies=[Depends(require_token)])
def runs():
    return {"ok": True, "runs": RUN_HISTORY}


@app.post("/run", dependencies=[Depends(require_token)])
def run(request: RunRequest):
    if not RUN_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Agent is already running another task")

    run_id = str(uuid.uuid4())
    record = {
        "id": run_id,
        "name": request.name,
        "started_at": utc_now(),
        "finished_at": None,
        "status": "running",
        "results": [],
        "error": None,
    }

    try:
        for index, action in enumerate(request.actions):
            try:
                result = run_action(action, run_id)
                record["results"].append({"index": index, **result})
            except Exception as exc:
                record["status"] = "failed"
                record["error"] = {
                    "index": index,
                    "action": action.type,
                    "message": str(exc),
                }
                raise HTTPException(status_code=400, detail=record["error"]) from exc
        record["status"] = "success"
        return {"ok": True, "run_id": run_id, "results": record["results"]}
    finally:
        record["finished_at"] = utc_now()
        append_log(record)
        RUN_LOCK.release()
