import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("UI_BASE_URL", "http://127.0.0.1:4174")
HEADLESS = os.environ.get("PW_HEADLESS", "true").lower() not in {"0", "false", "no"}
MODE = "headless" if HEADLESS else "headed"
OUT = ROOT / f"test-results-tienda-viva-performance-{MODE}.json"
LOADS = [10, 50, 200, 1000]


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS,
            args=[
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ],
        )
        for load in LOADS:
            page = browser.new_page(viewport={"width": 1440, "height": 980})
            cdp = page.context.new_cdp_session(page)
            cdp.send("Performance.enable")
            console_errors = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            started = time.perf_counter()
            page.goto(f"{BASE_URL}?loadFixture={load}")
            page.wait_for_load_state("networkidle")
            if page.get_by_role("button", name="Usar acceso local de desarrollo").count():
                page.get_by_role("button", name="Usar acceso local de desarrollo").click()
                page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Tienda viva", exact=True).click()
            page.wait_for_timeout(500)
            boot_ms = round((time.perf_counter() - started) * 1000)
            cdp_before = read_cdp_metrics(cdp)
            perf = page.evaluate(
                """async () => {
                  const start = performance.now();
                  const frames = [];
                  let last = start;
                  return await new Promise((resolve) => {
                    function step(now) {
                      frames.push(now - last);
                      last = now;
                      if (now - start >= 3000) {
                        const samples = frames.slice(1);
                        const avgFrameMs = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);
                        const sorted = [...samples].sort((a, b) => a - b);
                        const p95FrameMs = sorted[Math.floor(sorted.length * 0.95)] || 0;
                        resolve({
                          sampleMs: Math.round(now - start),
                          frames: samples.length,
                          avgFrameMs: Number(avgFrameMs.toFixed(2)),
                          p95FrameMs: Number(p95FrameMs.toFixed(2)),
                          approxFps: Number((1000 / Math.max(avgFrameMs, 1)).toFixed(1)),
                          longFrames: samples.filter((value) => value > 50).length,
                        });
                        return;
                      }
                      requestAnimationFrame(step);
                    }
                    requestAnimationFrame(step);
                  });
                }"""
            )
            cdp_after = read_cdp_metrics(cdp)
            cdp_delta = diff_cdp_metrics(cdp_before, cdp_after)
            metrics = collect_metrics(page, console_errors, boot_ms, perf, cdp_after, cdp_delta)
            page.screenshot(path=str(ROOT / f"test-results-tienda-viva-performance-{MODE}-{load}.png"), full_page=False)
            results[str(load)] = metrics
            page.close()
        browser.close()
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))


def read_cdp_metrics(cdp):
    metrics = cdp.send("Performance.getMetrics")["metrics"]
    return {item["name"]: item["value"] for item in metrics}


def diff_cdp_metrics(before, after):
    names = [
        "TaskDuration",
        "ScriptDuration",
        "LayoutDuration",
        "RecalcStyleDuration",
        "LayoutCount",
        "RecalcStyleCount",
    ]
    return {name: round(after.get(name, 0) - before.get(name, 0), 4) for name in names}


def collect_metrics(page, console_errors, boot_ms, perf, cdp_after, cdp_delta):
    return page.evaluate(
        """({ consoleErrors, bootMs, perf, cdpAfter, cdpDelta, mode }) => {
          const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const map = document.querySelector('.store-map');
          const outsideOverflow = Array.from(document.querySelectorAll('body *')).filter((el) => {
            if (el.closest('.store-map')) return false;
            if (el.closest('.zone-quick-nav')) return false;
            if (el.closest('.S9gUrf-YoZ4jf') || String(el.className).includes('nsm7Bb-HzV7m')) return false;
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth + 2 || r.left < -2;
          }).slice(0, 8).map((el) => ({
            tag: el.tagName,
            cls: el.className,
            text: el.textContent.trim().slice(0, 80),
            rect: rect(el),
          }));
          const expectedAuthWarnings = consoleErrors.filter((text) => text.includes('401 (Unauthorized)')).length;
          const expectedExternalWarnings = consoleErrors.filter((text) => (
            text.includes('403 ()') ||
            text.includes('GSI_LOGGER') ||
            text.includes('404 (Not Found)')
          )).length;
          const blockingErrors = consoleErrors.filter((text) => (
            !text.includes('favicon') &&
            !text.includes('401 (Unauthorized)') &&
            !text.includes('403 ()') &&
            !text.includes('GSI_LOGGER') &&
            !text.includes('404 (Not Found)')
          ));
          return {
            mode,
            bootMs,
            raf: perf,
            cdp: {
              taskDurationDelta: cdpDelta.TaskDuration,
              scriptDurationDelta: cdpDelta.ScriptDuration,
              layoutDurationDelta: cdpDelta.LayoutDuration,
              recalcStyleDurationDelta: cdpDelta.RecalcStyleDuration,
              layoutCountDelta: cdpDelta.LayoutCount,
              recalcStyleCountDelta: cdpDelta.RecalcStyleCount,
              jsHeapUsedMB: Number(((cdpAfter.JSHeapUsedSize || 0) / 1048576).toFixed(2)),
              jsHeapTotalMB: Number(((cdpAfter.JSHeapTotalSize || 0) / 1048576).toFixed(2)),
              nodes: Math.round(cdpAfter.Nodes || 0),
            },
            document: {
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            },
            map: {
              rect: rect(map),
              lodEnterprise: map?.classList.contains('lod-enterprise') || false,
              lodZone: map?.classList.contains('lod-zone') || false,
              lodIndividual: map?.classList.contains('lod-individual') || false,
            },
            counts: {
              avatars: document.querySelectorAll('.store-map button.avatar').length,
              clusters: document.querySelectorAll('.zone-cluster').length,
              clusterRisks: document.querySelectorAll('.zone-cluster.has-risk').length,
              zoneCaseButtons: document.querySelectorAll('.zone-case-list button').length,
            },
            outsideOverflow,
            expectedAuthWarnings,
            expectedExternalWarnings,
            consoleErrors: blockingErrors,
          };
        }""",
        {
            "consoleErrors": console_errors,
            "bootMs": boot_ms,
            "perf": perf,
            "cdpAfter": cdp_after,
            "cdpDelta": cdp_delta,
            "mode": MODE,
        },
    )


if __name__ == "__main__":
    main()
