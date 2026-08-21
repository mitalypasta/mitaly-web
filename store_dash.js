// 매장 대시보드 — 91_store_dashboard.sql(api_store_dashboard) 위의 화면
// (카드 #112 — KPI 엑셀 01_대시보드 이식). 매장 1곳을 골라 기준월 KPI ·
// 추정 손익 · 연도별/주간/일간 추이를 봅니다. db + foundation 만 import.
//
// · 화면 전체가 rpc 한 번입니다(91 설계 [1]) — 매장·기준월·기준일·연도가
//   바뀔 때만 다시 부릅니다.
// · 증감 색은 KPI 시트 관례(상승 빨강·하락 파랑) — weekly.js 와 같은
//   wk-up/wk-down 을 씁니다(기존 pct-up/down 은 '좋음/나쁨' 색이라 반대로 읽힘).
// · 폐점 매장도 목록에 있고 배지가 붙습니다(시트 07 — 폐점 과거실적 열람).
// · 일간 표의 빈칸 = 미영업(자료 없음) · 0 = 0원 기록 — 서버가 null/0 으로
//   구분해 주는 것을 그대로 그립니다(adoption 6절).

import { db, fetchStores } from "./client.js";
import { won, wonFull, int, ymLabel } from "./format.js";
import { escape, niceTicks } from "./util.js";
import { S } from "./state.js";
import { $, monthPicker, searchify, showTip, hideTip } from "./dom.js";
import { palette, drawBars } from "./charts.js";

const DOW_KO = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일" };
const md = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

let last = null;          // 마지막 응답 — 서브탭 전환 시 차트 재그리기용
let lastStoreId = null;

const pctText = (v, digits = 1) =>
    v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

// 증감 셀 — 시트 관례 색(상승 빨강 · 하락 파랑). weekly.js 의 wowCell 과 동일.
function diffCell(pct) {
    if (pct == null) return "—";
    const cls = pct > 0 ? "wk-up" : pct < 0 ? "wk-down" : "";
    const text = `${pct > 0 ? "+" : ""}${pct}%`;
    return cls ? `<span class="${cls}">${text}</span>` : text;
}

// 기준일 하나가 기준월·연도까지 정합니다(2026-08-21 담당자 지시). 기준일이
// 비어 있을 때(첫 진입·매장 변경 직후)만 숨긴 기준월 칸의 값(마지막 완성월)을
// 쓰고, 서버가 잡아 준 닻이 기준일 칸에 채워지면 그 뒤로는 기준일이 원본입니다.
function currentArgs() {
    const storeId = Number($("sd-store").value);
    if (!storeId) return null;
    const day = $("sd-day").value;
    const ym = day ? Number(day.slice(0, 7).replace("-", "")) : Number($("sd-ym").value);
    if (!ym) return null;
    const args = { p_store_id: storeId, p_ym: ym };
    if (day) args.p_anchor_day = day;
    const year = Number($("sd-year").value);
    if (year) args.p_year = year;
    return args;
}

async function refresh() {
    const args = currentArgs();
    if (!args) {
        // 아무것도 안 골랐을 때 빈칸이 아니라 다음 행동이 보이게(담당자 지시).
        $("sd-meta").textContent = "";
        $("sd-info").textContent = "";
        $("sd-kpis").innerHTML =
            '<div class="sd-empty">매장을 선택하세요 — 위 매장 칸에 이름을 치면 검색됩니다.</div>';
        return;
    }
    // 매장을 바꿨으면 연도 선택은 기준월의 연도로 되돌립니다 — 옛 매장에서
    // 고른 연도가 새 매장의 실적 없는 연도일 수 있어서.
    if (lastStoreId !== args.p_store_id) {
        delete args.p_year;
        $("sd-year").innerHTML = "";
        lastStoreId = args.p_store_id;
    }

    $("sd-meta").textContent = "불러오는 중…";
    const { data, error } = await db.rpc("api_store_dashboard", args);
    if (error || !data || data.ok === false) {
        $("sd-meta").textContent = "";
        $("sd-info").textContent = "불러오지 못했습니다: "
            + (error ? error.message : (data && data.reason) || "알 수 없는 오류");
        return;
    }
    last = data;
    render(data);
}

