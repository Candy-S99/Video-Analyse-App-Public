import json
from playwright.sync_api import sync_playwright


CONFIG = {
    "model": "gemini-3.8-flash",
    "segment_length_seconds": 30,
    "extract_transcript": True,
    "gemini_api_key_configured": True,
    "data_dir": "/data/jobs",
}

JOBS = [
    {
        "job_id": "job-1",
        "status": "PROCESSING",
        "url": "https://www.youtube.com/watch?v=mHSOsy_usAg",
        "title": "Testvideo",
        "created_at": "2026-09-13T18:11:42.000Z",
        "token_usage": {"prompt_tokens": 120, "candidate_tokens": 25, "total_tokens": 145, "reported_requests": 1},
        "cost_estimate": {"input_usd": 0.003, "output_usd": 0.0012, "estimated_usd": 0.0042, "priced_requests": 1, "currency": "USD"},
    }
]

JOB_RESULT = {
    "schema_version": "1.0",
    "job_id": "job-1",
    "correlation_id": "job-1",
    "status": "PROCESSING",
    "source": {"type": "youtube", "url": JOBS[0]["url"]},
    "video": {"title": "Testvideo"},
    "analysis": {"model": "gemini-3.8-flash", "processing_mode": "static_segments", "segment_duration_seconds": 30, "segments_total": 1, "segments_successful": 0, "segments_failed": 0},
    "inventory": [],
    "screenshot_candidates": [],
    "warnings": [],
    "errors": [],
    "created_at": JOBS[0]["created_at"],
}

EVENTS = {
    "events": [
        {"event_id": "event-1", "job_id": "job-1", "timestamp": "2026-09-13T18:11:42.000Z", "type": "API_COMPLETED", "operation": "SEGMENT_ANALYSIS", "provider": "gemini", "model": "gemini-3.8-flash", "status": "SUCCEEDED", "duration_ms": 125, "usage": {"prompt_tokens": 120, "candidate_tokens": 25, "total_tokens": 145}, "cost_estimate": {"currency": "USD", "input_usd": 0.003, "output_usd": 0.0012, "estimated_usd": 0.0042, "pricing_tier": "standard", "pricing_version": "2026-09-13", "price_basis": "paid_standard_per_1m_tokens"}},
    ],
    "usage": {"prompt_tokens": 120, "candidate_tokens": 25, "total_tokens": 145, "reported_requests": 1},
    "cost": {"input_usd": 0.003, "output_usd": 0.0012, "estimated_usd": 0.0042, "priced_requests": 1, "currency": "USD"},
}

GLOBAL_EVENTS = {
    "events": EVENTS["events"] + [
        {"event_id": "event-2", "job_id": "job-2", "timestamp": "2026-09-13T18:12:42.000Z", "type": "JOB_COMPLETED", "provider": "app", "status": "SUCCEEDED"},
    ],
    "usage": {"prompt_tokens": 120, "candidate_tokens": 25, "total_tokens": 145, "reported_requests": 1},
    "cost": {"input_usd": 0.003, "output_usd": 0.0012, "estimated_usd": 0.0042, "priced_requests": 1, "currency": "USD"},
}


