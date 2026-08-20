// 전매장 현황 — 93_all_stores_kpi.sql(api_all_stores_kpi) 위의 화면
// (카드 #113 — KPI 엑셀 04_전매장_현황 이식). 전 매장을 한 표로:
// KPI(총매출·목표·달성률·전월비·영업일수·일평균·인당생산성·홀/배달·배달비중)
// + 추정 손익(91 mitaly_kpi_pnl — #112 와 같은 함수). db + foundation 만 import.
//
// · 조회는 rpc 한 번(93 설계 [1]) — 기준월이 바뀔 때만 다시 부릅니다.
//   SV 필터·클릭 정렬은 받은 배열 안에서만 움직입니다(재조회 없음).
// · 기본 정렬 = 달성률 내림차순 · null(목표 없음)은 뒤 — 시트 04 그대로.
//   클릭 정렬은 매장 비교 카드(app.js drawStoreMetrics)와 같은 방식입니다.
// · 증감 색은 KPI 시트 관례(상승 빨강·하락 파랑) — weekly.js 와 같은
//   wk-up/wk-down 을 씁니다(기존 pct-up/down 은 '좋음/나쁨' 색이라 반대로 읽힘).
// · 폐점 매장도 행에 있고 배지가 붙습니다(시트 07 — 폐점 과거실적 열람).
// · 열이 많아 표는 카드 안(.tableview)에서만 가로 스크롤됩니다.

import { db } from "./client.js";
import { won, wonFull, int, ymLabel } from "./format.js";
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

let stores = [];                       // 마지막 응답의 매장 배열(서버 정렬 순서)
// 정렬 상태 — key 는 아래 HEADERS 인덱스. 기본 = 달성률(6) 내림차순(시트 04).
let sort = { key: 6, asc: false };

const HEADERS = [
    "순번", "매장", "담당 SV", "근무인원",
    "총매출", "목표", "달성률", "전월비", "영업일수", "일평균", "인당 생산성",
    "홀매출", "배달매출", "배달비중",
    "식자재비", "인건비", "임차료", "배달수수료", "로열티·광고", "공과금·기타",
    "영업이익", "영업이익률", "원가율",
];

// 열 인덱스 → 정렬용 원시 값. 순번(0)은 정렬 의미가 없어 매장명으로 대신합니다.
function sortValue(r, key) {
    const p = r.pnl || {};
    switch (key) {
        case 0: case 1: return r.name;
        case 2: return r.sv_name || "";
        case 3: return num(r.staff_count);
        case 4: return num(r.sales);
        case 5: return num(r.target);
        case 6: return num(r.achievement);
        case 7: return num(r.mom_pct);
        case 8: return num(r.business_days);
        case 9: return num(r.daily_avg);
        case 10: return num(r.per_person);
        case 11: return num(r.hall_sales);
        case 12: return num(r.delivery_sales);
        case 13: return num(r.delivery_share);
        case 14: return num(p.food?.amount);
        case 15: return num(p.labor?.amount);
        case 16: return num(p.rent?.amount);
        case 17: return num(p.delivery_fee?.amount);
        case 18: return num(p.royalty?.amount);
        case 19: return num(p.utility?.amount);
        case 20: return num(p.profit);
        case 21: return num(p.profit_rate);
        case 22: return num(p.food_cost_rate);
        default: return null;
    }
}

// null 은 정렬 방향과 무관하게 뒤로 — '목표 없음' 이 내림차순 맨 위로
// 튀어 오르지 않게(시트 04 의 달성률 정렬과 같은 규칙, 93 설계 [4]).
const num = (v) => (v == null ? null : Number(v));

