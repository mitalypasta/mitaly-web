// 오픈·폐점 (8번 영역) — 27_store_lifecycle.sql 위의 화면. app.js 에서 뽑은
// 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// 날짜 필터(기간·매장)와 무관해 load() 묶음에 넣지 않고 한 번만 받습니다.

import { db } from "./client.js";
import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

export async function initLifecycle() {
    const storeSelect = $("la-store");
    const { data: stores, error: storeErr } = await db.from("stores")
        .select("id,name").order("name");
    if (!storeErr) {
        for (const s of stores || []) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.name;
            storeSelect.append(opt);
        }
    }

    $("la-date").value = new Date().toISOString().slice(0, 10);

    storeSelect.addEventListener("change", refreshLifecycleHistory);
    $("la-submit").addEventListener("click", submitLifecycleEvent);

    await Promise.all([
        refreshLifecycleSummary(),
        refreshLifecycleStatus(),
        refreshLifecycleHistory(),
    ]);
}

async function submitLifecycleEvent() {
    const notice = $("la-notice");
    const button = $("la-submit");
    const storeId = $("la-store").value;
    const eventDate = $("la-date").value;

    if (!storeId || !eventDate) {
        notice.className = "notice error";
        notice.textContent = "매장·일자는 필수입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("store_lifecycle_events").insert({
        store_id: Number(storeId),
        event_type: $("la-type").value,
        event_date: eventDate,
        note: $("la-note").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "저장했습니다.";
    $("la-note").value = "";
    await Promise.all([
        refreshLifecycleSummary(),
        refreshLifecycleStatus(),
        refreshLifecycleHistory(),
    ]);
}

async function refreshLifecycleSummary() {
    const { data, error } = await db.rpc("api_store_lifecycle_summary");
    if (error) {
        $("lifecycle-summary-year").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    $("lifecycle-summary-year").textContent = `${data.year}년`;
    $("ls-opens").textContent = int(data.opens);
    $("ls-opens-baseline").textContent = `참고: 연 평균 ${int(data.opens_baseline)}건`;
    $("ls-closes").textContent = int(data.closes);
    $("ls-closes-baseline").textContent = `참고: 연 평균 ${int(data.closes_baseline)}건`;
}

async function refreshLifecycleStatus() {
    const { data, error } = await db.rpc("api_store_lifecycle_status");
    if (error) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    $("lifecycle-status-summary").textContent = `기록 있는 매장 ${int(list.length)}곳`;

    if (!list.length) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">아직 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-lifecycle-status"),
        ["매장", "상태", "최근 이벤트일", "경과일"],
        list.map((v) => [
            v.store_name,
            v.status === "open"
                ? '<span class="tag">오픈</span>'
                : '<span class="tag down">폐점</span>',
            v.since,
            `${int(v.days_since)}일`,
        ]),
        { html: true });
}

// la-store 를 고르면 그 매장만, 비워 두면 전 매장 최근 기록을 보여줍니다.
async function refreshLifecycleHistory() {
    const storeId = $("la-store").value;
    const storeName = storeId
        ? ($("la-store").selectedOptions[0]?.textContent || null)
        : null;

    const { data, error } = await db.rpc("api_store_lifecycle", { p_store: storeName });
    if (error) {
        $("t-lifecycle").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    $("lifecycle-history-summary").textContent = storeName
        ? `${escape(storeName)} · ${int(list.length)}건`
        : `전 매장 최근 ${int(list.length)}건`;

    if (!list.length) {
        $("t-lifecycle").innerHTML =
            '<p class="hint">이력이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-lifecycle"),
        ["매장", "구분", "일자", "메모"],
        list.map((v) => [
            v.store_name,
            v.event_type === "open" ? "오픈" : "폐점",
            v.event_date,
            v.note || "—",
        ]));
}
