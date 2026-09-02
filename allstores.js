// 전매장 현황 — 93_all_stores_kpi.sql(api_all_stores_kpi) 위의 화면
// (카드 #113 — KPI 엑셀 04_전매장_현황 이식 · #146 카테고리 재편+플랫폼 분리).
// KPI(총매출·목표·달성률·전월비·영업일수·일평균·인당생산성·홀/배달·배달비중)
// + 추정 손익(91 mitaly_kpi_pnl — #112 와 같은 함수)
// + 배달매출 플랫폼별(99 api_delivery_by_platform)
// + 배달비(100 api_delivery_fees · 카드 #150A). db + foundation 만 import.
//
// · 조회는 rpc 세 개 병렬(93 + 99 + 100) — 기준월이 바뀔 때만 다시 부릅니다.
//   99·100 은 실패해도 표를 죽이지 않습니다: 플랫폼·배달비 열만 '—' 로 두고
//   나머지는 정상 렌더(#146 요구 — 기존 화면 보전). 조인 키는 매장명입니다.
// · '매출' 카테고리에서 3사(배달의민족·쿠팡이츠·요기요)+기타 배달은 각각
//   [매출 | 배달비] 두 열입니다(리드데이터식 · 카드 #150A). 배달비는 실측
//   원천(channel_fee_day)이 있는 칸만 숫자(0이면 '0원'), 미확보는 '—'.
//   쿠팡이츠·기타 배달은 아직 배달비 원천이 없어 자연히 '—' 입니다.
// · 실적·목표달성·원가추정이 한 표에 섞여 시선이 분산된다는 담당자 요청
//   (2026-08-31)으로 열을 [매출 | 매출파악 | 매출분석] 3개 카테고리로
//   나눴습니다. 기존 23열은 삭제 없이 재배치(0 삭제)이고, 엑셀 내보내기는
//   카테고리와 무관하게 전체 열 + 플랫폼 열을 내립니다(기능 보전).
// · 플랫폼 고정 3사(배달의민족=배민·쿠팡이츠·요기요) 밖 소스는 매출이 있을
//   때만 '기타 배달' 한 열로 합산 — 0이면 열 자체를 만들지 않습니다.
//   배달비·'순매출' 열은 일부러 없습니다: 배달비는 아직 어느 채널도 수집
//   전(카드 #147)이고, 우리 금액은 할인 전 품목 금액이라 리드데이터 순매출과
//   정의가 다릅니다(99 머리주석).
// · SV 필터·클릭 정렬은 받은 배열 안에서만 움직입니다(재조회 없음).
// · 기본 정렬 = 달성률 내림차순 · null(목표 없음)은 뒤 — 시트 04 그대로.
//   달성률 열이 없는 카테고리에서도 이 순서가 유지되고, 헤더를 누르면 그
//   열 기준으로 바뀝니다. 카테고리를 옮겨 정렬 열이 사라지면 기본으로 복귀.
// · 증감 색은 KPI 시트 관례(상승 빨강·하락 파랑) — weekly.js 와 같은
//   wk-up/wk-down 을 씁니다(기존 pct-up/down 은 '좋음/나쁨' 색이라 반대로 읽힘).
// · 폐점 매장도 행에 있고 배지가 붙습니다(시트 07 — 폐점 과거실적 열람).
// · 열이 많아 표는 카드 안(.tableview)에서만 가로 스크롤됩니다.
// · 추정치 각주(as-note)는 손익 열이 보이는 '매출분석' 에서만 표시합니다.
// · 새 DOM id 는 aspf- 접두(병렬 카드와의 id 충돌 방지 — 기존 as-* 와 구분).

import { db } from "./client.js";
import { wonFull, int } from "./format.js";
import { escape } from "./util.js";
import { S } from "./state.js";
import { $, monthPicker, table } from "./dom.js";

const pctText = (v, digits = 1) =>
    v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

