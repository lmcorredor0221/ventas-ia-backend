import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-camera-lod.json"
LOADS = [50, 200, 1000]


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for load in LOADS:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            console_errors = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.goto(f"{BASE_URL}?loadFixture={load}")
            page.wait_for_load_state("networkidle")
            if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
                page.get_by_role("button", name="Usar acceso local de desarrollo").click()
                page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Tienda viva", exact=True).click()
            page.wait_for_timeout(700)

            initial = collect_state(page)
            page.get_by_role("button", name="Acercar cámara").click()
            page.get_by_role("button", name="Mover cámara a la derecha").click()
            page.wait_for_timeout(350)
            moved = collect_state(page)
            page.locator(".zone-jump-catalog").click()
            page.wait_for_timeout(350)
            focused = collect_state(page)
            page.screenshot(path=str(ROOT / f"test-results-tienda-viva-camera-lod-{load}.png"), full_page=False)
            results[str(load)] = {
                "initial": initial,
                "moved": moved,
                "focused": focused,
                "consoleErrors": console_errors,
                "passed": (
                    initial["controls"] == 7
                    and initial["clusters"] > 0
                    and moved["scale"] > initial["scale"]
                    and moved["x"] != initial["x"]
                    and focused["activeZone"] == "catalog"
                    and focused["visibleZoneLabels"] >= 1
                    and not focused["overflowX"]
                    and focused["avatars"] <= 26
                ),
            }
            page.close()
        browser.close()

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if not all(item["passed"] for item in results.values()):
        raise SystemExit(1)


def collect_state(page):
    return page.evaluate(
        """() => {
          const visible = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
          });
          const map = document.querySelector('.store-map');
          const stage = document.querySelector('.store-camera-stage');
          return {
            lodZone: map?.classList.contains('lod-zone') || false,
            lodEnterprise: map?.classList.contains('lod-enterprise') || false,
            scale: Number(map?.dataset.cameraScale || '0'),
            x: Number(stage?.dataset.cameraX || '0'),
            y: Number(stage?.dataset.cameraY || '0'),
            activeZone: document.querySelector('.zone-focus-panel')?.dataset.zone || '',
            controls: document.querySelectorAll('.camera-dock button').length,
            clusters: document.querySelectorAll('.zone-cluster').length,
            avatars: document.querySelectorAll('.store-map button.avatar').length,
            visibleZoneLabels: visible('.zone-label strong').length,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        }"""
    )


if __name__ == "__main__":
    main()
