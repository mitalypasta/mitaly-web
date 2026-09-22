// 상권 진단 규칙 문장 — 122_store_diagnosis.sql(api_store_diagnosis) 응답만 입력.
// (명세 docs/trade-area-diagnosis-spec.md 6절 · 9/17 담당자 결정 반영)
//
// · AI 가 아니라 규칙으로 조립합니다. 문장마다 근거 숫자가 들어가고, 숫자 없는
//   형용사("좋다/나쁘다")는 쓰지 않습니다. 최대 7문장, 순서 고정.
// · 문턱은 코드에 없습니다 — 비율·추정 대비 경계는 응답의 rules(diag_rules 표),
//   상권 강/약은 그 달 중앙값(서버가 quad 로 이미 판정).
// · 🔺 상권 크기는 300m **전체 가게** 합계, 비교 기준은 전체 가게 **중앙값**입니다
//   (명세 원안의 '브랜드 중앙값' 에서 바뀜). 'pct' 만 사전 브랜드 기준이라
//   문장에 '브랜드' 라고 밝힙니다.
// · DOM·db 를 import 하지 않는 순수 모듈 — 시험이 바로 부릅니다.

const man = (won) => Math.round(Number(won) / 10000).toLocaleString("ko-KR");
const eok = (won) => (Number(won) / 1e8).toFixed(1);
const x2 = (v) => Number(v).toFixed(2);
const has = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

// 상위 몇 % — S_pct(그 달 판정 매장 중 이 매장보다 작은 곳의 비율)에서.
const topPct = (sPct) => Math.max(1, 100 - Number(sPct));

// 동네 신호 한 문장 — 진단 목록과 후보지 조회가 같이 씁니다.
// 동네 유형 — 서버 값(127 mitaly_area_signal: 직장형만·둘 다·둘 다 없음·주거형만)을
// 화면 이름으로. 2026-09-22 담당자 "'직장형만'? '둘 다'는 뭐고 '둘 다 없음'은 뭐야?" —
// 서버 값은 그대로 두고(시험·SQL·저장 값이 걸려 있음) 화면 이름·설명만 바꿉니다.
// 유형은 300m 안 '표지 브랜드' 유무로 갈립니다: 점심·직장형 표지(써브웨이·투썸·본도시락 등)가
// 있으면 '직장', 주거·배달형 표지(치킨 등)가 있으면 '주거'.
export const SIGNAL_LABEL = {
    "직장형만": "직장 동네",
    "주거형만": "주거 동네",
    "둘 다": "직장·주거 섞임",
    "둘 다 없음": "표지 없음",
};
export const SIGNAL_DESC = {
    "직장형만": "점심·직장형 표지 브랜드만 있음",
    "주거형만": "주거·배달형 표지 브랜드만 있음",
    "둘 다": "두 종류 표지가 다 있음",
    "둘 다 없음": "어느 쪽 표지도 없음",
};
export const signalLabel = (key) => SIGNAL_LABEL[key] || key || "";

// 무엇이 유형을 정했나 — "점심·직장형 표지 없음 · 주거·배달형 표지 굽네치킨"
export function signalWhy(s) {
    const work = Array.isArray(s && s.work_brands) ? s.work_brands : [];
    const home = Array.isArray(s && s.home_brands) ? s.home_brands : [];
    return `${work.length ? `점심·직장형 표지 ${work.join("·")}` : "점심·직장형 표지 없음"} · `
        + `${home.length ? `주거·배달형 표지 ${home.join("·")}` : "주거·배달형 표지 없음"}`;
}

// s: {signal, work_brands, home_brands} · d: {signal_groups} (api_store_diagnosis 최상위)
export function signalSentence(s, d) {
    if (!s || !s.signal) return "";
    const g = ((d && d.signal_groups) || []).find((x) => x.signal === s.signal);
    const tail = g && has(g.hall_med)
        ? ` 같은 유형 우리 매장 ${g.n}곳 홀매출 중앙 ${man(g.hall_med)}만 원(절반이 ${man(g.hall_q25)}~${man(g.hall_q75)}만 사이).`
        : "";
    return `동네 유형 '${signalLabel(s.signal)}' — 300m 안 ${signalWhy(s)}.${tail}`;
}

