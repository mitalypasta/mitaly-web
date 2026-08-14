// 숫자·라벨 표기 — 순수 함수만. DOM·db·화면 상태를 건드리지 않습니다.
//
// app.js 에서 뽑아낸 첫 조각입니다(docs/web-split-plan.md 1단계). 여기 있는
// 것은 값을 받아 문자열을 돌려주는 것뿐이라 어느 화면에서 불러도 같습니다.

export function won(value) {
    const v = Number(value) || 0;
    const sign = v < 0 ? "-" : "";
    const n = Math.abs(v);
    if (n >= 1e8) return `${sign}${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}억`;
    if (n >= 1e4) return `${sign}${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
    return `${sign}${n.toLocaleString("ko-KR")}`;
}

export const wonFull = (v) => `${(Number(v) || 0).toLocaleString("ko-KR")}원`;
export const int = (v) => (Number(v) || 0).toLocaleString("ko-KR");
export const ymLabel = (ym) => `${String(ym).slice(0, 4)}.${String(ym).slice(4, 6)}`;

// 분류 이름을 화면용으로 바꿉니다.
//
// DB 값은 매핑표(엑셀)에서 오므로 여기서 고칩니다 — DB 를 고쳐도 다음 업로드에
// 덮어써집니다. 이름만 바꾸는 것이고 분류 자체는 그대로입니다.
//
// 왜: '제외' 는 실제로 빼는 게 아니라 그냥 분류인데 이름이 오해를 줍니다.
// 그래서 화면마다 "빼는 기준이 아닙니다" 라는 변명을 달아야 했습니다.
// 이름이 나쁘니까 설명이 필요했던 것이고, 이름을 고치면 설명이 필요 없습니다.
// (품목을 실제로 분류해 넣는 일은 본사 원천 품목명 조정과 맞물려 진행합니다 — D5)
const CATEGORY_LABELS = {
    "⚠️미매핑": "신규 품목",
    "미매핑": "신규 품목",
    "제외": "음료·부가",
    "비정규": "메뉴판 외",
};

export function catLabel(value) {
    if (!value) return "미분류";
    return CATEGORY_LABELS[value] || value;
}

// 202601 → "2026-01". input[type=month] 와 파일명에 쓰는 하이픈 형식.
// (화면 표시용 ymLabel 은 '2026.01' 점 형식이라 별개입니다.)
export function ymDash(ymInt) {
    const s = String(ymInt);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}