// 증감 셀 — 시트 관례 색(상승 빨강 · 하락 파랑). weekly.js 의 wowCell 과 동일.
function diffCell(pct) {
    if (pct == null) return "—";
    const cls = pct > 0 ? "wk-up" : pct < 0 ? "wk-down" : "";
    const text = `${pct > 0 ? "+" : ""}${pct}%`;
    return cls ? `<span class="${cls}">${text}</span>` : text;
}

let stores = [];                 // 마지막 응답의 매장 배열(서버 정렬 순서)
let platByStore = null;          // 매장명 → {소스명: 금액}. 99 실패 시 null
let platSources = [];            // 그 달 배달매출이 실재한 소스 이름들(99)
let feeByStore = null;           // 매장명 → {소스명: 배달비합}. 100 실패 시 null
let category = "sales";          // 'sales' | 'grasp' | 'pnl' — 기본 '매출'

// 고정 3사 열이 집는 소스 이름. DB 실값은 '배민'(schema.sql 씨드)이고 열
// 이름만 정식 명칭 '배달의민족' 입니다 — 소스명이 바뀌어도 잡히게 둘 다.
const PLATFORM_MAIN = [
    { label: "배달의민족", keys: ["배민", "배달의민족"] },
    { label: "쿠팡이츠",   keys: ["쿠팡이츠"] },
    { label: "요기요",     keys: ["요기요"] },
];
const MAIN_KEYS = new Set(PLATFORM_MAIN.flatMap((p) => p.keys));

// 매장 한 곳의 플랫폼 금액. 99 실패(platByStore null)면 null → 화면 '—'.
// 데이터는 왔는데 그 매장·그 소스 매출이 없으면 0 (배달 0원 매장과 같은 표기).
function platAmount(r, keys) {
    if (!platByStore) return null;
    const p = platByStore.get(r.name);
    if (!p) return 0;
    return keys.reduce((acc, k) => acc + (Number(p[k]) || 0), 0);
}

// '기타 배달' = 고정 3사 밖 소스 전부의 합(땡겨요·먹깨비·신규 채널 대비).
function platEtc(r) {
    if (!platByStore) return null;
    const p = platByStore.get(r.name);
    if (!p) return 0;
    return Object.entries(p)
        .filter(([k]) => !MAIN_KEYS.has(k))
        .reduce((acc, [, v]) => acc + (Number(v) || 0), 0);
}

// '기타 배달' 열은 그 달 3사 밖 매출이 실재할 때만 만듭니다(0이면 생략).
const etcExists = () =>
    platByStore != null
    && platSources.some((s) => !MAIN_KEYS.has(s))
    && stores.some((r) => (platEtc(r) || 0) > 0);

// 배달비(100). 미확보는 null → 화면 '—' / 0 은 확보된 '배달비 0원' → '0원'.
//   · 100 실패(feeByStore null)                → null (열 전체 '—')
//   · 그 매장·그 소스에 배달비 행이 없음        → null ('—', 미확보)
//   · 숫자(0 포함)                              → 그대로 (0 은 '0원')
// 원천 없는 소스(쿠팡이츠·기타 배달)는 자연히 전부 null 이 됩니다(문서 8절).
function feeAmount(r, keys) {
    if (!feeByStore) return null;
    const f = feeByStore.get(r.name);
    if (!f) return null;
    for (const k of keys) {
        if (f[k] != null) return Number(f[k]);   // 0 도 확보값 — 그대로
    }
    return null;
}

// '기타 배달' 배달비 = 고정 3사 밖 소스 배달비 합. 하나도 없으면 null('—').
function feeEtc(r) {
    if (!feeByStore) return null;
    const f = feeByStore.get(r.name);
    if (!f) return null;
    let sum = null;
    for (const [k, v] of Object.entries(f)) {
        if (MAIN_KEYS.has(k) || v == null) continue;
        sum = (sum || 0) + Number(v);
    }
    return sum;
}

// 배달비 셀 — 미확보(null)는 '—', 확보(0 포함)는 원단위 표기.
const feeCell = (v) => (v == null ? "—" : escape(wonFull(v)));

