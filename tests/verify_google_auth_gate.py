import os

from playwright.sync_api import expect, sync_playwright


def main():
    base_url = os.getenv("UI_BASE_URL", "http://127.0.0.1:5173")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        body = " ".join(page.locator("body").inner_text().split())
        assert "Resumen operativo" not in body, "Protected dashboard should not render before login"
        expect(page.get_by_text("Acceder con Google").first).to_be_visible()
        expect(page.get_by_text("Usar acceso local de desarrollo")).to_have_count(0)

        disabled = page.locator("button[disabled]").evaluate_all(
            "(els) => els.map((item) => item.innerText || item.getAttribute('title') || '')"
        )
        assert not any("Usar acceso local de desarrollo" in item for item in disabled)

        browser.close()


if __name__ == "__main__":
    main()
