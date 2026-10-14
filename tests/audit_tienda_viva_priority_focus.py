import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
OUT = ROOT / "test-results-tienda-viva-priority-focus.json"


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
        page.wait_for_timeout(900)
        focused = collect_state(page)
        if page.locator(".priority-event-card button").count():
            page.locator(".priority-event-card button").first.click()
            page.wait_for_timeout(350)
        after_action = collect_action_state(page)
        page.screenshot(path=str(ROOT / "test-results-tienda-viva-priority-focus.png"), full_page=True)
        browser.close()

    results = {
        "focused": focused,
        "afterAction": after_action,
        "consoleErrors": console_errors,
        "passed": (
            focused["priorityCard"]
            and focused["priorityZone"] == "approval"
            and focused["cameraScale"] > 1
            and focused["priorityAvatars"] >= 1
            and bool(focused["priorityRequestId"])
            and bool(focused["priorityConversationId"])
            and after_action["openedApprovals"]
            and after_action["selectedRequestId"] == focused["priorityRequestId"]
            and after_action["selectedConversationId"] == focused["priorityConversationId"]
            and not focused["overflowX"]
        ),
    }
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if not results["passed"]:
        raise SystemExit(1)


def collect_state(page):
    return page.evaluate(
        """() => {
          const card = document.querySelector('.priority-event-card');
          const map = document.querySelector('.store-map');
          return {
            priorityCard: Boolean(card),
            priorityText: card?.textContent.trim() || '',
            priorityZone: card?.dataset.priorityZone || '',
            prioritySource: card?.dataset.prioritySource || '',
            priorityRequestId: card?.dataset.priorityRequestId || '',
            priorityConversationId: card?.dataset.priorityConversationId || '',
            cameraScale: Number(map?.dataset.cameraScale || '0'),
            activeZone: document.querySelector('.zone-focus-panel')?.dataset.zone || '',
            priorityAvatars: document.querySelectorAll('.store-map button.avatar.is-priority').length,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        }"""
    )


def collect_action_state(page):
    return page.evaluate(
        """() => ({
          openedApprovals: document.body.textContent.includes('Bandeja priorizada de intervención humana')
            || document.body.textContent.includes('Bandeja priorizada de intervenci'),
          selectedRequestId: document.querySelector('.request-card.is-selected')?.dataset.requestId || '',
          selectedConversationId: document.querySelector('.request-card.is-selected')?.dataset.conversationId || '',
          selectedRequestText: document.querySelector('.request-card.is-selected')?.textContent.trim() || '',
          headingText: document.querySelector('.content-header h1')?.textContent.trim() || '',
        })"""
    )


if __name__ == "__main__":
    main()
