"""Smoke-check the current store-owner UI against the local API.

The detailed owner workflow lives in verify_owner_ux.py. This keeps the
release smoke focused on the navigation and onboarding surface a tenant sees.
"""

import os

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:5173")


def sign_in_if_needed(page):
    page.goto(f"{BASE_URL}/?app=1", wait_until="domcontentloaded")
    page.wait_for_function("document.querySelector('.nav-item, .auth-shell') !== null", timeout=10000)
    local_login = page.get_by_role("button", name="Usar acceso local de desarrollo")
    if local_login.count():
        local_login.click()
    expect(page.get_by_role("button", name="Hoy", exact=True)).to_be_visible()
    page.get_by_role("button", name="Hoy", exact=True).click()
    expect(page.get_by_text("Lo que pasa en tu tienda")).to_be_visible()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        desktop = browser.new_page(viewport={"width": 1440, "height": 980})
        sign_in_if_needed(desktop)
        expect(desktop.get_by_text("Lo que pasa en tu tienda")).to_be_visible()
        expect(desktop.get_by_text("Pedidos activos", exact=True)).to_be_visible()
        expect(desktop.get_by_text("Domicilios del plan", exact=True)).to_be_visible()
        for label in [
            "Pedidos y pendientes",
            "Tienda viva",
            "Conversaciones",
            "Poner en marcha",
            "Uso del plan",
            "Ajustes",
        ]:
            expect(desktop.get_by_role("button", name=label, exact=True)).to_be_visible()

        desktop.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(desktop.get_by_text("Tu negocio en este momento")).to_be_visible()
        assert not desktop.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")

        desktop.get_by_role("button", name="Poner en marcha", exact=True).click()
        expect(desktop.get_by_text("Conecta tus productos y precios")).to_be_visible()
        expect(desktop.get_by_role("button", name="Conectar Google").first).to_be_visible()
        assert not desktop.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        sign_in_if_needed(mobile)
        expect(mobile.get_by_text("Pedidos activos", exact=True)).to_be_visible()
        mobile.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(mobile.get_by_text("Tu negocio en este momento")).to_be_visible()
        assert not mobile.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")

        browser.close()


if __name__ == "__main__":
    main()
