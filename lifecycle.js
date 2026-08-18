// 오픈·폐점 (8번 영역) — 27_store_lifecycle.sql 위의 화면. app.js 에서 뽑은
// 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// 날짜 필터(기간·매장)와 무관해 load() 묶음에 넣지 않고 한 번만 받습니다.
//
// 큐 #104 진단 반영:
//   [D] 저장 전 같은 날·같은 상태 중복 확인 — 요약이 이벤트를 전부 세므로
//       실수로 두 번 넣으면 '올해 오픈' 이 부풉니다(이 표는 수정·삭제가 없음).
//   [E] 영업시작일은 프로필(가맹점 DB)과 오픈 이벤트 두 곳에 삽니다. 시트
//       재반입 시 프로필만 갱신되고 이벤트는 처음 값으로 남는 것이 의도된
//       설계(import_store_sheet.py '감사 표시')라, 어긋난 매장을 화면에
//       표시만 합니다 — 동기화 로직 변경은 담당자 결정 대기.
//   [J] 요약 연도 선택 (RPC 는 원래 p_year 를 받는데 화면이 올해 고정이었음).
//   [K] 세션 없이 insert 하면 RLS 원문 오류가 그대로 보였음 — 저장 전 확인.

import { db, fetchStores } from "./client.js";
import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

export async function initLifecycle() {
    const storeSelect = $("la-store");
    const { data: stores, error: storeErr } = await fetchStores();
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
    $("ls-year").addEventListener("change", refreshLifecycleSummary);

    // 매장 정보 화면의 신규 등록이 오픈 이벤트를 만들면(79) 이 화면 데이터가
    // 낡습니다 — 화면 간 import 없이 신호(custom event)로 다시 받습니다.
    window.addEventListener("mitaly:lifecycle-refresh", async () => {
        await Promise.all([
            refreshLifecycleStatus(),
            refreshLifecycleHistory(),
            refreshMismatchAndYears(),
        ]);
        await refreshLifecycleSummary();
    });

    await Promise.all([
        refreshLifecycleStatus(),
        refreshLifecycleHistory(),
        refreshMismatchAndYears(),   // 연도 목록을 먼저 — 요약이 그 값을 읽습니다
    ]);
    await refreshLifecycleSummary();
}

// 성공 알림은 잠시 뒤 스스로 사라집니다(가맹점 DB 와 같은 규칙 — 진단 [I]).
function laNotice(text, isError) {
    const notice = $("la-notice");
    notice.className = isError ? "notice error" : "notice";
    notice.textContent = text;
    clearTimeout(notice._hideTimer);
    if (!isError) {
        notice._hideTimer = setTimeout(() => { notice.textContent = ""; }, 6000);
    }
}

async function submitLifecycleEvent() {
    const button = $("la-submit");
    const storeId = $("la-store").value;
    const storeName = storeId
        ? ($("la-store").selectedOptions[0]?.textContent || null) : null;
    const eventType = $("la-type").value;
    const eventDate = $("la-date").value;
    const typeLabel = eventType === "open" ? "오픈" : "폐점";

    if (!storeId || !eventDate) {
        laNotice("매장·일자는 필수입니다.", true);
        return;
    }

    button.disabled = true;
    laNotice("저장하는 중…");

    try {
        // [K] 세션이 없으면 insert 가 RLS(created_by=auth.uid()) 위반 원문으로
        // 실패합니다 — 원문 대신 다음 동작이 있는 안내를 줍니다.
        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) {
            laNotice("로그인 세션이 없어 저장할 수 없습니다. 새로고침해 다시 로그인해 주세요.", true);
            return;
        }

        // [D] 중복 확인 — 같은 매장의 기존 기록을 서버에서 새로 읽습니다.
        const { data: existing } = await db.rpc("api_store_lifecycle",
            { p_store: storeName });
        const events = Array.isArray(existing) ? existing : [];
        const sameDay = events.find((e) =>
            e.event_type === eventType && e.event_date === eventDate);
        if (sameDay) {
            laNotice(`이미 같은 기록이 있습니다: ${storeName} ${typeLabel} ${eventDate}. `
                + "중복으로 넣지 않았습니다.", true);
            return;
        }
        // 이력은 최신순 — 첫 행이 현재 상태입니다(api_store_lifecycle 정렬).
        const latest = events[0];
        if (latest && latest.event_type === eventType) {
            const proceed = window.confirm(
                `${storeName}의 최근 기록이 이미 '${typeLabel}' 입니다`
                + ` (${latest.event_date}).\n같은 상태를 또 기록하면 연간`
                + ` ${typeLabel} 건수가 두 번 세집니다. 그래도 기록할까요?`);
            if (!proceed) {
                laNotice("저장하지 않았습니다.");
                return;
            }
        }

        const { error } = await db.from("store_lifecycle_events").insert({
            store_id: Number(storeId),
            event_type: eventType,
            event_date: eventDate,
            note: $("la-note").value.trim() || null,
            created_by: session?.user?.id,
        });

        if (error) {
            const message = /row-level security/i.test(error.message || "")
                ? "로그인 세션이 만료됐습니다. 새로고침해 다시 로그인해 주세요."
                : error.message;
            laNotice("저장하지 못했습니다: " + message, true);
            return;
        }

        laNotice("저장했습니다.");
        $("la-note").value = "";
        await Promise.all([
            refreshLifecycleStatus(),
            refreshLifecycleHistory(),
            refreshMismatchAndYears(),
        ]);
        await refreshLifecycleSummary();
        // 가맹점 DB 의 폐점 배지·필터([F])도 이 이벤트로 낡습니다 — 갱신 신호.
        window.dispatchEvent(new Event("mitaly:storedb-refresh"));
    } finally {
        button.disabled = false;
    }
}