// ------------------------------------------------------------------ 열 정의
// 기존 23열 전부 + 플랫폼 열. 카테고리는 이 목록에서 고르기만 합니다(삭제 0).
// value: 정렬·엑셀용 원시 값 / cell: 화면 표기(html 허용).
const COLS = {
    name:    { label: "매장",       text: true, value: (r) => r.name, cell: nameCell },
    sv:      { label: "담당 SV",    text: true, value: (r) => r.sv_name || "",
               cell: (r) => (r.sv_name ? escape(r.sv_name) : "—") },
    staff:   { label: "근무인원",   value: (r) => num(r.staff_count),
               cell: (r) => (r.staff_count != null ? escape(String(r.staff_count)) : "—") },
    sales:   { label: "총매출",     value: (r) => num(r.sales),
               cell: (r) => escape(wonFull(r.sales)) },
    target:  { label: "목표",       value: (r) => num(r.target),
               cell: (r) => (r.target != null ? escape(wonFull(r.target)) : "—") },
    achievement: { label: "달성률", value: (r) => num(r.achievement),
               cell: (r) => (r.achievement != null ? escape(pctText(r.achievement, 1)) : "—") },
    mom:     { label: "전월비",     value: (r) => num(r.mom_pct),
               cell: (r) => diffCell(r.mom_pct) },
    bizdays: { label: "영업일수",   value: (r) => num(r.business_days),
               cell: (r) => (r.business_days ? escape(int(r.business_days)) : "—") },
    davg:    { label: "일평균",     value: (r) => num(r.daily_avg),
               cell: (r) => (r.daily_avg != null ? escape(wonFull(r.daily_avg)) : "—") },
    perperson: { label: "인당 생산성", value: (r) => num(r.per_person),
               cell: (r) => (r.per_person != null ? escape(wonFull(r.per_person)) : "—") },
    hall:    { label: "홀매출",     value: (r) => num(r.hall_sales),
               cell: (r) => escape(wonFull(r.hall_sales)) },
    delivery: { label: "배달매출",  value: (r) => num(r.delivery_sales),
               cell: (r) => escape(wonFull(r.delivery_sales)) },
    dshare:  { label: "배달비중",   value: (r) => num(r.delivery_share),
               cell: (r) => escape(pctText(r.delivery_share, 1)) },
    pfEtc:   { label: "기타 배달",  value: (r) => platEtc(r),
               cell: (r) => moneyCell(platEtc(r)) },
    food:    { label: "식자재비",   value: (r) => num(r.pnl?.food?.amount),
               cell: (r) => escape(wonFull(r.pnl?.food?.amount)) },
    labor:   { label: "인건비",     value: (r) => num(r.pnl?.labor?.amount),
               cell: (r) => escape(wonFull(r.pnl?.labor?.amount)) },
    rent:    { label: "임차료",     value: (r) => num(r.pnl?.rent?.amount),
               cell: (r) => escape(wonFull(r.pnl?.rent?.amount)) },
    dfee:    { label: "배달수수료", value: (r) => num(r.pnl?.delivery_fee?.amount),
               cell: (r) => escape(wonFull(r.pnl?.delivery_fee?.amount)) },
    royalty: { label: "로열티·광고", value: (r) => num(r.pnl?.royalty?.amount),
               cell: (r) => escape(wonFull(r.pnl?.royalty?.amount)) },
    utility: { label: "공과금·기타", value: (r) => num(r.pnl?.utility?.amount),
               cell: (r) => escape(wonFull(r.pnl?.utility?.amount)) },
    profit:  { label: "영업이익",   value: (r) => num(r.pnl?.profit),
               cell: (r) => escape(wonFull(r.pnl?.profit)) },
    profitRate: { label: "영업이익률", value: (r) => num(r.pnl?.profit_rate),
               cell: (r) => escape(pctText(r.pnl?.profit_rate, 1)) },
    foodRate: { label: "원가율",    value: (r) => num(r.pnl?.food_cost_rate),
               cell: (r) => escape(pctText(r.pnl?.food_cost_rate, 1)) },
};
for (const p of PLATFORM_MAIN) {
    COLS[`pf:${p.label}`] = {
        label: p.label,
        value: (r) => platAmount(r, p.keys),
        cell: (r) => moneyCell(platAmount(r, p.keys)),
    };
    // 각 플랫폼 '매출' 열 옆에 붙는 '배달비' 열(리드데이터식 · 카드 #150A).
    COLS[`fee:${p.label}`] = {
        label: "배달비",
        value: (r) => feeAmount(r, p.keys),
        cell: (r) => feeCell(feeAmount(r, p.keys)),
    };
}
COLS.feeEtc = {
    label: "배달비",
    value: (r) => feeEtc(r),
    cell: (r) => feeCell(feeEtc(r)),
};