function render(d) {
    $("sd-meta").textContent =
        `${ymLabel(d.ym)} · 기준일 ${d.anchor_day}`
        + (d.last_data_day ? ` · 일 단위 자료 ~${d.last_data_day}` : "");

    // 기준일 칸에 실제 닻을 되비칩니다(비워 보냈으면 서버 기본값).
    if (!$("sd-day").value) $("sd-day").value = d.anchor_day;

    renderInfo(d);
    renderKpis(d.kpi, d.store);
    renderPnl(d.pnl);
    renderYearSelect(d);
    renderYearly(d);
    renderQuarterly((d.store || {}).name);
    renderWeekly(d);
    renderDaily(d);

    // 금액 기준 각주(adoption 6절) — 시트와 1:1로 안 맞는 것이 정상.
    $("sd-note").textContent =
        "금액은 메뉴 매출 기준(배달 할인 전 · 홀 할인 후)이라 KPI 시트의 "
        + "과거 연도(배달비 포함 총액)와 1:1로 일치하지 않습니다. "
        + "영업일수·주문건수·주간/일간 추이는 일 단위 집계 기준입니다.";
}

// ---- ⓐ 매장 기본 정보 ---------------------------------------------------

function renderInfo(d) {
    const s = d.store || {};
    const p = s.profile;
    const parts = [];
    if (s.status === "close") {
        parts.push(`<span class="sd-close-badge">폐점 · ${escape(s.status_since || "")}</span>`);
    }
    if (s.trade_area) parts.push(`상권 ${escape(s.trade_area)}`);
    if (p) {
        if (p.category) parts.push(`분류 ${escape(p.category)}`);
        if (p.sv_name) parts.push(`담당 ${escape(p.sv_name)}`);
        if (p.region) parts.push(`지역 ${escape(p.region)}`);
        if (p.staff_count != null) parts.push(`근무 ${escape(String(p.staff_count))}명`);
        if (p.seat_count != null) parts.push(`좌석 ${int(p.seat_count)}석`);
        if (p.monthly_rent != null)
            parts.push(`임차료 ${escape(wonFull(p.monthly_rent))} (VAT 별도)`);
        if (p.business_start_date) parts.push(`영업시작 ${escape(p.business_start_date)}`);
        if (p.special_note) parts.push(`특이 ${escape(p.special_note)}`);
    } else {
        parts.push("매장 속성 미입력 — 가맹점 DB 화면에서 채울 수 있습니다");
    }
    $("sd-info").innerHTML = `<b>${escape(s.name || "")}</b> · ` + parts.join(" · ");
}

// ---- ⓑ 기준월 KPI 타일 --------------------------------------------------

function tile(label, value, sub, hero) {
    return `<div class="tile${hero ? " hero" : ""}">`
        + `<div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${sub}</div>` : "")
        + `</div>`;
}

const TARGET_BASIS_KO = {
    same_month: "전년 같은 달 기준",
    year_avg: "전년 영업월 평균 기준",
    new_store: "신규점 기준",
};

// 금액은 전부 원 단위 그대로 보입니다 — "~~만" 축약만으로 끝내지 않기
// (2026-08-21 담당자 지시: "정확한 숫자가 필요해").
function renderKpis(k, store) {
    const tiles = [];
    // hero(34px) 크기면 원 단위 전체 숫자가 타일 폭을 넘습니다 — 표준 크기로
    // 두고 타일 최소 폭을 넓힙니다(#sd-kpis, styles.css).
    tiles.push(tile("총매출", escape(wonFull(k.sales)), ""));

    if (k.target != null) {
        const basis = k.target_source === "manual"
            ? "직접 입력 목표" : (TARGET_BASIS_KO[k.target_basis] || "");
        tiles.push(tile("목표 · 달성률",
            escape(pctText(k.achievement, 1)),
            `목표 ${escape(wonFull(k.target))}${basis ? " · " + escape(basis) : ""}`));
    } else {
        tiles.push(tile("목표 · 달성률", "—", "목표 없음"));
    }

    tiles.push(tile("전월 대비", diffCell(k.mom_pct),
        `전월 ${escape(wonFull(k.prev_sales))}`));
    tiles.push(tile("영업일수", escape(int(k.business_days)) + "일",
        "매출이 있는 날 수"));
    tiles.push(tile("일평균 매출",
        k.daily_avg != null ? escape(wonFull(k.daily_avg)) : "—", ""));
    tiles.push(tile("인당 생산성",
        k.per_person != null ? escape(wonFull(k.per_person)) : "—",
        k.per_person == null ? "근무인원 미입력" : ""));
    tiles.push(tile("배달 비중", escape(pctText(k.delivery_share, 1)),
        `홀 ${escape(wonFull(k.hall_sales))} · 배달 ${escape(wonFull(k.delivery_sales))}`));
    tiles.push(tile("주문 건수", escape(int(k.orders_total)) + "건",
        `홀 ${escape(int(k.orders_hall))} · 배달 ${escape(int(k.orders_delivery))}`));

    $("sd-kpis").innerHTML = tiles.join("");
}

