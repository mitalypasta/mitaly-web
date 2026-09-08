// 오픈·폐점 (8번 영역) — 27_store_lifecycle.sql + 103_store_status.sql 위의
// 화면. app.js 에서 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation 만
// import.
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
//
// 카드 #159 (103_store_status.sql, 2026-09-08):
//   · 이벤트 4종(오픈·폐점·오픈 예정·폐점 예정). 상태는 마지막 기록 하나로.
//   · api_store_lifecycle_status 가 전 매장을 내려 줍니다 — status(기존 키,
//     이벤트 종류 그대로·없으면 null) 대신 state(5값)를 읽고, 기록 없는 매장은
//     '기록 없음' 으로 노출합니다(운영/폐점 판정은 사람 몫 — #158 대조표).
//   · last_sales_ym · sales_gap_months 로 '매출 끊김' 힌트 — 폐점 기록 없이
//     매출이 끊긴 매장을 폐점 후보로 보여 줍니다(판정 아님).

import { db, fetchStores } from "./client.js";
import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

// 이벤트 종류(store_lifecycle_events.event_type) 표기 — 103 의 check 4값.
const TYPE_LABEL = {
    open: "오픈", close: "폐점",
    planned_open: "오픈 예정", planned_close: "폐점 예정",
};
// 상태 5값(103 의 mitaly_lifecycle_state) 표기·태그 색. 색만으로 뜻을 전하지
// 않도록 글자를 같이 답니다(styles.css .tag 규칙).
const STATE_LABEL = {
    operating: "운영", planned_open: "오픈 예정", planned_close: "폐점 예정",
    closed: "폐점", unknown: "기록 없음",
};
const STATE_TAG = {
    operating: "tag up", planned_open: "tag st-early", planned_close: "tag h-warn",
    closed: "tag down", unknown: "tag",
};
const STATE_ORDER = ["operating", "planned_open", "planned_close", "closed", "unknown"];

// '매출 끊김' 힌트 문턱 — 자료 최신월보다 이만큼 이상 앞에서 매출이 끝났는데
// 폐점 기록이 없으면 폐점 후보로 표시합니다. 판정 기준이 아니라 화면 힌트라
// 설정 표에 두지 않았습니다(HQ-FEEDBACK 2절 실측이 '3개월 이상 끊김' 기준).
const GAP_HINT_MONTHS = 3;

