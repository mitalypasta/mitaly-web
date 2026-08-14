// 월간 보고서 (매출 하위 화면) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). draw(app.js)가 마지막 조회 결과를 인자로 넘깁니다.

import { wonFull, int, catLabel, ymDash } from "./format.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";

// ---- 월간 보고서 --------------------------------------------------------
//
// 본사가 형식을 PDF, 받는 사람을 SV 로 확정했습니다(hq-standards.md 2번).
// SV 가 받아 점주에게 전달하거나 상부 보고에 씁니다.
//
// 화면에 이미 있는 S.lastData 만 씁니다 — 보고서 때문에 조회를 또 하지 않습니다.
// 급증·급감 기준은 본사 값(±10%)이고 설정 테이블에 있습니다. 여기서 다시
// 판정하지 않고 api_sales_alerts 가 준 판정을 그대로 씁니다.

export function drawReport(d) {
    const sheet = $("report-sheet");
    if (!sheet || !d) return;

    const s = d.summary || {};
    const stores = d.args && d.args.p_store ? d.args.p_store : "전체 매장";
    const span = `${ymDash(d.args.p_ym_from)} ~ ${ymDash(d.args.p_ym_to)}`;

    // ⚠️ api_summary 에는 홀·배달·객단가가 없습니다(amount·qty·store_count·menu_count 뿐).
    //    api_monthly 는 **채널별로 한 줄**입니다(ym·channel·amount·qty).
    //    없는 열을 읽어 0 이 찍히고 월이 두 줄씩 나오던 것을 고쳤습니다(2026-07-30).
    //    화면 카드들과 같은 원본을 쓰되, 여기서 연월로 접습니다.
    const byMonth = new Map();
    for (const r of d.monthly || []) {
        const m = byMonth.get(r.ym)
            || { ym: r.ym, amount: 0, qty: 0, hall: 0, delivery: 0 };
        m.amount += Number(r.amount) || 0;
        m.qty += Number(r.qty) || 0;
        if (r.channel === "홀") m.hall += Number(r.amount) || 0;
        else m.delivery += Number(r.amount) || 0;
        byMonth.set(r.ym, m);
    }
    const months = [...byMonth.values()].sort((a, b) => a.ym - b.ym);
    const hall = months.reduce((a, m) => a + m.hall, 0);
    const delivery = months.reduce((a, m) => a + m.delivery, 0);
    const qty = Number(s.qty) || 0;
    const avgTicket = qty ? Math.round((Number(s.amount) || 0) / qty) : 0;

    // 판정이 붙은 채널만 싣습니다. 전부 실으면 SV 가 읽지 않습니다.
    const alertRows = (d.alerts || []).flatMap((a) =>
        (a.channels || [])
            .filter((c) => c.mom_direction || c.yoy_direction)
            .map((c) => ({ store: a.store, ...c })));

    const top = (d.menus || []).slice(0, 10);

    sheet.innerHTML = `
      <div class="report">
        <div class="report-head">
          <h1>미태리 매출 보고</h1>
          <div class="report-meta">
            <div>기간 <b>${escape(span)}</b></div>
            <div>대상 <b>${escape(stores)}</b></div>
            <div>작성 ${escape(new Date().toLocaleString("ko-KR",
                  { dateStyle: "long", timeStyle: "short" }))}</div>
          </div>
        </div>

        <h2>1. 요약</h2>
        <table class="report-kpi"><tbody>
          <tr><th>총매출</th><td>${wonFull(s.amount)}</td>
              <th>총수량</th><td>${int(qty)}</td></tr>
          <tr><th>홀</th><td>${wonFull(hall)}</td>
              <th>배달</th><td>${wonFull(delivery)}</td></tr>
          <tr><th>객단가</th><td>${wonFull(avgTicket)}</td>
              <th>매장 수</th><td>${int(s.store_count)}곳</td></tr>
        </tbody></table>

        <h2>2. 급증·급감 매장 <span class="report-sub">${escape(ymDash(d.args.p_ym_to))} 기준</span></h2>
        ${alertRows.length ? `<table class="report-table"><thead><tr>
            <th>매장</th><th>채널</th><th>매출</th><th>전월 대비</th><th>전년 대비</th>
          </tr></thead><tbody>${alertRows.map((c) => `<tr>
                <td>${escape(c.store)}</td><td>${escape(c.channel)}</td>
                <td>${wonFull(c.amount)}</td>
                <td>${escape(c.mom_direction || "—")} ${pct(c.mom_pct_change)}</td>
                <td>${escape(c.yoy_direction || "—")} ${pct(c.yoy_pct_change)}</td>
              </tr>`).join("")}</tbody></table>`
          : "<p>기준(±10%)을 넘은 매장이 없습니다.</p>"}
        <p class="report-note">
          기간의 마지막 달 실적을 전월·전년 동월과 비교합니다.
          그 달에 매출이 없는 매장은 비교 대상이 아닙니다.
        </p>

        <h2>3. 월별 추이</h2>
        ${months.length ? `<table class="report-table"><thead><tr>
            <th>연월</th><th>총매출</th><th>홀</th><th>배달</th><th>수량</th>
          </tr></thead><tbody>${months.map((m) => `<tr>
            <td>${escape(ymDash(m.ym))}</td><td>${wonFull(m.amount)}</td>
            <td>${wonFull(m.hall)}</td><td>${wonFull(m.delivery)}</td>
            <td>${int(m.qty)}</td></tr>`).join("")}</tbody></table>`
          : "<p>자료가 없습니다.</p>"}

        <h2>4. 상위 품목 10</h2>
        ${top.length ? `<table class="report-table"><thead><tr>
            <th>품목</th><th>분류</th><th>매출</th><th>수량</th>
          </tr></thead><tbody>${top.map((m) => `<tr>
            <td>${escape(m.menu)}</td><td>${escape(catLabel(m.category))}</td>
            <td>${wonFull(m.amount)}</td><td>${int(m.qty)}</td></tr>`).join("")}
          </tbody></table>` : "<p>자료가 없습니다.</p>"}

        <p class="report-foot">
          배달은 할인 전, 홀은 할인 후 금액입니다. 급증·급감 기준 ±10%.
        </p>
      </div>`;
}

// 비율은 소수 한 자리로 통일합니다. 없으면 줄표.
function pct(rate) {
    if (rate === null || rate === undefined) return "—";
    const n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function initReport() {
    const button = $("report-print");
    if (button) button.addEventListener("click", () => window.print());
}