// 카테고리 → 열 키 목록. 순번은 render 가 항상 맨 앞에 붙입니다.
// 기존 열 재배치(삭제 0): 근무인원·목표·달성률·영업일수·일평균·인당 생산성은
// '매출파악' 으로, 손익 9열은 '매출분석' 으로 갔습니다.
const CATEGORIES = {
    sales: () => ["name", "sv", "sales", "mom", "hall", "delivery", "dshare",
        // 플랫폼마다 [매출 | 배달비] 두 열이 나란히(리드데이터식 · #150A).
        ...PLATFORM_MAIN.flatMap((p) => [`pf:${p.label}`, `fee:${p.label}`]),
        ...(etcExists() ? ["pfEtc", "feeEtc"] : [])],
    grasp: () => ["name", "sv", "staff", "sales", "target", "achievement",
        "mom", "bizdays", "davg", "perperson"],
    pnl: () => ["name", "sv", "sales", "food", "labor", "rent", "dfee",
        "royalty", "utility", "profit", "profitRate", "foodRate"],
};

// 정렬 상태 — key 는 COLS 의 키. 기본 = 달성률 내림차순(시트 04, 93 설계 [4]).
const DEFAULT_SORT = () => ({ key: "achievement", asc: false });
let sort = DEFAULT_SORT();

// null 은 정렬 방향과 무관하게 뒤로 — '목표 없음' 이 내림차순 맨 위로
// 튀어 오르지 않게(시트 04 의 달성률 정렬과 같은 규칙, 93 설계 [4]).
const num = (v) => (v == null ? null : Number(v));

const moneyCell = (v) => (v == null ? "—" : escape(wonFull(v)));

function sortedRows() {
    const sv = $("as-sv").value;
    const filtered = sv ? stores.filter((r) => r.sv_name === sv) : stores;
    const col = COLS[sort.key] || COLS.achievement;
    return [...filtered].sort((a, b) => {
        const [x, y] = [col.value(a), col.value(b)];
        if (x == null && y == null) return num(b.sales) - num(a.sales);
        if (x == null) return 1;
        if (y == null) return -1;
        const cmp = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
        return (sort.asc ? cmp : -cmp)
            || num(b.sales) - num(a.sales) || String(a.name).localeCompare(String(b.name));
    });
}

// 폐점 배지 — 기존 .flag(빨강 + 글자)를 그대로 씁니다(#112 의 전용 배지는
// 그 브랜치의 것이라 여기서 새 클래스를 만들지 않습니다).
function nameCell(r) {
    const badge = r.status === "close"
        ? `<span class="flag">폐점</span>` : "";
    return escape(r.name) + badge;
}

