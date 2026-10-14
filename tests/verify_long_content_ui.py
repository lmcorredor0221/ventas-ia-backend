import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:3101")

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 980},
    "tablet": {"width": 900, "height": 900},
    "mobile": {"width": 390, "height": 844},
}

VIEWS = [
    "Resumen",
    "Tienda viva",
    "Conversaciones",
    "Onboarding",
    "Centro de control",
    "Observabilidad",
    "Aprobaciones",
    "Analítica",
    "Configuración",
]

INTENTIONAL_COMPACT_CLASSES = (
    "nav-item",
    "conversation-row",
    "analytics-tool-row",
    "status-pill",
    "webhook-status",
)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        failures = []

        for label, viewport in VIEWPORTS.items():
            page = browser.new_page(viewport=viewport)
            login(page)

            for view in VIEWS:
                button = page.get_by_role("button", name=view, exact=True)
                if button.count():
                    button.click()
                    page.wait_for_load_state("networkidle")
                    page.wait_for_timeout(250)

                layout = collect_layout_metrics(page)
                page.screenshot(
                    path=str(ROOT / f"test-results-p005-{label}-{view.replace(' ', '-').lower()}.png"),
                    full_page=True,
                )

                if layout["documentOverflowX"] or layout["bodyOverflowX"]:
                    failures.append((label, view, "document overflow", layout))

                unexpected_clips = [
                    item
                    for item in layout["clippedText"]
                    if not any(name in item["cls"] for name in INTENTIONAL_COMPACT_CLASSES)
                ]
                if unexpected_clips:
                    failures.append((label, view, "unexpected clipped text", unexpected_clips[:5]))

            page.close()

        browser.close()

    if failures:
        for failure in failures[:12]:
            print("FAIL", failure)
        raise SystemExit(f"{len(failures)} long-content layout issues found")

    print("Long-content UI scan passed")


def login(page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    dev_button = page.get_by_role("button", name="Usar acceso local de desarrollo")
    if dev_button.count():
        dev_button.click()
        page.wait_for_load_state("networkidle")


def collect_layout_metrics(page):
    return page.evaluate(
        """() => {
          const doc = document.documentElement;
          const body = document.body;
          const vw = doc.clientWidth;
          const overflowing = [];
          const clippedText = [];

          for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const text = (el.innerText || '').trim();

            if (rect.width <= 0 || rect.height <= 0) continue;

            if (!el.closest('.store-map') && (rect.right > vw + 2 || rect.left < -2)) {
              overflowing.push({
                tag: el.tagName,
                cls: el.className || '',
                text: text.slice(0, 80),
                left: rect.left,
                right: rect.right,
                width: rect.width
              });
            }

            if (
              text
              && !el.closest('.store-map')
              && ['hidden', 'clip'].includes(style.overflow)
              && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)
            ) {
              clippedText.push({
                tag: el.tagName,
                cls: el.className || '',
                text: text.slice(0, 80),
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth
              });
            }
          }

          return {
            documentOverflowX: doc.scrollWidth > doc.clientWidth + 2,
            bodyOverflowX: body.scrollWidth > body.clientWidth + 2,
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            overflowing: overflowing.slice(0, 12),
            clippedText: clippedText.slice(0, 20)
          };
        }"""
    )


if __name__ == "__main__":
    main()
