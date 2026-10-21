import os

from playwright.sync_api import expect, sync_playwright


def main():
    base_url = os.getenv("UI_BASE_URL", "http://127.0.0.1:5173")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(f"{base_url}/?app=1")
        page.wait_for_load_state("networkidle")

        body = " ".join(page.locator("body").inner_text().split())
        assert "Resumen operativo" not in body, "Protected dashboard should not render before login"
        assert page.locator(".auth-google-fallback, .google-signin").count() > 0, "Google authentication control should render"
        sandbox_login = page.get_by_text("Usar acceso local de desarrollo")
        if page.locator(".google-signin").count() > 0:
            expect(sandbox_login).to_have_count(0)
        else:
            expect(sandbox_login).to_be_visible()

        browser.close()


if __name__ == "__main__":
    main()