async function refreshLifecycleSummary() {
    const year = Number($("ls-year").value) || null;
    const { data, error } = await db.rpc("api_store_lifecycle_summary",
        { p_year: year });
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

// [E] 프로필 영업시작일 ↔ 최초 오픈 이벤트 일자 대조 + [J] 연도 목록.
// 전 매장 이벤트(넉넉히 1000건)와 프로필을 한 번씩 읽어 둘 다 만듭니다.
async function refreshMismatchAndYears() {
    const [evRes, profRes] = await Promise.all([
        db.rpc("api_store_lifecycle", { p_store: null, p_limit: 1000 }),
        db.rpc("api_store_profiles"),
    ]);
    const events = Array.isArray(evRes.data) ? evRes.data : [];

    // 연도 목록: 이벤트에 있는 연도 ∪ 올해. 고른 값은 유지합니다.
    const yearSelect = $("ls-year");
    const current = yearSelect.value;
    const thisYear = new Date().getFullYear();
    const years = [...new Set([thisYear,
        ...events.map((e) => Number(String(e.event_date).slice(0, 4)))
                 .filter((y) => Number.isFinite(y) && y > 2000)])]
        .sort((a, b) => b - a);
    yearSelect.innerHTML = "";
    for (const y of years) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = `${y}년`;
        yearSelect.append(opt);
    }
    yearSelect.value = years.map(String).includes(current) ? current : String(thisYear);

    // 어긋남 표시: 매장별 '최초 오픈 이벤트' 일자와 프로필 영업시작일이 둘 다
    // 있는데 다르면 나열합니다. 프로필 쪽이 권위값(현재 진실)이고 이벤트는
    // 처음 기록한 날짜로 남는 감사 표시입니다 — 여기서는 고치지 않고 보여만
    // 줍니다(동기화 여부는 담당자 결정 대기).
    if (profRes.error) return;
    const profileStart = new Map();
    for (const p of (Array.isArray(profRes.data) ? profRes.data : [])) {
        if (p.business_start_date) profileStart.set(p.store_name, p.business_start_date);
    }
    const firstOpen = new Map();   // store_name → 가장 이른 open 일자
    for (const e of events) {
        if (e.event_type !== "open") continue;
        const prev = firstOpen.get(e.store_name);
        if (!prev || e.event_date < prev) firstOpen.set(e.store_name, e.event_date);
    }
    const mismatches = [];
    for (const [name, openDate] of firstOpen) {
        const profDate = profileStart.get(name);
        if (profDate && profDate !== openDate) {
            mismatches.push({ name, profDate, openDate });
        }
    }
    mismatches.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const box = $("lifecycle-mismatch");
    if (!mismatches.length) {
        box.hidden = true;
        box.textContent = "";
        return;
    }
    box.hidden = false;
    box.textContent =
        `가맹점 DB 영업시작일과 오픈 이력 일자가 다른 매장 ${int(mismatches.length)}곳 — `
        + mismatches.map((m) =>
            `${m.name} (가맹점 DB ${m.profDate} / 오픈 이력 ${m.openDate})`).join(" · ")
        + ". 가맹점 DB 쪽이 최신 값이고, 오픈 이력은 처음 기록한 날짜로 남습니다.";
}