// 엑셀 내보내기 — 카테고리와 무관하게 전체 열(기존 24열 + 플랫폼 열)을 원시
// 숫자로 내립니다. 화면의 '1.2억'류·배지 없이 바로 계산되게(기존 동작 유지).
function exportSpec(rows) {
    const withEtc = etcExists();
    const headers = ["순번", "매장", "상태", "담당 SV", "근무인원",
        "총매출", "목표", "달성률", "전월비(%)", "영업일수", "일평균",
        "인당 생산성", "홀매출", "배달매출", "배달비중",
        // 플랫폼마다 [매출, 배달비] 두 열 — 화면과 같은 짝. 배달비 원시 숫자.
        ...PLATFORM_MAIN.flatMap((p) => [p.label, `${p.label} 배달비`]),
        ...(withEtc ? ["기타 배달", "기타 배달 배달비"] : []),
        "식자재비", "인건비", "임차료", "배달수수료", "로열티·광고",
        "공과금·기타", "영업이익", "영업이익률", "원가율"];
    return {
        headers,
        rows: rows.map((r, i) => {
            const p = r.pnl || {};
            return [i + 1, r.name, r.status === "close" ? "폐점" : "",
                r.sv_name, r.staff_count,
                r.sales, r.target, r.achievement, r.mom_pct,
                r.business_days, r.daily_avg, r.per_person,
                r.hall_sales, r.delivery_sales, r.delivery_share,
                ...PLATFORM_MAIN.flatMap((pf) => [platAmount(r, pf.keys), feeAmount(r, pf.keys)]),
                ...(withEtc ? [platEtc(r), feeEtc(r)] : []),
                p.food?.amount, p.labor?.amount, p.rent?.amount,
                p.delivery_fee?.amount, p.royalty?.amount, p.utility?.amount,
                p.profit, p.profit_rate, p.food_cost_rate];
        }),
    };
}

function render() {
    const keys = CATEGORIES[category]();
    // 정렬 열이 이 카테고리에 없으면 기본(달성률 — 서버 정렬 순서)으로 복귀.
    if (!keys.includes(sort.key) && sort.key !== "achievement") sort = DEFAULT_SORT();

    const rows = sortedRows();
    const headers = ["순번", ...keys.map((k) => COLS[k].label)];
    const view = rows.map((r, i) =>
        [int(i + 1), ...keys.map((k) => COLS[k].cell(r))]);

    // 헤더 표식용 정렬 상태 — table() 은 열 인덱스를 쓰므로 키를 변환합니다.
    const sortIdx = keys.indexOf(sort.key);
    const sortState = sortIdx >= 0 ? { key: sortIdx + 1, asc: sort.asc } : null;

    table($("t-allstores"), headers, view, {
        html: true, sortable: true, sortState,
        export: exportSpec(rows),
    });

    $("t-allstores").querySelectorAll("th.sortable").forEach((th, i) => {
        th.addEventListener("click", () => {
            const key = i === 0 ? "name" : keys[i - 1];   // 순번 클릭 = 매장명
            sort = sort.key === key
                ? { key, asc: !sort.asc }
                : { key, asc: !!COLS[key].text };   // 이름·SV 는 오름차순이 자연스러움
            render();
        });
    });

    const withTarget = rows.filter((r) => r.achievement != null).length;
    const platNote = (category === "sales" && !platByStore && stores.length)
        ? " · 플랫폼별 배달매출을 불러오지 못했습니다" : "";
    $("as-meta").textContent = stores.length
        ? `${int(rows.length)}곳${rows.length !== stores.length ? ` / 전체 ${int(stores.length)}곳` : ""}`
          + ` · 목표 있는 매장 ${int(withTarget)}곳 — 위 필터와 무관` + platNote
        : "";

    // 손익 라벨 + 금액 기준 각주(kpi-sheet-adoption.md 6절) — 추정 손익 열이
    // 보이는 '매출분석' 에서만 답니다(#146 — 다른 카테고리는 각주 대상이 없음).
    $("as-note").textContent = category === "pnl"
        ? "식자재비부터 원가율까지는 가정값 기반 추정치입니다 — 실측(아워홈 발주 "
          + "· 근무인원 · 임차료 · 로열티 실요율)이 있는 매장은 그 값이 우선. "
          + "영업일수·일평균은 일 단위 집계 기준(소급 진행 중), 금액은 메뉴 매출 "
          + "기준이라 KPI 시트 과거 연도(배달비 포함)와 1:1로 일치하지 않습니다."
        : "";

    // 배달비 각주 — '매출' 카테고리에서만(그 열이 보이는 곳). 미확보 '—' 의
    // 뜻만 알려 주는 표기 안내입니다(안전·보안 안내문 아님 — CLAUDE.md 문구 규칙).
    $("cfee-note").textContent = category === "sales"
        ? "배달비는 실측 원천을 확보한 채널·기간만 표시합니다 — 미확보 칸은 —."
        : "";
}

