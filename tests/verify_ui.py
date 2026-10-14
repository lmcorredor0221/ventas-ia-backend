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
        if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
            page.get_by_role("button", name="Usar acceso local de desarrollo").click()
            page.wait_for_load_state("networkidle")

        expect(page.get_by_text("Resumen operativo").first).to_be_visible()
        expect(page.get_by_text("Qué requiere atención ahora")).to_be_visible()
        expect(page.get_by_text("Uso del plan")).to_be_visible()
        for nav_item in ["Resumen", "Tienda viva", "Onboarding", "Centro de control", "Observabilidad", "Conversaciones", "Aprobaciones", "Analítica", "Configuración"]:
            expect(page.get_by_role("button", name=nav_item, exact=True)).to_be_visible()
        page.get_by_role("button", name="Ocultar menú lateral").click()
        expect(page.get_by_role("button", name="Mostrar menú lateral")).to_be_visible()
        page.get_by_role("button", name="Mostrar menú lateral").click()
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(page.get_by_text("Operación comercial en tiempo real").first).to_be_visible()
        expect(page.get_by_text("Inspector operativo")).not_to_be_visible()
        expect(page.locator(".avatar").first).to_be_visible()
        page.screenshot(path=str(ROOT / "test-results-desktop.png"), full_page=True)

        page.get_by_role("button", name="Onboarding", exact=True).click()
        expect(page.get_by_text("Puesta en marcha guiada")).to_be_visible()
        expect(page.get_by_text("Prueba guiada")).to_be_visible()
        expect(page.get_by_text("Conexión guiada del canal del cliente")).to_be_visible()
        expect(page.get_by_text("Inspector operativo")).not_to_be_visible()

        page.get_by_role("button", name="Centro de control", exact=True).click()
        expect(page.get_by_text("Radar comercial y operativo")).to_be_visible()
        horizontal_overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not horizontal_overflow, "Centro de control should not create document-level horizontal overflow"

        page.get_by_role("button", name="Aprobaciones", exact=True).click()
        expect(page.get_by_text("Bandeja priorizada de intervención humana")).to_be_visible()
        if page.get_by_role("button", name="Aprobar").count():
            page.get_by_role("button", name="Aprobar").first.click()
            page.get_by_role("button", name="Conversaciones", exact=True).click()
            expect(page.get_by_text("Conversaciones supervisables")).to_be_visible()
            expect(page.get_by_text("Aprobación registrada").first).to_be_visible()
        else:
            expect(page.get_by_text("Sin pendientes humanos")).to_be_visible()

        page.get_by_role("button", name=re.compile("Configur", re.I)).click()
        expect(page.get_by_text("Conexiones operativas")).to_be_visible()
        expect(page.get_by_text("Referencia de verificación")).to_be_visible()

        page.get_by_role("button", name="Analítica", exact=True).click()
        expect(page.get_by_text("Lectura ejecutiva de la tienda")).to_be_visible()
        expect(page.get_by_text("Salud")).to_be_visible()
        expect(page.get_by_text("Capacidad mensual")).to_be_visible()
        expect(page.get_by_text("Flujo comercial")).to_be_visible()

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto("http://127.0.0.1:5173")
        mobile.wait_for_load_state("networkidle")
        if mobile.get_by_role("button", name="Usar acceso local de desarrollo").count():
            mobile.get_by_role("button", name="Usar acceso local de desarrollo").click()
            mobile.wait_for_load_state("networkidle")
        expect(mobile.get_by_text("Resumen operativo").first).to_be_visible()
        mobile.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(mobile.locator(".store-map")).to_be_visible()
        mobile.screenshot(path=str(ROOT / "test-results-mobile.png"), full_page=True)

        browser.close()


if __name__ == "__main__":
    main()