// ---- ⓒ 추정 손익 --------------------------------------------------------

// 항목별 근거 표기 — 실측이면 무엇의 실측인지, 가정이면 어떤 비율 가정인지.
function basisText(key, item) {
    if (!item) return "";
    switch (key) {
        case "food": return item.basis === "ourhome" ? "실측 — 아워홈 발주" : "가정 — 원가율";
        case "labor": return item.basis === "staff"
            ? `실측 — 근무인원 ${item.staff_count}명 기준` : "가정 — 인건비율";
        case "rent": return item.basis === "actual" ? "실측 — 입력된 임차료" : "가정 — 임차료율";
        case "delivery_fee": return "가정 — 배달 수수료율";
        case "royalty": return item.basis === "rate"
            ? `실요율 ${item.rate_pct}%` : "가정 — 분담률";
        case "utility": return "가정 — 경비율";
        default: return "";
    }
}

function renderPnl(p) {
    if (!p) { $("t-sd-pnl").innerHTML = '<p class="hint">데이터가 없습니다.</p>'; return; }
    $("sd-pnl-meta").textContent = "가정값 기반 추정치";

    const share = (amt) => p.sales > 0 ? pctText(amt / p.sales, 1) : "—";
    const row = (label, amt, shareText, basis, cls) =>
        `<tr${cls ? ` class="${cls}"` : ""}><td class="tl">${escape(label)}</td>`
        + `<td>${escape(wonFull(amt))}</td>`
        + `<td>${escape(shareText)}</td>`
        + `<td class="tl">${escape(basis)}</td></tr>`;

    const rows = [
        row("총매출", p.sales, "", ""),
        row("식자재비", p.food.amount, pctText(p.food_cost_rate, 1),
            basisText("food", p.food)),
        row("인건비", p.labor.amount, share(p.labor.amount), basisText("labor", p.labor)),
        row("임차료", p.rent.amount, share(p.rent.amount), basisText("rent", p.rent)),
        row("배달수수료", p.delivery_fee.amount, share(p.delivery_fee.amount),
            basisText("delivery_fee", p.delivery_fee)),
        row("로열티·광고", p.royalty.amount, share(p.royalty.amount),
            basisText("royalty", p.royalty)),
        row("공과금·기타", p.utility.amount, share(p.utility.amount),
            basisText("utility", p.utility)),
        row("총비용", p.total_cost, share(p.total_cost), ""),
        `<tr><td class="tl"><b>영업이익</b></td>`
        + `<td><b>${escape(wonFull(p.profit))}</b></td>`
        + `<td><b>${escape(pctText(p.profit_rate, 1))}</b></td>`
        + `<td class="tl">이익률 = 영업이익 ÷ 총매출</td></tr>`,
    ];
    $("t-sd-pnl").innerHTML =
        `<table><thead><tr><th class="tl">항목</th><th>금액</th>`
        + `<th>매출 대비</th><th class="tl">근거</th></tr></thead>`
        + `<tbody>${rows.join("")}</tbody></table>`;

    $("sd-pnl-note").textContent =
        "식자재비·원가율은 아워홈 발주 기준(VAT 포함 · 본사물류 하한 — 자점매입 미포함)입니다.";
}

// ---- ⓓ 연도별 월간 추이 + 그래프 2개 ------------------------------------

