"""Exercise the owner's real-data navigation and order action without mutating backend data."""
import os

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:5173")


def open_owner(page):
    page.goto(f"{BASE_URL}/?app=1", wait_until="domcontentloaded")
    page.wait_for_function("document.querySelector('.nav-item, .auth-shell') !== null", timeout=10000)
    if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
        page.get_by_role("button", name="Usar acceso local de desarrollo").click()
    expect(page.get_by_role("button", name="Pedidos y pendientes", exact=True)).to_be_visible()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width, height in ((1440, 950), (390, 844), (320, 760)):
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        open_owner(page)
        expect(page.get_by_role("button", name="Centro de control", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Observabilidad", exact=True)).to_have_count(0)
        page.get_by_role("button", name="Pedidos y pendientes", exact=True).click()
        expect(page.locator(".queue-layout")).to_be_visible()
        assert page.locator(".queue-layout").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        if width < 721:
            page.locator(".mobile-more summary").click()
            expect(page.locator(".mobile-more").get_by_role("button", name="Uso del plan")).to_be_visible()
            expect(page.locator(".mobile-more").get_by_role("button", name="Ajustes")).to_be_visible()

        overview_response = page.request.get(f"{BASE_URL}/api/ops/overview")
        assert overview_response.ok
        overview = overview_response.json()
        tenant_id = overview["tenant"]["id"]
        mock = {**overview, "conversations": [], "pendingRequests": [], "events": []}

        def mock_overview(route):
            route.fulfill(json=mock)

        page.route("**/api/ops/overview?*", mock_overview)
        with page.expect_response(lambda response: "/api/saas/tenants/" in response.url and response.url.endswith("/status")):
            page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(100)
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(page.locator(".store-work-now")).to_contain_text("0 conversaciones")
        expect(page.locator(".store-empty-state")).to_be_visible()
        expect(page.locator(".store-map button.avatar")).to_have_count(0)
        expect(page.locator(".ambient-people")).to_have_count(0)

        order_conversation = {
            "id": "ux-order-1", "tenantId": tenant_id, "customer": "Ana", "avatar": "AN",
            "waId": "573001234567", "status": "blocked", "stage": "handoff", "zone": "approval",
            "path": ["whatsapp", "agent", "approval"], "need": "Dos panes para domicilio",
            "nextStep": "Preparar el pedido", "lastTool": "google_sheets_order_write",
            "orderId": "PED-UX-1", "progress": 82, "value": "$8.000", "messages": [
                {"id": "msg-user-1", "role": "user", "text": "Dos panes para domicilio", "createdAt": "2026-10-17T10:00:00Z"},
                {"id": "msg-agent-1", "role": "agent", "text": "Pedido tomado", "createdAt": "2026-10-17T10:01:00Z"},
            ],
        }
        order_request = {
            "id": "ux-task-1", "tenantId": tenant_id, "conversationId": "ux-order-1",
            "action": "prepare_delivery_order", "title": "Alistar domicilio confirmado",
            "type": "human_handoff", "urgency": "Alta", "status": "pending",
            "context": "Pedido confirmado", "assignedTeam": "operaciones",
            "contextSnapshot": {
                "action": "prepare_delivery_order", "orderId": "PED-UX-1",
                "customerName": "Ana", "deliveryAddress": "Calle 10 # 2-30",
                "subtotal": 8000, "items": [{"name": "Pan", "quantity": 2, "lineTotal": 8000}],
            },
        }
        mock = {**overview, "conversations": [order_conversation], "pendingRequests": [order_request], "events": []}
        with page.expect_response(lambda response: "/api/saas/tenants/" in response.url and response.url.endswith("/status")):
            page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(100)
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        page.locator(".store-work-now button").first.click()
        expect(page.locator(".request-card")).to_have_count(1)
        expect(page.locator(".request-card")).to_contain_text("Calle 10 # 2-30")
        expect(page.locator(".request-card")).to_contain_text("2x")
        expect(page.locator(".request-card")).to_contain_text("Por preparar")

        page.route("**/api/pending-requests/ux-task-1/resolve", lambda route: route.fulfill(status=503, json={"error": "unavailable"}))
        page.get_by_role("button", name="Marcar tomado").click()
        expect(page.get_by_role("alert")).to_contain_text("No pudimos confirmar")
        expect(page.locator(".request-card")).to_have_count(1)
        assert page.locator(".queue-layout").evaluate("el => el.scrollWidth <= el.clientWidth + 1")

        order = {
            "id": "ux-order-1", "tenantId": tenant_id, "conversationId": "ux-order-1",
            "customerName": "Ana", "deliveryAddress": "Calle 10 # 2-30",
            "items": [{"name": "Pan", "quantity": 2}], "subtotal": 8000,
            "status": "preparing", "sheetSyncStatus": "pending", "createdAt": "2026-10-17T10:00:00Z", "updatedAt": "2026-10-17T10:00:00Z",
        }
        order_conversation = {**order_conversation, "status": "live", "stage": "payment", "zone": "payment", "nextStep": "Pedido tomado"}
        old_handoff_event = {"id": "event-old-handoff", "tenantId": tenant_id, "conversationId": "ux-order-1", "type": "fallback.activated", "detail": "Necesitaba ayuda", "metadata": {"requestId": "ux-task-1"}}
        mock = {**overview, "conversations": [order_conversation], "pendingRequests": [], "orders": [order], "events": [old_handoff_event]}

        def update_order(route):
            nonlocal_order = {**order, "status": route.request.post_data_json["status"]}
            order.update(nonlocal_order)
            route.fulfill(json=nonlocal_order)

        page.route("**/api/orders/ux-order-1/status", update_order)
        with page.expect_response(lambda response: "/api/saas/tenants/" in response.url and response.url.endswith("/status")):
            page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(100)
        page.get_by_role("button", name="Tienda viva", exact=True).click()
        expect(page.locator(".order-actor[data-order-id='ux-order-1']")).to_have_count(1)
        expect(page.locator(".priority-event-card")).to_have_count(0)
        if width == 390 and os.environ.get("UI_SCREENSHOT_DIR"):
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-store-mobile-active.png"), full_page=True)
        page.locator(".order-actor[data-order-id='ux-order-1']").click()
        expect(page.locator(".order-progress-card")).to_contain_text("Alistando pedido")
        expect(page.locator(".order-sync-note")).to_contain_text("la hoja de Google no estaba conectada")
        expect(page.locator(".order-progress-card.is-selected")).to_have_count(1)
        if width == 390 and os.environ.get("UI_SCREENSHOT_DIR"):
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-orders-mobile-active.png"), full_page=True)
            page.get_by_role("button", name="Abrir conversación", exact=True).click()
            expect(page.locator(".conversations-layout")).to_be_visible()
            expect(page.get_by_role("tab", name="Mensajes")).to_be_visible()
            expect(page.get_by_text("Asistente").first).to_be_visible()
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-conversation-mobile.png"), full_page=True)
            page.get_by_role("button", name="Pedidos y pendientes", exact=True).click()
            expect(page.locator(".order-progress-card")).to_be_visible()
        page.get_by_role("button", name="Marcar en camino").click()
        expect(page.locator(".order-progress-card")).to_contain_text("Pedido en camino")
        page.get_by_role("button", name="Marcar entregado").click()
        page.get_by_role("tab", name="Finalizados").click()
        expect(page.locator(".order-progress-card")).to_contain_text("Pedido entregado")
        assert page.locator(".queue-layout").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        if width == 390 and os.environ.get("UI_SCREENSHOT_DIR"):
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-orders-mobile.png"), full_page=True)

        status_response = page.request.get(f"{BASE_URL}/api/saas/tenants/{tenant_id}/status")
        assert status_response.ok
        status_bundle = status_response.json()
        ready_bundle = {**status_bundle, "status": {**status_bundle["status"], "readyForOperation": True}}
        page.route("**/api/saas/tenants/*/status", lambda route: route.fulfill(json=ready_bundle))
        with page.expect_response(lambda response: "/api/saas/tenants/" in response.url and response.url.endswith("/status")):
            page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(100)
        if width < 721:
            page.locator(".mobile-more summary").click()
            page.locator(".mobile-more").get_by_role("button", name="Ajustes").click()
        else:
            page.get_by_role("button", name="Ajustes", exact=True).click()
        expect(page.locator(".owner-settings-summary")).to_be_visible()
        expect(page.get_by_text("Origen de secretos")).not_to_be_visible()
        if width == 390 and os.environ.get("UI_SCREENSHOT_DIR"):
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-settings-mobile.png"), full_page=True)
        page.get_by_role("button", name="Revisar puesta en marcha").click()
        expect(page.locator(".onboarding-layout")).to_be_visible()
        expect(page.get_by_role("button", name="Ver pedidos", exact=True)).to_be_visible()
        if width == 390 and os.environ.get("UI_SCREENSHOT_DIR"):
            page.screenshot(path=os.path.join(os.environ["UI_SCREENSHOT_DIR"], "owner-onboarding-mobile.png"), full_page=True)
        page.get_by_role("button", name="Ver pedidos", exact=True).click()
        expect(page.locator(".queue-layout")).to_be_visible()
        assert not errors, errors
        context.close()
    browser.close()

print("Owner UX checks passed: empty state, mobile access, handoff, failed save and order lifecycle")
