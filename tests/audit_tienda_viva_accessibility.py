import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-accessibility.json"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
            page.get_by_role("button", name="Usar acceso local de desarrollo").click()
            page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        page.wait_for_timeout(700)
        page.get_by_role("button", name="Animación viva").click()
        page.wait_for_timeout(250)
        before_panel = collect_state(page)
        if page.locator(".zone-case-list button").count():
            page.locator(".zone-case-list button").first.click(force=True)
        else:
            page.locator(".store-map button.avatar").first.click(force=True)
        page.wait_for_timeout(350)
        with_panel = collect_state(page)
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        after_escape = collect_state(page)
        page.screenshot(path=str(ROOT / "test-results-tienda-viva-accessibility.png"), full_page=True)
        browser.close()

    results = {
        "beforePanel": before_panel,
        "withPanel": with_panel,
        "afterEscape": after_escape,
        "consoleErrors": console_errors,
        "passed": (
            before_panel["storeRegion"]
            and before_panel["reducedMotion"]
            and before_panel["activeZoneAriaCurrent"] >= 1
            and not before_panel["smallTouchTargets"]
            and with_panel["operatorPanelFixed"]
            and with_panel["operatorPanelInViewport"]
            and with_panel["operatorPanelRole"] == "complementary"
            and with_panel["focusedPanel"]
            and after_escape["operatorPanelCount"] == 0
            and not before_panel["overflowX"]
            and not with_panel["overflowX"]
        ),
    }
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if not results["passed"]:
        raise SystemExit(1)


def collect_state(page):
    return page.evaluate(
        """() => {
          const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const touchSelectors = [
            '.map-toolbar button',
            '.zone-quick-nav button',
            '.camera-dock button',
            '.priority-event-card button',
            '.zone-case-list button'
          ];
          const smallTouchTargets = touchSelectors.flatMap((selector) => (
            Array.from(document.querySelectorAll(selector))
              .filter((el) => {
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return r.width > 0
                  && r.height > 0
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && (r.width < 44 || r.height < 44);
              })
              .map((el) => ({ selector, text: el.textContent.trim(), rect: rect(el) }))
          ));
          const panel = document.querySelector('.operator-panel');
          const panelRect = rect(panel);
          const panelStyle = panel ? getComputedStyle(panel) : null;
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            storeRegion: document.querySelector('.store-map')?.getAttribute('role') === 'region',
            cameraToolbarRole: document.querySelector('.camera-dock')?.getAttribute('role') || '',
            reducedMotion: document.querySelector('.store-map')?.classList.contains('reduce-motion') || false,
            activeZoneAriaCurrent: document.querySelectorAll('.zone-quick-nav button[aria-current="true"]').length,
            zoneButtonsWithAria: Array.from(document.querySelectorAll('.store-map button.zone')).every((el) => Boolean(el.getAttribute('aria-label'))),
            smallTouchTargets,
            operatorPanelCount: document.querySelectorAll('.operator-panel').length,
            operatorPanelRole: panel?.getAttribute('role') || '',
            operatorPanelFixed: panelStyle?.position === 'fixed',
            operatorPanelInViewport: Boolean(panelRect && panelRect.bottom <= window.innerHeight + 2 && panelRect.right <= window.innerWidth + 2),
            focusedPanel: document.activeElement === panel,
            panelRect,
          };
        }"""
    )


if __name__ == "__main__":
    main()
