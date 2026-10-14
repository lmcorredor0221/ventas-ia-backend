import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-audit.json"

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 980},
    "tablet": {"width": 900, "height": 900},
    "mobile": {"width": 390, "height": 844},
}


def main():
    results = {}
    with sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      for label, viewport in VIEWPORTS.items():
          page = browser.new_page(viewport=viewport)
          console_errors = []
          page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
          page.goto(BASE_URL)
          page.wait_for_load_state("networkidle")
          if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
              page.get_by_role("button", name="Usar acceso local de desarrollo").click()
              page.wait_for_load_state("networkidle")
          page.get_by_role("button", name="Tienda viva", exact=True).click()
          page.wait_for_timeout(600)
          page.screenshot(path=str(ROOT / f"test-results-tienda-viva-{label}.png"), full_page=True)
          zone_before = page.locator(".zone-focus-panel").inner_text() if page.locator(".zone-focus-panel").count() else ""
          if page.locator(".zone-jump-catalog").count() and page.locator(".zone-jump-catalog").first.is_visible():
              page.locator(".zone-jump-catalog").first.click(force=True)
              page.wait_for_timeout(250)
          elif page.locator(".zone-catalog").count():
              page.locator(".zone-catalog").first.click(force=True)
              page.wait_for_timeout(250)
          zone_after = page.locator(".zone-focus-panel").inner_text() if page.locator(".zone-focus-panel").count() else ""
          selected_before = page.locator(".operator-panel").count() > 0
          if page.locator(".zone-case-list button").count():
              page.locator(".zone-case-list button").first.click(force=True)
          elif page.locator(".store-map button.avatar").count():
              page.locator(".store-map button.avatar").first.click(force=True)
              page.wait_for_timeout(350)
          selected_after = page.locator(".operator-panel").count() > 0
          page.screenshot(path=str(ROOT / f"test-results-tienda-viva-{label}-selected.png"), full_page=True)
          results[label] = collect_metrics(page, console_errors, selected_before, selected_after, zone_before, zone_after)
          if page.locator(".intervention-sign").count():
              page.locator(".intervention-sign").first.click(force=True)
              page.wait_for_timeout(250)
          results[label]["interventionNavigation"] = {
              "opensApprovals": page.get_by_text("Bandeja priorizada de intervención humana").count() > 0
          }
          page.close()
      browser.close()
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))


def collect_metrics(page, console_errors, selected_before, selected_after, zone_before, zone_after):
    return page.evaluate(
        """({ consoleErrors, selectedBefore, selectedAfter, zoneBefore, zoneAfter }) => {
          const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const visible = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
          });
          const map = document.querySelector('.store-map');
          const toolbarButtons = Array.from(document.querySelectorAll('.map-toolbar button')).map((el) => ({
            text: el.textContent.trim(),
            rect: rect(el),
          }));
          const avatarButtons = Array.from(document.querySelectorAll('.store-map button.avatar')).map((el) => ({
            label: el.getAttribute('aria-label') || el.title || '',
            rect: rect(el),
          }));
          const zoneButtons = Array.from(document.querySelectorAll('.store-map button.zone')).map((el) => ({
            title: el.title,
            rect: rect(el),
            text: el.textContent.trim(),
          }));
          const outsideOverflow = Array.from(document.querySelectorAll('body *')).filter((el) => {
            if (el.closest('.store-map')) return false;
            if (el.closest('.zone-quick-nav')) return false;
            if (el.closest('.nav-stack')) return false;
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth + 2 || r.left < -2;
          }).slice(0, 10).map((el) => ({
            tag: el.tagName,
            cls: el.className,
            text: el.textContent.trim().slice(0, 80),
            rect: rect(el),
          }));
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              bodyOverflowX: document.body.scrollWidth > document.body.clientWidth,
            },
            map: rect(map),
            counts: {
              zones: document.querySelectorAll('.store-map button.zone').length,
              avatars: document.querySelectorAll('.store-map button.avatar').length,
              ambientPeople: document.querySelectorAll('.ambient-people').length,
              agentFigures: document.querySelectorAll('.role-agent').length,
              mapToolbarButtons: document.querySelectorAll('.map-toolbar button').length,
              quickZoneButtons: document.querySelectorAll('.zone-quick-nav button').length,
              visibleZoneLabels: visible('.zone-label strong, .zone-label span').length,
            },
            toolbarButtons,
            avatarButtons,
            zoneButtons,
            interventionSign: {
              text: document.querySelector('.intervention-sign')?.textContent.trim() || '',
              rect: rect(document.querySelector('.intervention-sign')),
              hot: document.querySelector('.intervention-sign')?.classList.contains('is-hot') || false,
              tag: document.querySelector('.intervention-sign')?.tagName || '',
            },
            zoneFocusPanel: {
              text: document.querySelector('.zone-focus-panel')?.textContent.trim() || '',
              rect: rect(document.querySelector('.zone-focus-panel')),
              zone: document.querySelector('.zone-focus-panel')?.dataset.zone || '',
              caseButtons: document.querySelectorAll('.zone-case-list button').length,
              beforeZoneClick: zoneBefore,
              afterZoneClick: zoneAfter,
            },
            selectedPanel: {
              beforeClick: selectedBefore,
              afterClick: selectedAfter,
              rect: rect(document.querySelector('.operator-panel')),
            },
            outsideOverflow,
            consoleErrors,
          };
        }""",
        {
            "consoleErrors": console_errors,
            "selectedBefore": selected_before,
            "selectedAfter": selected_after,
            "zoneBefore": zone_before,
            "zoneAfter": zone_after,
        },
    )


if __name__ == "__main__":
    main()