def fulfill_json(route, payload):
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(payload),
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    action_calls = []
    config_updates = []
    request_state = {"reject_next_transcript_update": False}
    logs_cleared = False
    global_event_gets = 0

    def handle_route(route):
        global logs_cleared, global_event_gets
        request = route.request
        if request.method == "GET" and request.url.endswith("/config"):
            fulfill_json(route, CONFIG)
        elif request.method == "PUT" and request.url.endswith("/config"):
            patch = json.loads(request.post_data or "{}")
            config_updates.append(patch)
            if patch.get("extract_transcript") is True and request_state["reject_next_transcript_update"]:
                request_state["reject_next_transcript_update"] = False
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps({"error": "Konfiguration konnte nicht gespeichert werden"}),
                )
            else:
                CONFIG.update(patch)
                fulfill_json(route, CONFIG)
        elif request.method == "GET" and request.url.endswith("/jobs"):
            fulfill_json(route, JOBS)
        elif request.method == "GET" and request.url.endswith("/jobs/job-1/result"):
            fulfill_json(route, JOB_RESULT)
        elif request.method == "GET" and request.url.endswith("/jobs/job-1/events"):
            fulfill_json(route, EVENTS)
        elif request.method == "GET" and request.url.endswith("/jobs/events"):
            global_event_gets += 1
            fulfill_json(route, {"events": [], "usage": {"prompt_tokens": 0, "candidate_tokens": 0, "total_tokens": 0, "reported_requests": 0}, "cost": {"input_usd": 0, "output_usd": 0, "estimated_usd": 0, "priced_requests": 0, "currency": "USD"}} if logs_cleared else GLOBAL_EVENTS)
        elif request.method == "POST" and request.url.endswith("/jobs/job-1/cancel"):
            action_calls.append("cancel")
            fulfill_json(route, {"job_id": "job-1", "status": "CANCELLED"})
        elif request.method == "DELETE" and request.url.endswith("/jobs"):
            action_calls.append("clear")
            fulfill_json(route, {"deleted_count": 1})
        elif request.method == "DELETE" and request.url.endswith("/jobs/logs"):
            logs_cleared = True
            action_calls.append("clear-logs")
            fulfill_json(route, {"deleted_count": 1})
        else:
            route.continue_()

    page.route("**/api/v1/video-analysis/**", handle_route)
    page.goto("http://127.0.0.1:3000", wait_until="domcontentloaded")
    page.wait_for_timeout(250)

    assert page.locator("#jobs-history-section").count() == 1
    assert page.locator("#job-details-section").count() == 1

    assert page.locator("#quick-model-btn").is_visible()
    assert page.locator("#quick-segment-btn").is_visible()
    transcript_button = page.locator("#quick-transcript-btn")
    assert "Transkript an" in transcript_button.inner_text()

    page.locator("#quick-model-btn").click()
    assert page.locator("#quick-config-dialog").is_visible()
    page.locator('[id="quick-model-option-gemini-3.7-flash"]').click()
    page.locator("#quick-config-save").click()
    page.wait_for_timeout(100)
    assert {"model": "gemini-3.7-flash"} in config_updates
    assert "gemini-3.7-flash" in page.locator("#quick-model-btn").inner_text()

    config_updates_before_cancel = len(config_updates)
    page.locator("#quick-segment-btn").click()
    assert page.locator("#quick-segment-option-15").is_visible()
    page.locator("#quick-segment-option-15").click()
    page.locator("#quick-config-cancel").click()
    assert page.locator("#quick-config-dialog").count() == 0
    assert len(config_updates) == config_updates_before_cancel

    page.locator("#quick-segment-btn").click()
    page.locator("#quick-segment-option-15").click()
    page.locator("#quick-config-save").click()
    page.wait_for_timeout(100)
    assert {"segment_length_seconds": 15} in config_updates
    assert "15s Segmente" in page.locator("#quick-segment-btn").inner_text()

    transcript_button.click()
    page.wait_for_timeout(100)
    assert {"extract_transcript": False} in config_updates
    assert "Transkript aus" in transcript_button.inner_text()

    request_state["reject_next_transcript_update"] = True
    transcript_button.click()
    page.wait_for_timeout(100)
    assert "Transkript aus" in transcript_button.inner_text()
    assert "Schnelleinstellung konnte nicht gespeichert werden" in page.locator("body").inner_text()

    page.locator("#settings-open-btn").click()
    assert page.locator("#settings-segment-option-15").is_visible()
    page.locator("#settings-close-button").click()

    assert page.locator("#open-youtube-job-1").get_attribute("target") == "_blank"
    assert page.locator("#open-youtube-job-1").get_attribute("href") == JOBS[0]["url"]
    assert page.locator("#cancel-job-1").inner_text() == "Abbrechen"
    assert "145" in page.locator("#jobs-history-section").inner_text()
    assert page.locator("#token-usage-job-1").is_visible()
    assert "Token gesamt 145" in " ".join(page.locator("#token-usage-job-1").inner_text().split())
    assert "• Token:" not in page.locator("#jobs-history-section").inner_text()
    assert page.locator("#clear-history-btn").count() == 1
    assert page.locator("#jobs-history-section #clear-logs-btn").count() == 0
    assert "Kostensch" in page.locator("#cost-estimate-job-1").inner_text()
    assert page.locator("#cost-estimate-job-1").is_visible()
    assert page.locator("#token-usage-job-1").inner_text().count("Token gesamt") == 1
    assert page.locator("#global-job-event-log").is_visible()
    assert "145" in page.locator("#global-job-event-log").inner_text()
    page.locator("#global-job-event-log #global-toggle-json-log-btn").click()
    assert "event-2" in page.locator("#global-job-event-log").inner_text()
    assert page.locator("#global-job-event-log #clear-logs-btn").count() == 1
    global_gets_before_wait = global_event_gets
    page.wait_for_timeout(5200)
    assert global_event_gets == global_gets_before_wait
    page.locator("#global-job-event-log #global-refresh-events-btn").click()
    page.wait_for_timeout(100)
    assert global_event_gets == global_gets_before_wait + 1

    assert page.locator("#global-job-event-log .json-log-job-id").count() > 0
    assert page.locator("#global-job-event-log .json-log-token").count() > 0

    history_box = page.locator("#jobs-history-section").bounding_box()
    details_box = page.locator("#job-details-section").bounding_box()
    assert history_box["y"] < details_box["y"]
    assert abs(history_box["width"] - details_box["width"]) < 1

    page.locator("#cancel-job-1").click()
    page.wait_for_timeout(100)
    assert "cancel" in action_calls

    page.locator("text=Testvideo").first.click()
    page.wait_for_timeout(100)
    assert page.locator("#job-event-log").is_visible()
    assert "145" in page.locator("#job-event-log").inner_text()
    assert page.locator("#job-event-scroll").evaluate("element => getComputedStyle(element).overflowY") == "auto"
    page.locator("#toggle-json-log-btn").click()
    assert "event-1" in page.locator("#job-event-log").inner_text()
    page.locator("#open-fullscreen-detail-btn").click()
    assert page.locator('[role="dialog"]', has_text="Screenshot-Kandidaten").is_visible()
    page.keyboard.press("Escape")
    page.locator("#open-fullscreen-events-btn").click()
    assert page.locator('[role="dialog"]', has_text="Ereignisverlauf & Tokenverbrauch").is_visible()
    page.locator("#toggle-json-log-fullscreen-btn").click()
    assert "event-1" in page.locator('[role="dialog"]', has_text="Ereignisverlauf & Tokenverbrauch").inner_text()
    page.keyboard.press("Escape")

    page.locator("#global-job-event-log #global-open-fullscreen-events-btn").click()
    assert page.locator('[role="dialog"]', has_text="Globaler Ereignisverlauf & Tokenverbrauch").is_visible()
    page.locator("#toggle-json-log-fullscreen-btn").click()
    assert "event-2" in page.locator('[role="dialog"]', has_text="Globaler Ereignisverlauf & Tokenverbrauch").inner_text()
    page.keyboard.press("Escape")

    page.locator("#clear-history-btn").click()
    assert page.locator('[role="dialog"]').is_visible()
    page.locator('[role="dialog"] button', has_text="Historie löschen").click()
    page.wait_for_timeout(100)
    assert "clear" in action_calls
    assert page.locator('[role="dialog"]').count() == 0
    assert page.locator("#global-job-event-log").is_visible()
    assert "event-2" in page.locator("#global-job-event-log").inner_text()

    page.locator("#global-job-event-log #clear-logs-btn").click()
    assert page.locator('[role="dialog"]', has_text="Log-Historie löschen?").is_visible()
    page.locator('[role="dialog"] #confirm-clear-logs-btn').click()
    page.wait_for_timeout(100)
    assert "clear-logs" in action_calls
    assert page.locator("#global-job-event-log").is_visible()
    assert "event-2" not in page.locator("#global-job-event-log").inner_text()

    browser.close()