export function diagSentences(s, d) {
    const r = (d && d.rules) || {};
    // 7문장을 넘으면 덜 중요한 것부터 뺍니다(순서는 그대로) — 판정·주의·동네 신호는
    // 끝까지 남고, '생략' 안내 → 추정 대비 중립 문장 → 치킨 비중 순으로 빠집니다.
    const out = [];
    const keep = [];
    const add = (text, rank = 9) => { out.push(text); keep.push(rank); };

    if (!s || !Number(s.N)) {
        add("300m 안에 잡힌 가게가 없어 상권 판정을 하지 않습니다.");
        return out;
    }
    const hall = Number(s.hall) || 0;
    const nJudged = d && has(d.n_judged) ? d.n_judged : null;

    // 1 상권 크기
    add(`300m 안 가게 ${Number(s.N).toLocaleString("ko-KR")}곳, 홀 추정 합계 ${eok(s.S)}억`
        + (has(s.S_pct) && nJudged ? ` — 우리 ${nJudged}곳 중 상위 ${topPct(s.S_pct)}% 크기.` : "."));

    if (hall <= 0) {
        add(`홀매출 ${d && d.hall_ym ? String(d.hall_ym).slice(4) * 1 + "월 " : ""}기록이 없어 매장 위치 판정을 하지 않습니다.`);
        return out;
    }

    // 2 상대 위치
    if (has(s.ratio) && has(s.M)) {
        const ratio = Number(s.ratio);
        let band = "";
        if (has(r.ratio_hi) && ratio >= r.ratio_hi) band = "";
        else if (has(r.ratio_mid) && ratio >= r.ratio_mid) band = "(6할 이상)";
        else if (has(r.ratio_lo) && ratio >= r.ratio_lo) band = "(절반 안팎)";
        else if (has(r.ratio_lo)) band = "(4할 미만)";
        add(`미태리 ${man(hall)}만 원은 주변 가게 중앙값 ${man(s.M)}만 원의 ${x2(ratio)}배${band}`
            + (!has(s.pct) ? "." : Number(s.pct) >= 100 ? " — 주변 브랜드 전부보다 위."
                : Number(s.pct) > 0 ? ` — 주변 브랜드 ${s.pct}%보다 위.` : " — 주변 브랜드 전부보다 아래."));
    }

    // 3 판정 (4분면)
    const top = has(s.S_pct) ? topPct(s.S_pct) : null;
    const bottom = has(s.S_pct) ? Math.max(1, Number(s.S_pct)) : null;
    const rx = has(s.ratio) ? x2(s.ratio) : null;
    switch (s.quad) {
    case "상권강·매장약":
        add(`주변은 팔리는 상권(합계 상위 ${top}%)인데 미태리는 중앙값의 ${rx}배 — 상권이 아니라 매장을 볼 자리.`);
        break;
    case "상권약·매장약":
        add(`상권 합계도 하위 ${bottom}%, 미태리도 중앙값의 ${rx}배 — 입지 한계가 겹침. 이 상권 가게 중앙값 ${man(s.M)}만 원이 현실적 기준.`);
        break;
    case "상권강·매장강":
        add(`큰 상권(상위 ${top}%)에서 중앙값의 ${rx}배 — 지금 방식 유지.`);
        break;
    case "상권약·매장강":
        add(`작은 상권(하위 ${bottom}%)인데 중앙값의 ${rx}배 — 목적형 방문이나 운영 요인이 큼.`);
        break;
    default:
        break;
    }

    // 4 같은 잣대 (마이프차가 본 미태리)
    if (has(s.self_est) && Number(s.self_est) > 0 && has(s.ratio2)) {
        add(`마이프차 기준으로도 미태리 ${man(s.self_est)}만 원 = 주변 중앙값의 ${x2(s.ratio2)}배`
            + (!has(s.pct2) ? "." : Number(s.pct2) >= 100 ? "(주변 브랜드 전부보다 위)."
                : Number(s.pct2) > 0 ? `(브랜드 ${s.pct2}%보다 위).` : "(주변 브랜드 전부보다 아래)."));
    } else {
        add("마이프차 목록에 미태리 항목이 없어 같은 잣대 비교는 생략.", 1);
    }

    // 5 추정 대비 실적
    if (has(s.pos_ratio) && has(s.self_est)) {
        const pos = Number(s.pos_ratio);
        if (has(r.pos_ok) && pos >= r.pos_ok) {
            add(`실제 ${man(hall)}만 원은 마이프차 추정 ${man(s.self_est)}만 원과 같거나 그 이상(${x2(pos)}배).`);
        } else if (has(r.pos_warn) && pos < r.pos_warn) {
            add(`실제 ${man(hall)}만 원은 마이프차 추정 ${man(s.self_est)}만 원의 ${x2(pos)}배 — 하락 또는 이상 신호.`);
        } else {
            add(`실제는 마이프차 추정의 ${x2(pos)}배.`, 2);
        }
    }

    // 6 동네 신호 (127 — 점심·직장형 / 주거·배달형 브랜드 유무와 같은 조합 우리 매장 분포)
    const signalLine = signalSentence(s, d);
    if (signalLine) add(signalLine, 8);
    if (has(s.chicken_share) && has(r.chicken_share) && Number(s.chicken_share) >= r.chicken_share) {
        add(`치킨 브랜드가 주변 브랜드 매출의 ${Math.round(Number(s.chicken_share) * 100)}% — 배달·주거형 상권.`, 3);
    }

    // 7 주의
    if (has(s.days) && has(r.days_short) && Number(s.days) < r.days_short) {
        add(`이 달 홀 매출 기록 ${s.days}일 — 월 합계가 낮게 잡힘.`
            + (has(s.daily) ? ` 일평균 ${man(s.daily)}만 원 기준으로 볼 것.` : ""));
    }
    if (has(s.mom_pct) && has(r.mom_pct) && Math.abs(Number(s.mom_pct)) >= r.mom_pct) {
        const v = Number(s.mom_pct);
        add(`전월 대비 ${v > 0 ? "+" : ""}${v}% — ${v > 0 ? "급증" : "급감"} 기준(±${r.mom_pct}%) 넘음.`);
    }

    while (out.length > 7) {
        const min = Math.min(...keep);
        const i = keep.lastIndexOf(min);
        out.splice(i, 1);
        keep.splice(i, 1);
    }
    return out;
}