// SV 목록은 응답에 실려 온 값으로 만듭니다(가맹점 DB 반입분 store_profiles.sv_name
// — 방문·점검 필터와 같은 원천). 고른 값은 목록을 다시 만들어도 유지합니다.
function fillSv() {
    const select = $("as-sv");
    const keep = select.value;
    const names = [...new Set(stores.map((r) => r.sv_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">전체</option>'
        + names.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join("");
    if (names.includes(keep)) select.value = keep;
}

async function refresh() {
    const ym = Number($("as-ym").value);
    if (!ym) return;
    $("as-meta").textContent = "불러오는 중…";

    // 93 + 99 + 100 병렬. 99·100 은 실패해도 표를 못 죽입니다 — 플랫폼·배달비
    // 열만 '—'(머리주석). 93(KPI)만 실패하면 표 자체를 못 그립니다.
    const [kpi, plat, fees] = await Promise.all([
        db.rpc("api_all_stores_kpi", { p_ym: ym }),
        Promise.resolve(db.rpc("api_delivery_by_platform", { p_ym: ym }))
            .catch(() => ({ data: null, error: true })),
        Promise.resolve(db.rpc("api_delivery_fees", { p_ym: ym }))
            .catch(() => ({ data: null, error: true })),
    ]);

    if (kpi.error || !kpi.data || kpi.data.ok === false) {
        $("as-meta").textContent = "";
        $("t-allstores").innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(kpi.error ? kpi.error.message : (kpi.data && kpi.data.reason) || "알 수 없는 오류")
            + "</p>";
        return;
    }
    stores = Array.isArray(kpi.data.stores) ? kpi.data.stores : [];

    if (!plat.error && plat.data && plat.data.ok !== false
            && Array.isArray(plat.data.stores)) {
        platByStore = new Map(plat.data.stores.map((s) => [s.store, s.platforms || {}]));
        platSources = Array.isArray(plat.data.sources) ? plat.data.sources : [];
    } else {
        platByStore = null;
        platSources = [];
    }

    if (!fees.error && fees.data && fees.data.ok !== false
            && Array.isArray(fees.data.stores)) {
        feeByStore = new Map(fees.data.stores.map((s) => [s.store, s.fees || {}]));
    } else {
        feeByStore = null;
    }

    fillSv();
    render();
}

function initCategoryToggle() {
    const seg = $("aspf-cat");
    seg.querySelectorAll("button[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.dataset.cat === category) return;
            category = btn.dataset.cat;
            seg.querySelectorAll("button[data-cat]").forEach((b) =>
                b.classList.toggle("on", b === btn));
            render();   // 재조회 없음 — 받은 배열로 열만 다시 그립니다
        });
    });
}

export async function initAllStores() {
    // 기준월 달력 — 데이터가 실존하는 범위(전역 필터와 같은 원천).
    const range = S.filterRange || {};
    monthPicker("as-ym", { min: range.min, max: range.max });
    if (range.max) {
        // 기본값 = 마지막 완성 월(진행 중인 달이면 전월 — app.js H3 과 같은 규칙).
        const t = new Date();
        const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
        let ym = range.max;
        if (ym >= nowYm) {
            ym = ym % 100 === 1 ? ym - 89 : ym - 1;
            if (range.min && ym < range.min) ym = range.min;
        }
        $("as-ym").value = String(ym);
    }

    initCategoryToggle();
    $("as-ym").addEventListener("change", refresh);
    $("as-sv").addEventListener("change", render);
    await refresh();
}