function renderYearSelect(d) {
    const select = $("sd-year");
    const years = Array.isArray(d.years) && d.years.length ? d.years : [d.year];
    const want = years.map(String).join("|");
    if (select.dataset.built !== want) {
        select.dataset.built = want;
        select.innerHTML = years.map((y) =>
            `<option value="${y}">${y}년</option>`).join("");
    }
    select.value = String(d.year);
}

function renderYearly(d) {
    const rows = Array.isArray(d.yearly) ? d.yearly : [];
    const sum = (key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const bizSum = sum("business_days");
    const salesSum = sum("sales");
    const ourhomeSum = rows.reduce((a, r) => a + (r.ourhome != null ? Number(r.ourhome) : 0), 0);
    const hasOurhome = rows.some((r) => r.ourhome != null);

    // 전월비 — 표시 연도 안에서만 잇습니다(1월은 전년 12월이 이 응답에 없어
    // "—"). 증감 색은 주간·일간·분기와 같은 시트 관례(diffCell).
    const momOf = (r, i) => {
        const prev = i > 0 ? Number(rows[i - 1].sales) || 0 : 0;
        return i > 0 && prev > 0 && r.sales
            ? Math.round((Number(r.sales) - prev) / prev * 1000) / 10 : null;
    };
    const body = rows.map((r, i) => `<tr>
        <td class="tl">${escape(String(r.ym % 100))}월</td>
        <td>${r.sales ? escape(wonFull(r.sales)) : "—"}</td>
        <td>${diffCell(momOf(r, i))}</td>
        <td>${r.hall ? escape(wonFull(r.hall)) : "—"}</td>
        <td>${r.delivery ? escape(wonFull(r.delivery)) : "—"}</td>
        <td>${r.ourhome != null ? escape(wonFull(Math.round(r.ourhome))) : "—"}</td>
        <td>${escape(pctText(r.food_rate, 1))}</td>
        <td>${r.business_days ? escape(int(r.business_days)) : "—"}</td>
        <td>${r.daily_avg != null ? escape(wonFull(r.daily_avg)) : "—"}</td>
    </tr>`).join("");
    const foot = `<tr>
        <td class="tl"><b>합계</b></td>
        <td><b>${escape(wonFull(salesSum))}</b></td>
        <td>—</td>
        <td><b>${escape(wonFull(sum("hall")))}</b></td>
        <td><b>${escape(wonFull(sum("delivery")))}</b></td>
        <td><b>${hasOurhome ? escape(wonFull(Math.round(ourhomeSum))) : "—"}</b></td>
        <td><b>${hasOurhome && salesSum > 0 ? escape(pctText(ourhomeSum / salesSum, 1)) : "—"}</b></td>
        <td><b>${escape(int(bizSum))}</b></td>
        <td><b>${bizSum > 0 ? escape(wonFull(Math.round(salesSum / bizSum))) : "—"}</b></td>
    </tr>`;
    $("t-sd-yearly").innerHTML =
        `<table><thead><tr><th class="tl">월</th><th>총매출</th><th>전월비</th><th>홀</th>`
        + `<th>배달</th><th>아워홈 발주액</th><th>식자재율</th>`
        + `<th>영업일수</th><th>일평균</th></tr></thead>`
        + `<tbody>${body}${foot}</tbody></table>`;

    $("sd-year-note").textContent =
        "식자재율 = 아워홈 발주액 ÷ 총매출 — 아워홈 발주 기준(VAT 포함 · 본사물류 하한)이고, "
        + "매출 소급이 닿지 않은 달은 비거나 과대일 수 있습니다.";

    drawYearCharts(d);
}

// 그래프 2개 — 월간 매출 막대는 charts.js 의 drawBars 그대로, 홀/배달
// 스택만 여기서 조립합니다(drawBars 는 단일 시리즈 전용 — 색·눈금·툴팁은
// 같은 공통 것(palette·niceTicks·showTip)을 씁니다. drawMonthlyChannels 전례).
function drawYearCharts(d) {
    const rows = Array.isArray(d.yearly) ? d.yearly : [];
    const c = palette();

    drawBars($("c-sd-year"), {
        rows: rows.map((r) => ({ label: `${r.ym % 100}월`, value: Number(r.sales) || 0 })),
        color: c.s1, colors: c,
    });
    legend($("legend-sd-year"), []);

    drawStackedBars($("c-sd-year-ch"), c, rows.map((r) => ({
        label: `${r.ym % 100}월`,
        segments: [
            { name: "홀", value: Number(r.hall) || 0, color: c.s1 },
            { name: "배달", value: Number(r.delivery) || 0, color: c.s2 },
        ],
    })));
    legend($("legend-sd-year-ch"),
        [{ name: "홀", color: c.s1 }, { name: "배달", color: c.s2 }]);
}

function legend(el, series) {
    el.innerHTML = "";
    for (const s of series) {
        const span = document.createElement("span");
        span.innerHTML = `<i style="background:${s.color}"></i>${escape(s.name)}`;
        el.append(span);
    }
}

function drawStackedBars(svg, c, bars) {
    if (!svg) return;
    const width = svg.clientWidth || 720;
    const height = 240;
    const pad = { top: 18, right: 8, bottom: 28, left: 56 };
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;

    const totals = bars.map((b) => b.segments.reduce((a, s) => a + s.value, 0));
    const max = Math.max(1, ...totals);
    const ticks = niceTicks(max, 4);
    const top = ticks[ticks.length - 1];
    const y = (v) => pad.top + plotH - (plotH * v) / top;

    const slot = plotW / Math.max(1, bars.length);
    const barW = Math.min(24, Math.max(3, slot - 8));

    const parts = [];
    for (const t of ticks) {
        parts.push(
            `<line x1="${pad.left}" y1="${y(t)}" x2="${pad.left + plotW}" y2="${y(t)}"`
            + ` stroke="${c.grid}" stroke-width="1"/>`,
            `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11"`
            + ` fill="${c.muted}" style="font-variant-numeric:tabular-nums">${won(t)}</text>`
        );
    }

    bars.forEach((bar, i) => {
        const cx = pad.left + slot * i + slot / 2;
        let acc = 0;
        for (const seg of bar.segments) {
            if (seg.value <= 0) continue;
            const y1 = y(acc + seg.value);
            const h = Math.max(1, y(acc) - y1);
            parts.push(
                `<rect x="${cx - barW / 2}" y="${y1}" width="${barW}" height="${h}" rx="2"`
                + ` fill="${seg.color}" data-tip="${escape(bar.label)} ${escape(seg.name)}|${seg.value}"/>`
            );
            acc += seg.value;
        }
        parts.push(
            `<text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="11"`
            + ` fill="${c.muted}">${escape(bar.label)}</text>`
        );
    });

    parts.push(
        `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}"`
        + ` y2="${pad.top + plotH}" stroke="${c.base}" stroke-width="1"/>`
    );

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.innerHTML = parts.join("");
    svg.querySelectorAll("[data-tip]").forEach((mark) => {
        mark.addEventListener("mousemove", (event) => {
            const [label, value] = mark.dataset.tip.split("|");
            showTip(event, `<strong>${label}</strong><div>${wonFull(value)}</div>`);
        });
        mark.addEventListener("mouseleave", hideTip);
    });
}

// ---- ⓔ 분기별 매출 (2026-08-21 담당자 지시) ------------------------------
//
// 이 매장의 전체 기간(api_monthly, 매장 필터)을 분기로 접습니다 — 새 SQL 없음.
// 표기는 1분기~4분기(담당자 지시 — Q1 금지), 증감 색은 주간·월간과 같은
// 시트 관례(diffCell). 매장이 바뀔 때만 다시 받습니다(캐시).

let quarterCacheName = null;
let quarterRows = null;

async function renderQuarterly(storeName) {
    const box = $("t-sd-quarter");
    if (!storeName) { box.innerHTML = ""; return; }
    if (quarterCacheName !== storeName) {
        const range = S.filterRange || {};
        if (!range.max) return;
        $("sd-q-meta").textContent = "불러오는 중…";
        const { data, error } = await db.rpc("api_monthly", {
            p_ym_from: range.min, p_ym_to: range.max,
            p_store: storeName, p_channel: null,
        });
        if (error) {
            $("sd-q-meta").textContent = "";
            box.innerHTML = '<p class="hint">불러오지 못했습니다: '
                + escape(error.message) + "</p>";
            return;
        }
        quarterCacheName = storeName;
        quarterRows = data || [];
    }

    const sums = new Map();   // "2025|1" → { hall, delivery }
    for (const r of quarterRows) {
        const key = `${Math.floor(r.ym / 100)}|${Math.ceil((r.ym % 100) / 3)}`;
        const slot = sums.get(key) || { hall: 0, delivery: 0 };
        if (r.channel === "홀") slot.hall += Number(r.amount) || 0;
        else slot.delivery += Number(r.amount) || 0;
        sums.set(key, slot);
    }
    const list = [...sums.keys()]
        .sort((a, b) => {
            const [ya, qa] = a.split("|").map(Number);
            const [yb, qb] = b.split("|").map(Number);
            return ya - yb || qa - qb;
        })
        .map((k) => {
            const [y, q] = k.split("|").map(Number);
            const v = sums.get(k);
            return { label: `${y}년 ${q}분기`, total: v.hall + v.delivery, ...v };
        });
    list.forEach((r, i) => {
        const prev = i > 0 ? list[i - 1].total : 0;
        r.qoq = i > 0 && prev > 0
            ? Math.round((r.total - prev) / prev * 1000) / 10 : null;
    });

    $("sd-q-meta").textContent = list.length
        ? `전체 기간 · ${list[0].label} ~ ${list[list.length - 1].label} (마지막 분기는 진행 중일 수 있음)`
        : "";
    const body = [...list].reverse().map((r) => `<tr>
        <td class="tl">${escape(r.label)}</td>
        <td>${escape(wonFull(r.hall))}</td>
        <td>${escape(wonFull(r.delivery))}</td>
        <td>${escape(wonFull(r.total))}</td>
        <td>${diffCell(r.qoq)}</td>
    </tr>`).join("");
    box.innerHTML = list.length
        ? `<table><thead><tr><th class="tl">분기</th><th>홀</th><th>배달</th>`
          + `<th>합계</th><th>전분기비</th></tr></thead><tbody>${body}</tbody></table>`
        : '<p class="hint">데이터가 없습니다.</p>';
}

// ---- ⓕ 주간 13주 --------------------------------------------------------

// "n월 n주차" — 주 시작일(목요일)이 그 달에서 몇 번째 주인지(담당자 지시.
// 주 기준은 설정된 시작 요일, 기본 목~수).
const weekLabel = (iso) =>
    `${Number(iso.slice(5, 7))}월 ${Math.ceil(Number(iso.slice(8, 10)) / 7)}주차`;

function renderWeekly(d) {
    const weeks = Array.isArray(d.weekly) ? d.weekly : [];
    const dowStart = DOW_KO[d.week_start_dow] || "?";
    const dowEnd = DOW_KO[(((d.week_start_dow || 4) + 5) % 7) + 1] || "?";
    $("sd-wk-meta").textContent =
        `주: ${dowStart}~${dowEnd} · 기준일부터 최근 ${weeks.length}주`;

    const body = weeks.map((w) => `<tr>
        <td class="tl">${escape(weekLabel(w.week_start))}
            <span class="sd-range">(${escape(md(w.week_start))}~${escape(md(w.week_end))})</span></td>
        <td>${escape(wonFull(w.amount))}</td>
        <td>${diffCell(w.wow_pct)}</td>
        <td>${escape(int(w.orders))}</td>
    </tr>`).join("");
    $("t-sd-weekly").innerHTML = weeks.length
        ? `<table><thead><tr><th class="tl">주차</th><th>매출</th>`
          + `<th>전주비</th><th>주문수</th></tr></thead><tbody>${body}</tbody></table>`
        : '<p class="hint">아직 일 단위 집계가 없습니다.</p>';
}

// ---- ⓕ 일간 28일 --------------------------------------------------------

function renderDaily(d) {
    const days = Array.isArray(d.daily) ? d.daily : [];
    $("sd-daily-meta").textContent = days.length
        ? `${days[0].day} ~ ${days[days.length - 1].day} · 빈칸 = 미영업`
        : "";
    if (!days.length) {
        $("t-sd-daily").innerHTML = '<p class="hint">아직 일 단위 집계가 없습니다.</p>';
        return;
    }
    const head = days.map((x) => `<th>${escape(md(x.day))}</th>`).join("");
    const dows = days.map((x) =>
        `<td class="${x.dow >= 6 ? "sd-weekend" : ""}">${DOW_KO[x.dow] || ""}</td>`).join("");
    const amounts = days.map((x) =>
        `<td>${x.amount == null ? "" : escape(int(x.amount))}</td>`).join("");
    // 전일비 — 증감 색(시트 관례, 담당자 지시로 월간·주간·분기와 통일).
    // 미영업일(빈칸)이 끼면 그 칸과 다음 칸은 비교하지 않습니다.
    const diffs = days.map((x, i) => {
        const prev = i > 0 ? days[i - 1].amount : null;
        if (x.amount == null || prev == null || Number(prev) === 0) return "<td></td>";
        const pct = Math.round((Number(x.amount) - Number(prev)) / Number(prev) * 1000) / 10;
        return `<td>${diffCell(pct)}</td>`;
    }).join("");
    $("t-sd-daily").innerHTML =
        `<table><thead><tr><th class="tl">날짜</th>${head}</tr></thead><tbody>`
        + `<tr><td class="tl">요일</td>${dows}</tr>`
        + `<tr><td class="tl">매출</td>${amounts}</tr>`
        + `<tr><td class="tl">전일비</td>${diffs}</tr>`
        + `</tbody></table>`;
}

// ---- 배선 ---------------------------------------------------------------

export async function initStoreDash() {
    // 기준월 달력 — 데이터가 실존하는 범위(전역 필터와 같은 원천).
    const range = S.filterRange || {};
    monthPicker("sd-ym", { min: range.min, max: range.max });
    if (range.max) {
        // 기본값 = 마지막 완성 월(진행 중인 달이면 전월 — app.js H3 과 같은 규칙).
        const t = new Date();
        const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
        let ym = range.max;
        if (ym >= nowYm) {
            ym = ym % 100 === 1 ? ym - 89 : ym - 1;
            if (range.min && ym < range.min) ym = range.min;
        }
        $("sd-ym").value = String(ym);
    }

    // 매장 목록 — 폐점 매장 포함(stores 전체) + 폐점 배지.
    const select = $("sd-store");
    const [{ data: stores }, lifecycle] = await Promise.all([
        fetchStores(),
        db.rpc("api_store_lifecycle_status", { p_status: "close" }),
    ]);
    const closed = new Set(
        (Array.isArray(lifecycle.data) ? lifecycle.data : [])
            .map((r) => r.store_name));
    for (const s of stores || []) {
        const option = document.createElement("option");
        option.value = String(s.id);
        option.textContent = closed.has(s.name) ? `${s.name} (폐점)` : s.name;
        select.append(option);
    }
    searchify(select);

    for (const id of ["sd-store", "sd-ym", "sd-day", "sd-year"]) {
        $(id).addEventListener("change", () => {
            // 매장을 바꾸면 닻은 그 매장의 서버 기본값으로 다시 잡습니다.
            if (id === "sd-store") $("sd-day").value = "";
            // 기준일을 바꾸면 기준월·연도가 따라갑니다 — 연도 고르개는 그 해가
            // 목록에 있으면 맞추고, 없으면 비워 서버 기본(기준월의 해)으로.
            if (id === "sd-day" && $("sd-day").value) {
                const day = $("sd-day").value;
                $("sd-ym").value = day.slice(0, 7).replace("-", "");
                const y = day.slice(0, 4);
                const yearSel = $("sd-year");
                yearSel.value = [...yearSel.options].some((o) => o.value === y) ? y : "";
            }
            refresh();
        });
    }

    // 숨긴 채 그려진 차트는 fallback 폭으로 굳습니다(H2) — 서브탭이 보이게 된
    // 순간 폭이 어긋났으면 다시 그립니다(app.js 의 area-shown 처리와 같은 이유).
    document.addEventListener("mitaly:area-shown", (e) => {
        if (!last || !e.detail || e.detail.sub !== "매장 대시보드") return;
        const svg = $("c-sd-year");
        if (svg.clientWidth > 0
            && Math.abs(svg.clientWidth - svg.viewBox.baseVal.width) > 2) {
            drawYearCharts(last);
        }
    });

    refresh();   // 매장 미선택이면 '매장을 선택하세요' 안내가 자리를 잡습니다.
}
