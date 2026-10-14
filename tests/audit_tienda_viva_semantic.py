import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-semantic.json"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 980})
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
            page.get_by_role("button", name="Usar acceso local de desarrollo").click()
            page.wait_for_load_state("networkidle")
        if page.locator('button[title="Pausar eventos"]').count():
            page.locator('button[title="Pausar eventos"]').click()
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        page.wait_for_timeout(600)
        if page.get_by_role("button", name="Animación viva").count():
            page.get_by_role("button", name="Animación viva").click()
            page.wait_for_timeout(700)
        before = collect_avatars(page)
        page.wait_for_timeout(1200)
        after = collect_avatars(page)
        page.screenshot(path=str(ROOT / "test-results-tienda-viva-semantic.png"), full_page=False)
        browser.close()

    before_by_id = {item["id"]: item for item in before}
    compared = []
    for item in after:
        previous = before_by_id.get(item["id"])
        if not previous:
            continue
        dx = abs(item["rect"]["x"] - previous["rect"]["x"])
        dy = abs(item["rect"]["y"] - previous["rect"]["y"])
        compared.append({
            "id": item["id"],
            "zoneBefore": previous["zone"],
            "zoneAfter": item["zone"],
            "source": item["source"],
            "delta": round(dx + dy, 2),
            "stable": dx + dy <= 4,
        })

    semantic_missing = [item for item in after if not item["zone"] or not item["source"]]
    operation_missing = [item for item in after if not item["operationState"] or not item["operationReason"]]
    operation_states = sorted({item["operationState"] for item in after if item["operationState"]})
    stable_ratio = round(sum(1 for item in compared if item["stable"]) / max(len(compared), 1), 2)
    results = {
        "avatarCount": len(after),
        "comparedCount": len(compared),
        "stableRatio": stable_ratio,
        "semanticMissing": semantic_missing,
        "operationMissing": operation_missing,
        "operationStates": operation_states,
        "movementSample": compared[:8],
        "consoleErrors": console_errors,
        "passed": len(after) > 0 and not semantic_missing and not operation_missing and len(operation_states) >= 2 and stable_ratio >= 0.85,
    }
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if not results["passed"]:
        raise SystemExit(1)


def collect_avatars(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.store-map button.avatar')).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.dataset.conversationId || '',
            zone: el.dataset.zone || '',
            source: el.dataset.zoneSource || '',
            operationState: el.dataset.operationState || '',
            operationLabel: el.dataset.operationLabel || '',
            operationReason: el.dataset.operationReason || '',
            label: el.getAttribute('aria-label') || '',
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          };
        })"""
    )


if __name__ == "__main__":
    main()
