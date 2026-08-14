// 순수 헬퍼 — HTML 이스케이프·문자열 자르기·디바운스·눈금 계산.
//
// app.js 에서 뽑아낸 첫 조각입니다(docs/web-split-plan.md 1단계). 전부 값만
// 받아 값을 돌려줍니다 — DOM 요소나 db, 화면 상태를 닫아 넣지 않습니다.

export function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g,
        (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export const clip = (text, n) =>
    String(text).length > n ? String(text).slice(0, n - 1) + "…" : String(text);

export function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export function niceTicks(max, count) {
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const out = [];
    for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
}

// 연월 정수(YYYYMM) min~max 사이의 모든 달. 대시보드·정산이 씁니다.
export function monthsBetween(min, max) {
    const out = [];
    let year = Math.floor(min / 100);
    let month = min % 100;
    while (year * 100 + month <= max) {
        out.push(year * 100 + month);
        month += 1;
        if (month > 12) { month = 1; year += 1; }
    }
    return out;
}
