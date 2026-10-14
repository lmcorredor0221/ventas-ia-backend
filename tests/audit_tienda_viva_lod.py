import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-lod.json"
LOADS = [10, 50, 200, 1000]


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for load in LOADS:
            page = browser.new_page(viewport={"width": 1440, "height": 980})
            console_errors = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            started = time.perf_counter()
            page.goto(f"{BASE_URL}?loadFixture={load}")
            page.wait_for_load_state("networkidle")
            if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
                page.get_by_role("button", name="Usar acceso local de desarrollo").click()
                page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Tienda viva", exact=True).click()
            page.wait_for_timeout(500)
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            page.screenshot(path=str(ROOT / f"test-results-tienda-viva-lod-{load}.png"), full_page=False)
            results[str(load)] = collect_metrics(page, console_errors, elapsed_ms)
            page.close()
        browser.close()
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))


def collect_metrics(page, console_errors, elapsed_ms):
    return page.evaluate(
        """({ consoleErrors, elapsedMs }) => {
          const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const map = document.querySelector('.store-map');
          const zonePanel = document.querySelector('.zone-focus-panel');
          const outsideOverflow = Array.from(document.querySelectorAll('body *')).filter((el) => {
            if (el.closest('.store-map')) return false;
            if (el.closest('.zone-quick-nav')) return false;
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth + 2 || r.left < -2;
          }).slice(0, 8).map((el) => ({
            tag: el.tagName,
            cls: el.className,
            text: el.textContent.trim().slice(0, 80),
            rect: rect(el),
          }));
          return {
            elapsedMs,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            },
            map: {
              rect: rect(map),
              lodEnterprise: map?.classList.contains('lod-enterprise') || false,
              lodZone: map?.classList.contains('lod-zone') || false,
              lodIndividual: map?.classList.contains('lod-individual') || false,
            },
            counts: {
              avatars: document.querySelectorAll('.store-map button.avatar').length,
              clusters: document.querySelectorAll('.zone-cluster').length,
              clusterRisks: document.querySelectorAll('.zone-cluster.has-risk').length,
              zoneCaseButtons: document.querySelectorAll('.zone-case-list button').length,
            },
            zoneFocusPanel: {
              text: zonePanel?.textContent.trim() || '',
              zone: zonePanel?.dataset.zone || '',
              rect: rect(zonePanel),
            },
            outsideOverflow,
            consoleErrors,
          };
        }""",
        {"consoleErrors": console_errors, "elapsedMs": elapsed_ms},
    )


if __name__ == "__main__":
    main()
