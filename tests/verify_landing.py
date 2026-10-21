"""Check the real offer, interactive order, mobile layout and billing failure states."""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:5173")
OUT_DIR = Path(os.environ.get("UI_RESULTS_DIR", "output/landing-practical"))
OUT_DIR.mkdir(parents=True, exist_ok=True)


def open_landing(page, path="/landing"):
    page.goto(f"{BASE_URL}{path}", wait_until="networkidle")
    expect(page.get_by_role("heading", level=1)).to_have_text(
        "Tus pedidos de WhatsApp, listos para preparar."
    )


def assert_offer(page, plan):
    expect(page.locator(".shop-price")).to_have_count(2)
    amount = f"{plan['amount']:,.0f}".replace(",", ".")
    for element in page.locator(".shop-price strong").all():
        expect(element).to_contain_text(amount)
    for element in page.locator(".shop-limits").all():
        expect(element).to_contain_text(f"{plan['includedDeliveries']:,}".replace(",", "."))
        expect(element).to_contain_text(f"{plan['includedInteractions']:,}".replace(",", "."))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    response = page.request.get(f"{BASE_URL}/api/billing/plans")
    assert response.ok, "Live public plans endpoint must be available"
    plans = [plan for plan in response.json()["plans"] if plan["isActive"]]
    active_plan = next((plan for plan in plans if plan["isDefault"]), plans[0])
    open_landing(page)
    assert_offer(page, active_plan)
    if not active_plan["trialEnabled"]:
        expect(page.get_by_role("link", name=re.compile(r"Probar \d+ días gratis"))).to_have_count(0)
        expect(page.get_by_test_id("trial-conditions")).to_contain_text("sin prueba gratuita activa")
    expect(page.locator(".shop-demo-scene")).to_have_attribute("data-stage", "2", timeout=8000)

    # Interactions explain the order without creating a real API order.
    expect(page.locator(".shop-receipt-total")).to_contain_text("10.200")
    page.get_by_role("button", name="Panadería", exact=True).click()
    expect(page.locator(".shop-receipt-total")).to_contain_text("16.200")
    expect(page.locator(".shop-message")).to_contain_text("croissants")
    page.get_by_role("button", name="Marcar tomado", exact=True).click()
    expect(page.get_by_role("heading", name="Pedido tomado", exact=True)).to_be_visible()
    expect(page.locator(".shop-demo-feedback")).to_contain_text("tú te encargas")
    page.get_by_role("button", name="Tomado · volver al ejemplo", exact=True).click()
    page.get_by_role("button", name="Tienda", exact=True).click()

    # The mobile demo must expose the intermediate chat states, not only update
    # an attribute that is hidden by the responsive CSS.
    mobile_demo = browser.new_page(viewport={"width": 390, "height": 844})
    open_landing(mobile_demo)
    mobile_demo.get_by_role("button", name="Repetir demostración").click()
    expect(mobile_demo.locator(".shop-demo-scene")).to_have_attribute("data-stage", "1", timeout=3000)
    assert mobile_demo.locator(".shop-chat-reply").evaluate("el => getComputedStyle(el).display") != "none"
    assert mobile_demo.locator(".shop-chat-reply").bounding_box()["height"] > 0
    expect(mobile_demo.locator(".shop-demo-scene")).to_have_attribute("data-stage", "2", timeout=3000)
    assert mobile_demo.locator(".shop-address-reply").evaluate("el => getComputedStyle(el).display") != "none"
    assert mobile_demo.locator(".shop-address-reply").bounding_box()["height"] > 0
    mobile_demo.close()

    for name, width, height, path in [
        ("desktop", 1440, 1000, "/"),
        ("desktop-alias", 1280, 900, "/landing"),
        ("mobile", 390, 844, "/"),
        ("small-mobile", 320, 760, "/landing"),
        ("tablet", 768, 1024, "/landing"),
    ]:
        page.set_viewport_size({"width": width, "height": height})
        open_landing(page, path)
        assert_offer(page, active_plan)
        assert page.locator("body").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        assert page.locator(".shop-landing").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        assert page.locator(".shop-demo").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        assert page.locator(".shop-price").first.bounding_box()["y"] < height
        page.screenshot(path=str(OUT_DIR / f"{name}-first-screen.png"))
        page.screenshot(path=str(OUT_DIR / f"{name}.png"), full_page=True)

    # Conditions must be reachable with the keyboard.
    conditions = page.locator("#condiciones details").first
    conditions.locator("summary").focus()
    page.keyboard.press("Enter")
    expect(conditions).to_have_attribute("open", "")
    expect(conditions).to_contain_text("Las consultas que no terminan en pedido también consumen")

    # Exercise the API contract without changing the saved plan.
    changed_plan = {**active_plan, "amount": 109000, "includedDeliveries": 250,
                    "includedInteractions": 1800, "trialEnabled": True, "trialDays": 3}
    mock = {"status": 200, "body": {"plans": [changed_plan]}}

    def mock_plans(route):
        route.fulfill(status=mock["status"], content_type="application/json", body=json.dumps(mock["body"]))

    page.route("**/api/billing/plans", mock_plans)
    open_landing(page)
    assert_offer(page, changed_plan)
    expect(page.get_by_role("link", name="Probar 3 días gratis")).to_have_count(2)
    expect(page.get_by_role("link", name="Probar 3 días gratis").first).to_have_attribute("href", "/?app=1")
    expect(page.get_by_test_id("trial-conditions")).to_contain_text("sin tarjeta")
    assert "7 días" not in page.locator(".shop-landing").inner_text()

    mock["body"] = {"plans": [{**changed_plan, "amount": 99000, "trialEnabled": False, "trialDays": 0}]}
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.locator(".shop-price strong").first).to_contain_text("99.000")
    expect(page.get_by_role("link", name="Probar 3 días gratis")).to_have_count(0)

    # An outage must never show a made-up price or free service trial.
    mock["status"] = 503
    mock["body"] = {"error": "unavailable"}
    open_landing(page)
    expect(page.get_by_text("No pudimos consultar el precio actual.", exact=True)).to_have_count(2)
    expect(page.locator(".shop-price")).to_have_count(0)
    expect(page.get_by_role("link", name="Crear mi tienda", exact=True)).to_have_count(0)
    expect(page.get_by_role("link", name="Probar un pedido", exact=True)).to_be_visible()
    page.screenshot(path=str(OUT_DIR / "offer-unavailable.png"), full_page=True)
    mock["status"] = 200
    mock["body"] = {"plans": [active_plan]}
    page.get_by_role("button", name="Volver a consultar").first.click()
    assert_offer(page, active_plan)

    mock["body"] = {"plans": []}
    open_landing(page)
    expect(page.locator(".shop-price")).to_have_count(0)
    expect(page.get_by_text("No pudimos consultar el precio actual.", exact=True)).to_have_count(2)
    assert not errors, errors

    reduced = browser.new_context(reduced_motion="reduce", viewport={"width": 390, "height": 844})
    reduced_page = reduced.new_page()
    open_landing(reduced_page)
    expect(reduced_page.locator(".shop-demo-scene")).to_have_attribute("data-stage", "2")
    expect(reduced_page.get_by_role("button", name="Pausar demostración")).to_have_count(0)
    assert reduced_page.locator(".shop-ready-mark").evaluate("el => getComputedStyle(el).animationName") == "none"
    reduced.close()
    browser.close()

print("Landing checks passed: real offer, 5 viewports, order interaction, trial changes, outage/retry, keyboard, reduced motion")
