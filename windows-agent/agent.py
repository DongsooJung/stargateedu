import os
import time
from pathlib import Path
from typing import Literal, Optional

import pyautogui
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pywinauto import Desktop
from pywinauto.application import Application

app = FastAPI(title="Stargate Windows RPA Agent", version="0.1.0")
SCREENSHOT_DIR = Path(os.getenv("STARGATE_SCREENSHOT_DIR", "screenshots"))
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)


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
    seconds: float = 1.0
    screenshot_name: Optional[str] = None


class RunRequest(BaseModel):
    actions: list[Action]


def find_window(title_re: str):
    window = Desktop(backend="uia").window(title_re=title_re)
    window.wait("visible", timeout=15)
    return window


def run_action(action: Action):
    if action.type == "launch":
        if not action.executable:
            raise ValueError("executable is required")
        Application(backend="uia").start(action.executable)
        return {"ok": True, "action": "launch"}

    if action.type == "list_windows":
        titles = []
        for win in Desktop(backend="uia").windows():
            try:
                title = win.window_text().strip()
                if title:
                    titles.append(title)
            except Exception:
                pass
        return {"ok": True, "windows": titles}

    if action.type == "wait":
        time.sleep(max(action.seconds, 0))
        return {"ok": True, "action": "wait", "seconds": action.seconds}

    if action.type == "screenshot":
        filename = action.screenshot_name or f"shot-{int(time.time())}.png"
        path = SCREENSHOT_DIR / filename
        pyautogui.screenshot(str(path))
        return {"ok": True, "path": str(path)}

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
    return {"ok": True, "service": "stargate-windows-agent"}


@app.post("/run")
def run(request: RunRequest):
    results = []
    for index, action in enumerate(request.actions):
        try:
            results.append(run_action(action))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"index": index, "action": action.type, "error": str(exc)},
            ) from exc
    return {"ok": True, "results": results}
