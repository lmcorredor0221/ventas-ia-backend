import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-camera.json"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
            page.get_by_role("button", name="Usar acceso local de desarrollo").click()
            page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        page.wait_for_timeout(600)

        initial = collect_camera(page)
        page.get_by_role("button", name="Acercar cámara").click()
        page.wait_for_timeout(250)
        zoomed = collect_camera(page)
        page.get_by_role("button", name="Mover cámara a la derecha").click()
        page.wait_for_timeout(250)
        panned = collect_camera(page)
        page.locator(".zone-jump-catalog").click()
        page.wait_for_timeout(350)
        focused = collect_camera(page)
        dispatch_stage_wheel(page, -260)
        page.wait_for_timeout(300)
        wheel_zoomed = collect_camera(page)
        dispatch_stage_drag(page, 46, -24)
        page.wait_for_timeout(250)
        stage_dragged = collect_camera(page)
        page.get_by_role("button", name="Restablecer cámara").click()
        page.wait_for_timeout(250)
        reset = collect_camera(page)
        page.screenshot(path=str(ROOT / "test-results-tienda-viva-camera-mobile.png"), full_page=True)
        browser.close()

    results = {
        "initial": initial,
        "zoomed": zoomed,
        "panned": panned,
        "focused": focused,
        "wheelZoomed": wheel_zoomed,
        "stageDragged": stage_dragged,
        "reset": reset,
        "consoleErrors": console_errors,
        "passed": (
            zoomed["scale"] > initial["scale"]
            and panned["x"] != zoomed["x"]
            and focused["activeZone"] == "catalog"
            and focused["transform"] != panned["transform"]
            and wheel_zoomed["scale"] > focused["scale"]
            and stage_dragged["x"] != wheel_zoomed["x"]
            and reset["scale"] == 1
            and abs(reset["x"]) <= 1
            and abs(reset["y"]) <= 1
            and not reset["overflowX"]
        ),
    }
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if not results["passed"]:
        raise SystemExit(1)


def collect_camera(page):
    return page.evaluate(
        """() => {
          const map = document.querySelector('.store-map');
          const stage = document.querySelector('.store-camera-stage');
          return {
            scale: Number(map?.dataset.cameraScale || '0'),
            x: Number(stage?.dataset.cameraX || '0'),
            y: Number(stage?.dataset.cameraY || '0'),
            transform: stage ? getComputedStyle(stage).transform : '',
            activeZone: document.querySelector('.zone-focus-panel')?.dataset.zone || '',
            gesture: map?.dataset.cameraGesture || '',
            controls: document.querySelectorAll('.camera-dock button').length,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        }"""
    )


def dispatch_stage_wheel(page, delta_y):
    page.evaluate(
        """(deltaY) => {
          const stage = document.querySelector('.store-camera-stage');
          stage?.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY,
          }));
        }""",
        delta_y,
    )


def dispatch_stage_drag(page, dx, dy):
    page.evaluate(
        """({ dx, dy }) => {
          const stage = document.querySelector('.store-camera-stage');
          const rect = stage?.getBoundingClientRect();
          if (!stage || !rect) return;
          const startX = rect.left + rect.width * 0.42;
          const startY = rect.top + rect.height * 0.72;
          const base = { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', isPrimary: true };
          stage.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: startX, clientY: startY }));
          stage.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: startX + dx, clientY: startY + dy }));
          stage.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: startX + dx, clientY: startY + dy }));
        }""",
        {"dx": dx, "dy": dy},
    )


if __name__ == "__main__":
    main()