function sortedRows() {
    const sv = $("as-sv").value;
    const filtered = sv ? stores.filter((r) => r.sv_name === sv) : stores;
    return [...filtered].sort((a, b) => {
        const [x, y] = [sortValue(a, sort.key), sortValue(b, sort.key)];
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

function render() {
    const rows = sortedRows();
    const view = rows.map((r, i) => {
        const p = r.pnl || {};
        return [
            int(i + 1),
            nameCell(r),
            r.sv_name ? escape(r.sv_name) : "—",
            r.staff_count != null ? escape(String(r.staff_count)) : "—",
            escape(wonFull(r.sales)),
            r.target != null ? escape(wonFull(r.target)) : "—",
            r.achievement != null ? escape(pctText(r.achievement, 1)) : "—",
            diffCell(r.mom_pct),
            r.business_days ? escape(int(r.business_days)) : "—",
            r.daily_avg != null ? escape(wonFull(r.daily_avg)) : "—",
            r.per_person != null ? escape(wonFull(r.per_person)) : "—",
            escape(wonFull(r.hall_sales)),
            escape(wonFull(r.delivery_sales)),
            escape(pctText(r.delivery_share, 1)),
            escape(wonFull(p.food?.amount)),
            escape(wonFull(p.labor?.amount)),
            escape(wonFull(p.rent?.amount)),
            escape(wonFull(p.delivery_fee?.amount)),
            escape(wonFull(p.royalty?.amount)),
            escape(wonFull(p.utility?.amount)),
            escape(wonFull(p.profit)),
            escape(pctText(p.profit_rate, 1)),
            escape(pctText(p.food_cost_rate, 1)),
        ];
    });

    table($("t-allstores"), HEADERS, view, {
        html: true, sortable: true, sortState: sort,
        // 엑셀에는 원시 숫자로 — 화면의 '1.2억'류·배지 없이 바로 계산되게.
        export: {
            headers: ["순번", "매장", "상태", "담당 SV", "근무인원",
                "총매출", "목표", "달성률", "전월비(%)", "영업일수", "일평균",
                "인당 생산성", "홀매출", "배달매출", "배달비중",
                "식자재비", "인건비", "임차료", "배달수수료", "로열티·광고",
                "공과금·기타", "영업이익", "영업이익률", "원가율"],
            rows: rows.map((r, i) => {
                const p = r.pnl || {};
                return [i + 1, r.name, r.status === "close" ? "폐점" : "",
                    r.sv_name, r.staff_count,
                    r.sales, r.target, r.achievement, r.mom_pct,
                    r.business_days, r.daily_avg, r.per_person,
                    r.hall_sales, r.delivery_sales, r.delivery_share,
                    p.food?.amount, p.labor?.amount, p.rent?.amount,
                    p.delivery_fee?.amount, p.royalty?.amount, p.utility?.amount,
                    p.profit, p.profit_rate, p.food_cost_rate];
            }),
        },
    });

    $("t-allstores").querySelectorAll("th.sortable").forEach((th, i) => {
        th.addEventListener("click", () => {
            sort = sort.key === i
                ? { key: i, asc: !sort.asc }
                : { key: i, asc: i <= 2 };   // 이름·SV 는 오름차순이 자연스러움
            render();
        });
    });

    const withTarget = rows.filter((r) => r.achievement != null).length;
    $("as-meta").textContent = stores.length
        ? `${int(rows.length)}곳${rows.length !== stores.length ? ` / 전체 ${int(stores.length)}곳` : ""}`
          + ` · 목표 있는 매장 ${int(withTarget)}곳 — 위 필터와 무관`
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
    const { data, error } = await db.rpc("api_all_stores_kpi", { p_ym: ym });
    if (error || !data || data.ok === false) {
        $("as-meta").textContent = "";
        $("t-allstores").innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(error ? error.message : (data && data.reason) || "알 수 없는 오류")
            + "</p>";
        return;
    }
    stores = Array.isArray(data.stores) ? data.stores : [];
    fillSv();
    render();

    // 손익 라벨 + 금액 기준 각주(kpi-sheet-adoption.md 6절).
    $("as-note").textContent =
        "식자재비부터 원가율까지는 가정값 기반 추정치입니다 — 실측(아워홈 발주 "
        + "· 근무인원 · 임차료 · 로열티 실요율)이 있는 매장은 그 값이 우선. "
        + "영업일수·일평균은 일 단위 집계 기준(소급 진행 중), 금액은 메뉴 매출 "
        + "기준이라 KPI 시트 과거 연도(배달비 포함)와 1:1로 일치하지 않습니다.";
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

    $("as-ym").addEventListener("change", refresh);
    $("as-sv").addEventListener("change", render);
    await refresh();
}
