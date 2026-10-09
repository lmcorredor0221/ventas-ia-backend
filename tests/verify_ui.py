from pathlib import Path
import re
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 980})
        page.goto("http://127.0.0.1:5173")
        page.wait_for_load_state("networkidle")

        expect(page.get_by_text(re.compile("agente comercial", re.I))).to_be_visible()
        expect(page.get_by_text("Tienda comercial interactiva")).to_be_visible()
        expect(page.locator(".avatar").first).to_be_visible()
        page.screenshot(path=str(ROOT / "test-results-desktop.png"), full_page=True)

        page.get_by_role("button", name="Pendientes").click()
        expect(page.get_by_text("Centro de atención de pendientes")).to_be_visible()
        expect(page.get_by_text("Aprobar descuento por volumen")).to_be_visible()
        page.get_by_role("button", name="Aprobar").first.click()
        page.get_by_role("button", name="Trazabilidad").click()
        expect(page.get_by_text("approval.granted")).to_be_visible()

        page.get_by_role("button", name=re.compile("Configur", re.I)).click()
        expect(page.get_by_text("Contratos y bindings ACP")).to_be_visible()
        expect(page.locator('input[value="WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF"]')).to_be_visible()

        page.get_by_role("button", name="Trazabilidad").click()
        expect(page.get_by_text("Eventos, decisiones y herramientas")).to_be_visible()

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto("http://127.0.0.1:5173")
        mobile.wait_for_load_state("networkidle")
        expect(mobile.get_by_text(re.compile("agente comercial", re.I))).to_be_visible()
        expect(mobile.locator(".store-map")).to_be_visible()
        mobile.screenshot(path=str(ROOT / "test-results-mobile.png"), full_page=True)

        browser.close()


if __name__ == "__main__":
    main()