let lcStatusRows = [];   // api_store_lifecycle_status 응답(전 매장) — 필터가 다시 씁니다

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
    $("lc159-filter").addEventListener("change", renderLifecycleStatus);

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
    const typeLabel = TYPE_LABEL[eventType] || eventType;

    if (!storeId || !eventDate) {
        laNotice("매장과 일자는 꼭 넣어 주세요.", true);
        return;
    }
    if (!TYPE_LABEL[eventType]) {
        laNotice("구분 값이 올바르지 않습니다.", true);
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
            // 연간 건수(요약)는 오픈·폐점만 셉니다 — 예정 기록은 그 경고가 없습니다.
            const countsWarning = (eventType === "open" || eventType === "close")
                ? `\n같은 상태를 또 기록하면 연간 ${typeLabel} 건수가 두 번 세집니다.`
                : "\n같은 예정을 또 기록하면 이력에 두 줄로 남습니다.";
            const proceed = window.confirm(
                `${storeName}의 최근 기록이 이미 '${typeLabel}' 입니다`
                + ` (${latest.event_date}).${countsWarning} 그래도 기록할까요?`);
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
                : /store_lifecycle_events_type_check/.test(error.message || "")
                    ? "이 환경의 DB 가 아직 '오픈 예정·폐점 예정' 을 받지 않습니다"
                      + " (103_store_status.sql 미적용). 담당자에게 알려 주세요."
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

// 202609 → '2026.09'. 값이 없으면 '—'.
function ymLabel(ym) {
    const n = Number(ym);
    if (!Number.isFinite(n) || n < 100) return "—";
    return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

// 폐점 기록이 없는데 매출이 문턱 이상 끊긴 매장 — '폐점 후보' 힌트 대상.
// (폐점·폐점 예정은 이미 사람이 안 것이고, 매출이 아예 없는 매장은 신규
//  오픈 예정일 수 있어 여기서 빼고 표의 '매출 없음' 으로만 보여 줍니다.)
function isSalesGap(r) {
    return (r.state === "operating" || r.state === "unknown")
        && Number.isFinite(Number(r.sales_gap_months))
        && r.sales_gap_months != null
        && Number(r.sales_gap_months) >= GAP_HINT_MONTHS;
}

function stateTag(state) {
    const key = STATE_LABEL[state] ? state : "unknown";
    return `<span class="${STATE_TAG[key]}">${STATE_LABEL[key]}</span>`;
}

function salesHint(r) {
    if (r.sales_gap_months == null) return "매출 없음";
    const gap = Number(r.sales_gap_months);
    if (gap <= 0) return "최신";
    const text = `${int(gap)}개월 끊김`;
    return isSalesGap(r) ? `<span class="flag">${text}</span>` : escape(text);
}

// 경과일 — 예정 기록은 미래일 수 있어 'D-n' 으로 씁니다.
function daysLabel(days) {
    if (days == null || !Number.isFinite(Number(days))) return "—";
    const n = Number(days);
    return n < 0 ? `D-${int(-n)}` : `${int(n)}일`;
}

async function refreshLifecycleStatus() {
    const { data, error } = await db.rpc("api_store_lifecycle_status");
    if (error) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    // 103 적용 전 환경(27 응답: 기록 있는 매장만, state 없음)도 그리도록
    // state 를 status 에서 채웁니다.
    lcStatusRows = (Array.isArray(data) ? data : []).map((r) => ({
        ...r,
        state: r.state || (r.status === "open" ? "operating"
            : r.status === "close" ? "closed" : (r.status || "unknown")),
    }));
    renderLifecycleStatus();
}

function renderLifecycleStatus() {
    const rows = lcStatusRows;
    const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
    for (const r of rows) counts[STATE_LABEL[r.state] ? r.state : "unknown"] += 1;
    const gapRows = rows.filter(isSalesGap);

    $("lifecycle-status-summary").textContent = rows.length
        ? `전 매장 ${int(rows.length)}곳 · `
          + STATE_ORDER.map((s) => `${STATE_LABEL[s]} ${int(counts[s])}`).join(" · ")
        : "";
    $("lc159-planned-opens").textContent = int(counts.planned_open);
    $("lc159-planned-closes").textContent = int(counts.planned_close);
    $("lc159-unknown").textContent = int(counts.unknown);
    $("lc159-unknown-sub").textContent = gapRows.length
        ? `그중 매출 끊김 ${int(gapRows.filter((r) => r.state === "unknown").length)}곳`
        : "오픈·폐점 기록이 없는 매장";

    const hint = $("lc159-gap-hint");
    if (gapRows.length) {
        const dataYm = rows.find((r) => r.data_ym)?.data_ym;
        hint.hidden = false;
        hint.textContent =
            `매출이 ${GAP_HINT_MONTHS}개월 이상 끊겼는데 폐점 기록이 없는 매장 ${int(gapRows.length)}곳`
            + (dataYm ? ` (자료 최신월 ${ymLabel(dataYm)} 기준)` : "") + " — "
            + gapRows.slice(0, 12).map((r) =>
                `${r.store_name} (마지막 매출 ${ymLabel(r.last_sales_ym)})`).join(" · ")
            + (gapRows.length > 12 ? ` 외 ${int(gapRows.length - 12)}곳` : "")
            + ". 폐점 후보일 뿐 판정이 아닙니다 — 폐점이 확정된 매장은 위 폼에서 폐점 기록을 남기세요.";
    } else {
        hint.hidden = true;
        hint.textContent = "";
    }

    if (!rows.length) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">아직 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    const filter = $("lc159-filter").value;
    const shown = !filter ? rows
        : filter === "gap" ? gapRows
        : rows.filter((r) => r.state === filter);
    if (!shown.length) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">이 상태인 매장이 없습니다.</p>';
        return;
    }

    table($("t-lifecycle-status"),
        ["매장", "상태", "최근 기록", "기록일", "경과", "마지막 매출월", "매출"],
        shown.map((r) => [
            escape(r.store_name),
            stateTag(r.state),
            r.status ? escape(TYPE_LABEL[r.status] || r.status) : "—",
            r.since ? escape(r.since) : "—",
            daysLabel(r.days_since),
            ymLabel(r.last_sales_ym),
            salesHint(r),
        ]),
        { html: true,
          export: { headers: ["매장", "상태", "최근 기록", "기록일", "경과일", "마지막 매출월", "매출 끊김(개월)"],
                    rows: shown.map((r) => [
                        r.store_name, STATE_LABEL[r.state] || r.state,
                        TYPE_LABEL[r.status] || r.status || "",
                        r.since || "", r.days_since ?? "",
                        r.last_sales_ym ?? "", r.sales_gap_months ?? "",
                    ]) } });
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
            TYPE_LABEL[v.event_type] || v.event_type,
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
    // 줍니다(동기화 여부는 담당자 결정 대기). 오픈 예정은 오픈이 아니라 뺍니다.
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
