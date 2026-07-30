// 데모 모드 — Supabase 없이 화면만 확인할 때 씁니다.
//
//     index.html?demo=1
//
// 여기 나오는 숫자와 매장명은 전부 가짜입니다. 실제 매출이 아닙니다.
// 화면 배치와 차트가 제대로 그려지는지 확인하는 용도입니다.

const AREAS = ["오피스", "주거", "대학가", "역세권", "복합몰"];
const MENUS = [
    ["로제 파스타", "파스타"], ["까르보나라", "파스타"], ["알리오 올리오", "파스타"],
    ["감바스 파스타", "파스타"], ["봉골레 파스타", "파스타"], ["토마토 파스타", "파스타"],
    ["마르게리따 피자", "피자"], ["페퍼로니 피자", "피자"], ["고르곤졸라 피자", "피자"],
    ["오븐 스파게티", "파스타"], ["크림 뇨끼", "기타"], ["씨저 샐러드", "사이드"],
    ["갈릭 브레드", "사이드"], ["감자튀김", "사이드"], ["치즈스틱", "사이드"],
    ["미트볼", "사이드"], ["수프", "사이드"], ["티라미수", "디저트"],
    // 화면 라벨이 바꿔 보이는지 데모로도 확인할 수 있게 실제 분류 값을 넣습니다
    // (CATEGORY_LABELS: ⚠️미매핑→신규 품목 · 제외→음료·부가 · 비정규→메뉴판 외).
    // DB 에 실제로 들어 있는 값이라 표기를 바꾸면 안 됩니다.
    ["신메뉴테스트A", "⚠️미매핑"], ["레몬에이드", "제외"],
    ["치즈 뽀모도로 파스타", "비정규"],
];

// 리뷰 데모. 실제 응답과 같은 필드 이름을 씁니다.
// 낮은 별점·재주문·기존 답글이 화면에서 어떻게 보이는지 확인하려고 섞어 뒀습니다.
const DEMO_REVIEWS = [
    { id: 1, platform: "배민", store: "샘플01점", rating: 5,
      contents: "면이 알덴테로 딱 좋았어요. 감바스도 마늘향이 진하고 좋습니다!",
      author_name: "샘플닉네임1", written_at: "2026-07-24T12:10:00+09:00",
      order_count: 7, menus: [{ name: "감바스 파스타" }, { name: "갈릭 브레드" }],
      images: [], delivery_review: { recommendation: "GOOD", contents: [] },
      can_reply: true, can_report: true, replies: [],
      drafts: [{ id: 101, variant: 1, status: "draft",
                 contents: "벌써 일곱 번째 주문이시네요. 감바스의 마늘향까지 좋게 봐주셔서"
                     + " 감사합니다. 다음에도 면 삶는 시간 그대로 지켜서 보내드리겠습니다.",
                 scheduled_at: null }] },
    { id: 2, platform: "배민", store: "샘플01점", rating: 2,
      contents: "면이 너무 불어서 왔어요. 배달이 40분 넘게 걸렸습니다.",
      author_name: "샘플닉네임2", written_at: "2026-07-23T19:42:00+09:00",
      order_count: 1, menus: [{ name: "로제 파스타" }],
      images: [], delivery_review: { recommendation: "BAD", contents: [] },
      can_reply: true, can_report: true, replies: [],
      drafts: [{ id: 102, variant: 1, status: "draft",
                 contents: "기다리시게 하고 면까지 불어 도착해 죄송합니다. 배달이 40분 넘게"
                     + " 걸린 경위를 오늘 확인하고, 조리 순서를 다시 잡겠습니다.",
                 scheduled_at: null }] },
    { id: 3, platform: "쿠팡이츠", store: "샘플02점", rating: 5,
      contents: "재주문입니다. 항상 맛있어요.",
      author_name: "샘플닉네임3", written_at: "2026-07-22T13:05:00+09:00",
      order_count: 12, menus: [{ name: "까르보나라" }],
      images: [], delivery_review: null, can_reply: true, can_report: true,
      replies: [{ id: 1, contents: "늘 찾아주셔서 감사합니다! 다음에도 정성껏 준비하겠습니다.",
                  written_at: "2026-07-22T17:00:00+09:00", is_ours: false }],
      drafts: [] },
    { id: 4, platform: "요기요", store: "샘플03점", rating: 3,
      contents: "맛은 괜찮은데 양이 적어요.",
      author_name: "샘플닉네임4", written_at: "2026-07-21T20:15:00+09:00",
      order_count: 2, menus: [{ name: "토마토 파스타" }, { name: "씨저 샐러드" }],
      images: [], delivery_review: null, can_reply: true, can_report: true,
      replies: [],
      drafts: [{ id: 103, variant: 1, status: "approved",
                 contents: "맛있게 드셨다니 감사합니다. 다만 양이 아쉬우셨다니 죄송합니다."
                     + " 토마토 파스타 기본량을 다시 재보겠습니다.",
                 scheduled_at: null }] },
    { id: 5, platform: "배민", store: "샘플02점", rating: 5,
      contents: "피자 도우가 쫄깃하고 좋아요. 사진 첨부합니다.",
      author_name: "샘플닉네임5", written_at: "2026-07-20T18:30:00+09:00",
      order_count: 3, menus: [{ name: "마르게리따 피자" }],
      images: ["demo1.jpg"], delivery_review: { recommendation: "GOOD", contents: [] },
      can_reply: true, can_report: true, replies: [], drafts: [] },
];

// 실행할 때마다 숫자가 바뀌면 헷갈리므로 고정 난수를 씁니다.
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const rand = seeded(20260722);

const STORES = Array.from({ length: 94 }, (_, i) => ({
    id: i + 1,   // stores.id(smallint) 데모용 — 위반 기록 폼의 store_id 에 씁니다
    name: `샘플${String(i + 1).padStart(2, "0")}점`,
    trade_area: AREAS[i % AREAS.length],
    weight: 0.45 + rand() * 1.1,
}));

const MONTHS = (() => {
    const out = [];
    let year = 2025, month = 1;
    for (let i = 0; i < 19; i++) {
        out.push(year * 100 + month);
        month += 1;
        if (month > 12) { month = 1; year += 1; }
    }
    return out;
})();

// 시간대 곡선 — 점심(12시)과 저녁(18~19시)에 봉우리가 두 개.
const HOUR_SHAPE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.35, 0.9,
    1.0, 0.75, 0.35, 0.28, 0.35, 0.7, 0.95, 0.85, 0.5, 0.25, 0.08, 0.01];
const WEEKDAY_SHAPE = { "월": 0.78, "화": 0.80, "수": 0.85, "목": 0.90, "금": 1.0, "토": 1.05, "일": 0.95 };

function inRange(ym, from, to) { return ym >= from && ym <= to; }

function monthFactor(ym, index) {
    return 0.86 + 0.28 * (index / MONTHS.length) + (rand() - 0.5) * 0.05;
}

function baseRows({ p_ym_from, p_ym_to, p_store, p_channel }) {
    const rows = [];
    MONTHS.forEach((ym, mi) => {
        if (!inRange(ym, p_ym_from, p_ym_to)) return;
        const factor = monthFactor(ym, mi);
        for (const store of STORES) {
            if (p_store && store.name !== p_store) continue;
            for (const channel of ["홀", "배달"]) {
                if (p_channel && channel !== p_channel) continue;
                const share = channel === "홀" ? 0.66 : 0.34;
                const amount = Math.round(38_000_000 * store.weight * factor * share / 30);
                rows.push({ ym, channel, store, amount, qty: Math.round(amount / 13_500) });
            }
        }
    });
    return rows;
}

// ---- 급증·급감 · 기간 대비 데모 전용 -----------------------------------
//
// monthFactor()는 호출될 때마다 공유 rand() 를 한 칸씩 소비하는 난수라, 같은
// 달을 당월·전월·전년동월로 여러 번 물어보면 그때그때 값이 달라집니다(호출
// 순서에 의존). 급증·급감은 같은 매장·같은 달을 여러 번 다시 계산해야 하므로,
// (매장, 채널, 달)로만 결정되는 순수 함수를 따로 둬서 몇 번을 불러도 같은
// 조합은 항상 같은 금액이 나오게 합니다.
//
// ⚠️ 매장 흔들림을 매장별로 다르게 줘야 합니다. weight·share는 같은 매장의
// cur/prev 비율 계산에서 분자·분모로 상쇄되므로, 매장별 잡음이 없으면 전
// 매장의 증감률이 완전히 똑같아져 '전부 같이 뜨거나 다 같이 안 뜨는' 뻔한
// 화면이 됩니다(2026-07-29 로컬 렌더 확인에서 실제로 94/94가 한 번에
// 급증으로 뜨는 것을 보고 고침). 매장 이름을 시드에 섞어 매장마다 다르게
// 흔들리게 합니다.
function hashSeed(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return h >>> 0;
}

// 데모 화면에서 급증·급감 배지가 실제로 보이도록 일부러 튀게 만든 매장
// 두 곳(2026-07 기준). 가짜 데이터입니다 — 실제 매출과 무관합니다.
const DEMO_ALERT_BUMPS = {
    "샘플03점|202607": 1.42,   // 급증 시연
    "샘플07점|202607": 0.58,   // 급감 시연
};

// mitaly_shift_ym(18_alerts.sql)과 같은 규칙 — YYYYMM 정수를 개월 수만큼 밉니다.
function shiftYm(ym, months) {
    const y = Math.floor(ym / 100), m = ym % 100;
    const total = y * 12 + (m - 1) + months;
    return Math.floor(total / 12) * 100 + (((total % 12) + 12) % 12) + 1;
}

// 이전 값이 0(또는 데이터 범위 밖)이면 퍼센트가 정의되지 않으므로 null —
// 18_alerts.sql·19_compare.sql과 같은 규칙입니다.
function pctChange(cur, prev) {
    if (prev == null || prev <= 0) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
}

const DEMO_ALERT_THRESHOLD = 10;   // hq-standards.md 기본값의 데모용 미러(실제 값은 alert_settings 테이블)

function alertDirection(pct) {
    if (pct == null) return null;
    if (pct >= DEMO_ALERT_THRESHOLD) return "급증";
    if (pct <= -DEMO_ALERT_THRESHOLD) return "급감";
    return "정상";
}

// 매장×채널×월 하나의 매출액. 데이터 범위(MONTHS) 밖이면 null(비교 대상 없음).
function demoAmountAt(ym, store, channel) {
    const mi = MONTHS.indexOf(ym);
    if (mi === -1) return null;
    const trend = 0.95 + 0.10 * (mi / MONTHS.length);      // 완만한 전사 성장(연 성장률 한 자릿수)
    const noise = seeded(hashSeed(`${store.name}|${channel}|${ym}`))();
    const factor = trend * (1 + (noise - 0.5) * 0.08);     // 매장별 ±4% 흔들림 — 대부분 임계값(±10%) 안쪽
    const share = channel === "홀" ? 0.66 : 0.34;
    let amount = Math.round(38_000_000 * store.weight * factor * share / 30);
    const bump = DEMO_ALERT_BUMPS[`${store.name}|${ym}`];
    if (bump) amount = Math.round(amount * bump);
    return amount;
}

// 매장 하나의 채널별(홀/배달) 대비 내역. api_sales_alerts·api_sales_compare가
// 공유하는 모양이라 한 곳에서 만듭니다.
function demoStoreCompareRows(ym, store) {
    return ["홀", "배달"].map((channel) => {
        const amount = demoAmountAt(ym, store, channel) || 0;
        const prevMom = demoAmountAt(shiftYm(ym, -1), store, channel);
        const prevYoy = demoAmountAt(shiftYm(ym, -12), store, channel);
        return {
            channel, amount,
            prev_mom_amount: prevMom,
            mom_pct_change: pctChange(amount, prevMom),
            prev_yoy_amount: prevYoy,
            yoy_pct_change: pctChange(amount, prevYoy),
        };
    });
}

function sumOrNull(values) {
    const vals = values.filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function group(rows, keyFn) {
    const map = new Map();
    for (const row of rows) {
        const key = keyFn(row);
        const found = map.get(key) || { amount: 0, qty: 0 };
        found.amount += row.amount;
        found.qty += row.qty;
        map.set(key, found);
    }
    return map;
}

// 메뉴 × 구간 행렬을 만듭니다. 구간마다 쏠림을 다르게 줘서
// 히트맵이 단조롭지 않고 실제 데이터처럼 보이게 합니다.
function menuMatrix(args, field, buckets) {
    // 실제 api_menu_matrix 와 같은 모양으로 돌려줍니다.
    //   { menu, category, total, buckets: {구간: 금액} }
    const total = HANDLERS.api_summary(args)[0].amount;
    return MENUS.map(([menu, category], mi) => {
        const share = 1 / (mi + 1.6);
        const values = {};
        let sum = 0;
        buckets.forEach((bucket, bi) => {
            // 구간마다 쏠림을 다르게 줘서 히트맵이 단조롭지 않게 만듭니다.
            const skew = 0.6 + 0.8 * Math.abs(Math.sin((mi + 1) * (bi + 1)));
            const amount = Math.round((total * share * skew) / (buckets.length * 12));
            values[bucket] = amount;
            sum += amount;
        });
        return { menu, category, total: sum, buckets: values };
    }).sort((a, b) => b.total - a.total);
}

// 내보내기용: 여러 매장(p_stores 배열)을 받는 행 생성. 비었으면 전 매장.
function exportRows({ p_ym_from, p_ym_to, p_stores }) {
    const wanted = p_stores && p_stores.length ? new Set(p_stores) : null;
    const rows = [];
    MONTHS.forEach((ym, mi) => {
        if (!inRange(ym, p_ym_from, p_ym_to)) return;
        const factor = monthFactor(ym, mi);
        for (const store of STORES) {
            if (wanted && !wanted.has(store.name)) continue;
            for (const channel of ["홀", "배달"]) {
                const share = channel === "홀" ? 0.66 : 0.34;
                const amount = Math.round(38_000_000 * store.weight * factor * share / 30);
                rows.push({ ym, channel, store, amount, qty: Math.round(amount / 13_500) });
            }
        }
    });
    return rows;
}

// ---- 데모용 초안 조작 ---------------------------------------------------
// 실제 SQL 함수와 같은 규칙을 따릅니다: draft/approved 에서만 상태가 바뀌고,
// 이미 올라간(posted) 것은 건드리지 않습니다.

function demoFindDraft(id) {
    for (const review of DEMO_REVIEWS) {
        const hit = (review.drafts || []).find((d) => d.id === Number(id));
        if (hit) return hit;
    }
    return null;
}

function demoDraftMove(id, next) {
    const draft = demoFindDraft(id);
    if (!draft) return { ok: false, reason: "초안을 찾지 못했습니다" };
    const allowed = next === "approved" ? ["draft"] : ["draft", "approved"];
    if (!allowed.includes(draft.status)) {
        return { ok: false, reason: `상태가 ${draft.status} 여서 바꿀 수 없습니다` };
    }
    draft.status = next;
    return { ok: true, status: next };
}

// ---- 위반 기록 · 내용증명 단계 데모 (22_notices.sql·23_notice_determination.sql) ---
//
// 내용증명 발송 기준표 10행을 그대로 옮깁니다 — api_notice_stage_rules() 와
// 같은 모양(jsonb 한 줄, seq/violation_type/stage1~3{kind,value,value_max,label}/
// requires_legal_review/enabled/note).
const NOTICE_RULES = [
    { seq: 1, violation_type: "로열티 미납", enabled: true,
      stage1: { kind: "day_offset", value: 3, value_max: null, label: "D+3" },
      stage2: { kind: "day_offset", value: 5, value_max: null, label: "D+5" },
      stage3: { kind: "day_offset", value: 10, value_max: null, label: "D+10" },
      requires_legal_review: false,
      note: "계약 제16조(익월 1일 CMS 자동이체) 미이행 기준. 지연이자는 연 20%(제39조), 이 표와 별개 값" },
    { seq: 2, violation_type: "자점매입", enabled: true,
      stage1: { kind: "day_offset", value: 3, value_max: null, label: "D+3" },
      stage2: { kind: "day_offset", value: 5, value_max: null, label: "D+5" },
      stage3: { kind: "day_offset", value: 10, value_max: null, label: "D+10" },
      requires_legal_review: false,
      note: "⚠️ 로고 없는 시중 범용품(물티슈·멸균우유 등)은 제재 대상 아님 — hq-standards.md 예외 3" },
    { seq: 3, violation_type: "식품안전·위생 중대", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage3: { kind: "immediate", value: null, value_max: null, label: "즉시 검토" },
      requires_legal_review: true,
      note: "3단계가 '즉시 발송'이 아니라 '즉시 검토' — 법무 검토를 거쳐야 함" },
    { seq: 4, violation_type: "무단 휴업", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "당일" },
      stage2: { kind: "duration_days", value: 2, value_max: 3, label: "2~3일 지속" },
      stage3: { kind: "duration_days", value: 4, value_max: 6, label: "4~6일 지속" },
      requires_legal_review: false,
      note: "지속 일수 기준. '연속 7일 이상 중단'(다음 행)과는 별개 규칙" },
    { seq: 5, violation_type: "연속 7일 이상 중단", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage3: { kind: "immediate", value: null, value_max: null, label: "즉시 (법무 검토)" },
      requires_legal_review: true,
      note: "제33조 제4항 제6호 해지 사유 — 계약 해지 검토 대상" },
    { seq: 6, violation_type: "레시피·품질 위반", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "repeat_count", value: 2, value_max: null, label: "2회 반복" },
      stage3: { kind: "repeat_count", value: 3, value_max: null, label: "3회 반복" },
      requires_legal_review: false, note: "누적 반복 횟수 기준(기간 제한 없음)" },
    { seq: 7, violation_type: "승인 없는 메뉴·판촉·가격변경", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage3: { kind: "day_offset", value: 10, value_max: null, label: "D+10" },
      requires_legal_review: false, note: null },
    { seq: 8, violation_type: "회계·POS 자료 미제공", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "day_offset", value: 7, value_max: null, label: "D+7" },
      stage3: { kind: "day_offset", value: 14, value_max: null, label: "D+14" },
      requires_legal_review: false, note: null },
    { seq: 9, violation_type: "본부 점검 거부", enabled: true,
      stage1: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage2: { kind: "immediate", value: null, value_max: null, label: "즉시" },
      stage3: { kind: "repeat_count", value: 2, value_max: null, label: "2회 이상 거부" },
      requires_legal_review: false, note: null },
    { seq: 10, violation_type: "시정요구 불이행", enabled: true,
      stage1: { kind: "sequential", value: 1, value_max: null, label: "1차 지적" },
      stage2: { kind: "sequential", value: 2, value_max: null, label: "2차 지적" },
      stage3: { kind: "sequential", value: 3, value_max: null, label: "3차 지적" },
      requires_legal_review: false,
      note: "⚠️ '3개월 3회 이상 → 운영권 제한'(확정 숫자 표)과는 다른 규칙 — 이건 내용증명 발송 단계" },
];

function dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// 데모 위반 발생 기록. 폼에서 추가한 것도 여기 쌓입니다(새로고침하면 사라짐).
// 처음부터 3단계(내용증명)·법무 검토·담당자 확인(무단 휴업 특약·자점매입
// 미확인) 케이스가 전부 보이도록 픽스처를 골랐습니다.
let violationEvents = [
    { id: 1, store: "샘플05점", violation_type: "로열티 미납",
      occurred_on: dateOffset(-12), resolved_on: null,
      sequence_no: null, applies_logo_required_item: null, note: "7월분 CMS 이체 실패" },
    { id: 2, store: "샘플11점", violation_type: "무단 휴업",
      occurred_on: dateOffset(-5), resolved_on: null,
      sequence_no: null, applies_logo_required_item: null, note: null },
    { id: 3, store: "샘플02점", violation_type: "자점매입",
      occurred_on: dateOffset(-11), resolved_on: null,
      sequence_no: null, applies_logo_required_item: null, note: "매입 영수증 확인 중" },
    { id: 4, store: "샘플07점", violation_type: "시정요구 불이행",
      occurred_on: dateOffset(-30), resolved_on: null,
      sequence_no: 3, applies_logo_required_item: null, note: "3차 지적 — 위생 상태 반복" },
    // 종료 처리 되돌리기(26_violation_reopen.sql, 큐 #14) 검증용 — 이미
    // 종료 처리된 건이 하나 있어야 '최근 종료된 위반' 표와 '다시 열기'를 볼 수 있습니다.
    { id: 5, store: "샘플09점", violation_type: "회계·POS 자료 미제공",
      occurred_on: dateOffset(-25), resolved_on: dateOffset(-3),
      sequence_no: null, applies_logo_required_item: null, note: "자료 제출 확인, 종료" },
];
let nextViolationId = 6;

function noticeStageKindReached(kind, value, daysElapsed, durationDays, totalOccurrences, occurrenceSeq) {
    switch (kind) {
        case "immediate": return true;
        case "day_offset": return value != null && daysElapsed >= value;
        case "duration_days": return value != null && durationDays >= value;
        case "repeat_count": return value != null && totalOccurrences >= value;
        case "sequential": return value != null && occurrenceSeq >= value;
        default: return false;
    }
}

// api_notice_stage_status(23_notice_determination.sql)와 같은 계산 —
// kind 5갈래 분기 + 예외 3가지(①무단 휴업 담당자 확인 ②구조로 막힘이라
// 데모에도 해당 위반유형 자체가 없음 ③자점매입 로고 품목 여부).
function computeNoticeStatus(pStore) {
    const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
    const today = dateOffset(0);

    const bucket = new Map();
    for (const ev of violationEvents) {
        const key = ev.store + " " + ev.violation_type;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(ev);
    }

    const open = violationEvents.filter((ev) =>
        !ev.resolved_on && (!pStore || ev.store === pStore));

    const result = open.map((ev) => {
        const rule = NOTICE_RULES.find((r) => r.violation_type === ev.violation_type && r.enabled);
        if (!rule) return null;

        const key = ev.store + " " + ev.violation_type;
        const siblings = [...bucket.get(key)].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
        const totalOccurrences = siblings.length;
        const occurrenceSeq = ev.sequence_no ?? (siblings.findIndex((s) => s.id === ev.id) + 1);
        const daysElapsed = daysBetween(ev.occurred_on, today);
        const durationDays = daysBetween(ev.occurred_on, ev.resolved_on || today);

        let rawStage = 0;
        [rule.stage1, rule.stage2, rule.stage3].forEach((s, i) => {
            if (noticeStageKindReached(s.kind, s.value, daysElapsed, durationDays, totalOccurrences, occurrenceSeq)) {
                rawStage = Math.max(rawStage, i + 1);
            }
        });

        const isLogoExempt = ev.violation_type === "자점매입" && ev.applies_logo_required_item === false;
        const stage = isLogoExempt ? 0 : rawStage;
        const stageLabel = isLogoExempt ? null
            : stage === 1 ? rule.stage1.label
            : stage === 2 ? rule.stage2.label
            : stage === 3 ? rule.stage3.label
            : null;

        // 예외 ①: 영업시간 특약 데이터가 없어 '무단 휴업'은 항상 담당자 확인
        const manualNote = ev.violation_type === "무단 휴업"
            ? "hq-standards.md 예외 1: 영업시간 특약이 걸린 매장 데이터가 프로젝트에 없어 " +
              "이 위반유형은 자동판정을 금지합니다. 항상 담당자 확인이 필요합니다."
            : null;
        // 예외 ③: 자점매입 로고 품목 여부 미확인
        const needsLogoCheck = ev.violation_type === "자점매입" && ev.applies_logo_required_item == null;

        return {
            event_id: ev.id, store_id: null, store_name: ev.store,
            violation_type: ev.violation_type, occurred_on: ev.occurred_on,
            days_elapsed: daysElapsed, duration_days: durationDays,
            total_occurrences: totalOccurrences, stage, stage_label: stageLabel,
            requires_legal_review: stage === 3 && !!rule.requires_legal_review,
            needs_manual_review: !!manualNote || needsLogoCheck,
            manual_review_reason: manualNote ||
                (needsLogoCheck
                    ? "hq-standards.md 예외 3: 이 품목이 레시피 직결/로고 포장재 품목인지 확인되지 않았습니다."
                    : null),
            note: ev.note || null,
        };
    }).filter(Boolean);

    result.sort((a, b) => (b.stage - a.stage) || a.occurred_on.localeCompare(b.occurred_on));
    return result;
}

// api_violation_events_resolved(26_violation_reopen.sql) — 종료된 건만,
// 종료일 최신순, 최근 p_limit 건.
function computeResolvedViolations(pStore, pLimit) {
    return violationEvents
        .filter((ev) => ev.resolved_on && (!pStore || ev.store === pStore))
        .sort((a, b) => b.resolved_on.localeCompare(a.resolved_on) || (b.id - a.id))
        .slice(0, pLimit || 20)
        .map((ev) => ({
            event_id: ev.id, store_id: null, store_name: ev.store,
            violation_type: ev.violation_type, occurred_on: ev.occurred_on,
            resolved_on: ev.resolved_on, note: ev.note || null,
        }));
}

// ---- 방문·점검 기록 데모 (25_store_visits.sql) ---------------------------
//
// 같은 매장에 방문이 2건 이상 있는 픽스처를 하나 넣어 둡니다 — 매장을
// 고르면 "이전 이력 자동 조회"가 실제로 여러 건을 보여주는지 확인할 수
// 있게. 새로고침하면 폼에서 추가한 것도 사라집니다(violationEvents와 동일).
let storeVisits = [
    { id: 1, store: "샘플01점", visited_on: dateOffset(-70), visited_by: "김SV",
      hygiene_note: "냉장고 온도 정상", self_purchase_note: "자점매입 이상 없음",
      cooking_note: "조리 동선 양호", owner_meeting_note: "점주 특이요청 없음", special_note: null },
    { id: 2, store: "샘플01점", visited_on: dateOffset(-8), visited_by: "박SV",
      hygiene_note: "위생 양호", self_purchase_note: "자점매입 확인 중",
      cooking_note: "조리 정상", owner_meeting_note: "점주 미팅 완료", special_note: "냉장고 소음 발생 — 확인 필요" },
    { id: 3, store: "샘플11점", visited_on: dateOffset(-20), visited_by: "박SV",
      hygiene_note: "위생 양호", self_purchase_note: "이상 없음",
      cooking_note: "조리 정상", owner_meeting_note: null, special_note: null },
];
let nextVisitId = 4;

function computeStoreVisits(pStore, pLimit) {
    const list = storeVisits
        .filter((v) => !pStore || v.store === pStore)
        .sort((a, b) => b.visited_on.localeCompare(a.visited_on) || (b.id - a.id))
        .slice(0, pLimit || 200)
        .map((v) => ({
            visit_id: v.id, store_id: null, store_name: v.store,
            visited_on: v.visited_on, visited_by: v.visited_by,
            hygiene_note: v.hygiene_note, self_purchase_note: v.self_purchase_note,
            cooking_note: v.cooking_note, owner_meeting_note: v.owner_meeting_note,
            special_note: v.special_note,
        }));
    return list;
}

// ---- 오픈·폐점 기록 데모 (27_store_lifecycle.sql) -------------------------
//
// 샘플07점은 작년 오픈·이번 달 폐점 두 건을 다 넣어 뒀습니다 — "현재 상태"
// 표에는 최근 이벤트(폐점)만 보이고, "올해 요약"에는 폐점 1건만 잡히는지
// (작년 오픈은 안 잡히는지) 확인할 수 있게.
let storeLifecycleEvents = [
    { id: 1, store: "샘플03점", event_type: "open", event_date: dateOffset(-190), note: "신규 오픈" },
    { id: 2, store: "샘플12점", event_type: "close", event_date: dateOffset(-15), note: "임대 계약 종료" },
    { id: 3, store: "샘플07점", event_type: "open", event_date: dateOffset(-500), note: null },
    { id: 4, store: "샘플07점", event_type: "close", event_date: dateOffset(-40), note: "리뉴얼 공사로 임시 폐점" },
];
let nextLifecycleId = 5;

function computeStoreLifecycle(pStore, pLimit) {
    return storeLifecycleEvents
        .filter((e) => !pStore || e.store === pStore)
        .sort((a, b) => b.event_date.localeCompare(a.event_date) || (b.id - a.id))
        .slice(0, pLimit || 200)
        .map((e) => ({
            event_id: e.id, store_id: null, store_name: e.store,
            event_type: e.event_type, event_date: e.event_date, note: e.note,
        }));
}

function computeLifecycleStatus(pStatus) {
    const latestByStore = new Map();
    for (const e of [...storeLifecycleEvents].sort(
        (a, b) => a.event_date.localeCompare(b.event_date) || (a.id - b.id))) {
        latestByStore.set(e.store, e);
    }
    return [...latestByStore.values()]
        .filter((e) => !pStatus || e.event_type === pStatus)
        .sort((a, b) => b.event_date.localeCompare(a.event_date))
        .map((e) => ({
            store_id: null, store_name: e.store, status: e.event_type,
            since: e.event_date,
            days_since: Math.round((Date.now() - new Date(e.event_date).getTime()) / 86400000),
        }));
}

function computeLifecycleSummary(pYear) {
    const year = pYear || new Date().getFullYear();
    const inYear = (e) => Number(e.event_date.slice(0, 4)) === year;
    return {
        year,
        opens: storeLifecycleEvents.filter((e) => e.event_type === "open" && inYear(e)).length,
        closes: storeLifecycleEvents.filter((e) => e.event_type === "close" && inYear(e)).length,
        opens_baseline: 10,
        closes_baseline: 10,
    };
}

const HANDLERS = {
    api_filters: () => [{
        ym_min: MONTHS[0],
        ym_max: MONTHS[MONTHS.length - 1],
        stores: STORES.map((s) => s.name),
    }],

    // 내보내기 — 데모에서는 모든 (매장,월)이 '수집됨' 으로 나옵니다.
    api_export_coverage: (args) => {
        const rows = exportRows(args);
        const seen = new Set();
        const out = [];
        for (const r of rows) {
            const key = `${r.store.name}|${r.ym}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ store: r.store.name, ym: r.ym, amount: 0, has_data: true });
        }
        // 매장×월 합계 채우기
        const sum = group(rows, (r) => `${r.store.name}|${r.ym}`);
        for (const o of out) o.amount = sum.get(`${o.store}|${o.ym}`).amount;
        return out.sort((a, b) => a.store.localeCompare(b.store) || a.ym - b.ym);
    },

    // 대시보드 시트 7종. 실제 함수와 같이 **jsonb 한 줄**로 돌려줍니다 —
    // 데모가 행 배열을 주면 껍데기 벗기는 코드(oneRow)가 안 먹혀 빈 시트가 나옵니다.
    // 매장 계정. 데모 암호는 'demo1234' 입니다 — 실제 게이트와 같은 모양으로
    // 틀린 암호를 거부해야 화면 검증이 의미가 있습니다.
    api_store_credentials: ({ p_passcode }) => {
        if (p_passcode !== "demo1234") {
            throw new Error("접근 암호가 맞지 않습니다.");
        }
        const items = [];
        for (const s of STORES.slice(0, 4)) {
            for (const ch of ["배민", "쿠팡이츠", "요기요"]) {
                items.push({
                    store: s.name, trade_area: s.trade_area, channel: ch,
                    login_id: `${ch === "배민" ? "bm" : ch === "쿠팡이츠" ? "ce" : "yg"}_${s.name}`,
                    password: "demo!pw" + (s.name.length % 10),
                    note: ch === "요기요" ? "2단계 인증 없음" : "",
                    updated_at: "2026-07-28T10:12:00+09:00", updated_by: "demo@mitaly",
                });
            }
        }
        return [{ items }];
    },

    api_save_store_credential: ({ p_store, p_channel }) =>
        ({ ok: true, store: p_store, channel: p_channel, changed: ["아이디 변경"] }),

    api_export_menu_matrix: ({ p_field, ...args }) => {
        const buckets = {
            trade_area: ["미지정", "거주밀집", "오피스", "대학가"],
            weekday: ["월", "화", "수", "목", "금", "토", "일"],
            daypart: ["아침", "점심", "오후", "저녁"],
        }[p_field] || ["미지정"];
        const total = exportRows(args).reduce((a, r) => a + r.amount, 0);
        const items = MENUS.map(([menu, category], mi) => {
            const amount = Math.round(total / (mi + 1.6) / 6);
            const share = {};
            // 앞쪽 구간에 무게를 실어 분포가 평평해 보이지 않게 합니다.
            const w = buckets.map((_, bi) => 1 / (bi + 1.3));
            const sum = w.reduce((a, b) => a + b, 0);
            buckets.forEach((b, bi) => { share[b] = Math.round(amount * w[bi] / sum); });
            return { menu, category, total: amount, buckets: share };
        }).sort((a, b) => b.total - a.total);
        return [{ items }];
    },

    api_export_by_hour: (args) => {
        const total = exportRows(args).reduce((a, r) => a + r.amount, 0);
        const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
        // 점심·저녁 두 봉우리. 실제 매장 분포와 모양을 맞춥니다.
        const w = [0.3, 0.7, 1.6, 1.4, 0.6, 0.4, 0.5, 0.8, 1.5, 1.3, 0.8, 0.4];
        const sum = w.reduce((a, b) => a + b, 0);
        const items = hours.map((hour, i) => {
            const amount = Math.round(total * w[i] / sum);
            return {
                hour, amount, qty: Math.round(amount / 13_500),
                hall_amount: Math.round(amount * 0.66),
                delivery_amount: amount - Math.round(amount * 0.66),
            };
        });
        return [{ items }];
    },

    api_export_nonstandard: (args) => {
        const rows = exportRows(args);
        const map = new Map();
        for (const r of rows) {
            const m = map.get(r.store.name)
                || { store: r.store.name, trade_area: r.store.trade_area, total: 0 };
            m.total += r.amount;
            map.set(r.store.name, m);
        }
        const items = [...map.values()].map((m, i) => {
            const ratio = [3.8, 1.2, 6.4, 0.4][i % 4];
            return {
                ...m,
                nonstandard: Math.round(m.total * ratio / 100),
                ratio,
                nonstandard_menus: [4, 1, 7, 1][i % 4],
            };
        }).sort((a, b) => b.ratio - a.ratio);
        return [{ items }];
    },

    api_export_store_detail: (args) => {
        const items = HANDLERS.api_export_store_summary(args).map((s) => ({
            ...s,
            delivery_ratio: s.amount
                ? Math.round(1000 * s.delivery_amount / s.amount) / 10 : 0,
            source_count: 3,
        }));
        return [{ items }];
    },

    // 미매핑은 매장·기간 필터와 무관합니다(매핑표는 전사 공통).
    api_export_unmapped: () => [{
        items: [
            { name: "신메뉴테스트A", first_ym: 202603, last_ym: 202606,
              seen: 412, sources: "배민, 이지포스(굿모닝)" },
            { name: "리뷰이벤트(사이다)", first_ym: 202601, last_ym: 202606,
              seen: 288, sources: "쿠팡이츠" },
            { name: "포장할인", first_ym: 202605, last_ym: 202606,
              seen: 61, sources: "요기요" },
        ],
    }],

    api_export_store_summary: (args) => {
        const rows = exportRows(args);
        const map = new Map();
        for (const r of rows) {
            const m = map.get(r.store.name) || {
                store: r.store.name, trade_area: r.store.trade_area,
                amount: 0, qty: 0, hall_amount: 0, delivery_amount: 0,
                months: new Set(),
            };
            m.amount += r.amount; m.qty += r.qty;
            if (r.channel === "홀") m.hall_amount += r.amount;
            else m.delivery_amount += r.amount;
            m.months.add(r.ym);
            map.set(r.store.name, m);
        }
        return [...map.values()].map((m) => ({
            store: m.store, trade_area: m.trade_area,
            amount: m.amount, qty: m.qty,
            avg_ticket: m.qty ? Math.round(m.amount / m.qty) : 0,
            hall_amount: m.hall_amount, delivery_amount: m.delivery_amount,
            menu_count: MENUS.length, active_months: m.months.size,
        })).sort((a, b) => b.amount - a.amount);
    },

    api_export_menu: (args) => {
        const total = exportRows(args).reduce((a, r) => a + r.amount, 0);
        return MENUS.map(([menu, category], mi) => {
            const share = 1 / (mi + 1.6);
            const amount = Math.round(total * share / 6);
            return {
                menu, category, amount,
                qty: Math.round(amount / 13_500),
                store_count: STORES.length, is_giveaway: false,
            };
        }).sort((a, b) => b.amount - a.amount);
    },

    api_export_monthly: (args) => {
        const rows = exportRows(args);
        const map = new Map();
        for (const r of rows) {
            const m = map.get(r.ym) || {
                ym: r.ym, amount: 0, qty: 0,
                hall_amount: 0, delivery_amount: 0, stores: new Set(),
            };
            m.amount += r.amount; m.qty += r.qty;
            if (r.channel === "홀") m.hall_amount += r.amount;
            else m.delivery_amount += r.amount;
            m.stores.add(r.store.name);
            map.set(r.ym, m);
        }
        return [...map.values()].map((m) => ({
            ym: m.ym, amount: m.amount, qty: m.qty,
            hall_amount: m.hall_amount, delivery_amount: m.delivery_amount,
            store_count: m.stores.size,
        })).sort((a, b) => a.ym - b.ym);
    },

    api_summary: (args) => {
        const rows = baseRows(args);
        return [{
            amount: rows.reduce((a, r) => a + r.amount, 0),
            qty: rows.reduce((a, r) => a + r.qty, 0),
            store_count: new Set(rows.map((r) => r.store.name)).size,
            menu_count: MENUS.length,
        }];
    },

    api_monthly: (args) => {
        const map = group(baseRows(args), (r) => `${r.ym}|${r.channel}`);
        return [...map.entries()]
            .map(([key, v]) => {
                const [ym, channel] = key.split("|");
                return { ym: Number(ym), channel, amount: v.amount, qty: v.qty };
            })
            .sort((a, b) => a.ym - b.ym || a.channel.localeCompare(b.channel));
    },

    api_by_store: (args) => {
        const map = group(baseRows(args), (r) => r.store.name);
        return [...map.entries()]
            .map(([name, v]) => ({
                store: name,
                trade_area: (STORES.find((s) => s.name === name) || {}).trade_area,
                amount: v.amount,
                qty: v.qty,
            }))
            .sort((a, b) => b.amount - a.amount);
    },

    api_by_menu: (args) => {
        const total = HANDLERS.api_summary(args)[0].amount;
        const weights = MENUS.map((_, i) => 1 / (i + 1.6));
        const sum = weights.reduce((a, b) => a + b, 0);
        return MENUS.map(([menu, category], i) => ({
            menu,
            category,
            amount: Math.round((total * weights[i]) / sum),
            qty: Math.round((total * weights[i]) / sum / 13_500),
        })).sort((a, b) => b.amount - a.amount);
    },

    api_by_hour: (args) => {
        const total = HANDLERS.api_summary(args)[0].amount;
        const sum = HOUR_SHAPE.reduce((a, b) => a + b, 0);
        return HOUR_SHAPE.map((weight, hour) => ({
            hour,
            amount: Math.round((total * weight) / sum),
            qty: Math.round((total * weight) / sum / 13_500),
        })).filter((r) => r.amount > 0);
    },

    // 수집 대상 매장 — 실제로는 러너가 계정표를 읽어 올려줍니다.
    api_targets: () => STORES.map((s, i) => ({
        name: s.name,
        plugins: [
            ...(i % 5 !== 4 ? ["easypos"] : []),
            ...(i % 3 !== 2 ? ["baemin"] : []),
            ...(i % 4 !== 3 ? ["coupangeats"] : []),
            ...(i % 7 === 0 ? ["imu"] : []),
        ],
        details: [i % 6 === 0 ? "착한통신" : "굿모닝"],
    })),

    // --- 아래는 엑셀에서 옮겨온 분석 화면들의 가짜 데이터 ---

    api_coverage_by_source: (args) => {
        const out = [];
        const sources = ["이지포스(굿모닝)", "이지포스(착한통신)", "아임유", "배민", "쿠팡이츠"];
        MONTHS.forEach((ym, i) => {
            if (!inRange(ym, args.p_ym_from, args.p_ym_to)) return;
            sources.forEach((source, si) => {
                // 배달 채널은 최근 달에만 조금 잡히게 — 실제 상황과 비슷하게
                const late = si >= 3;
                if (late && i < MONTHS.length - 4) return;
                const count = late ? 3 + si : Math.round(60 + i);
                out.push({ source, ym, store_count: count, amount: count * 12_000_000 });
            });
        });
        return out;
    },

    api_coverage_matrix: (args) => {
        const months = MONTHS.filter((ym) => inRange(ym, args.p_ym_from, args.p_ym_to));
        return STORES.map((store, si) => {
            if (args.p_store && store.name !== args.p_store) return null;
            const filled = {};
            let total = 0;
            months.forEach((ym, i) => {
                if ((si + i) % 11 === 0) return;      // 군데군데 비어 있게
                const amount = Math.round(20_000_000 * store.weight);
                filled[String(ym)] = amount;
                total += amount;
            });
            return {
                store: store.name,
                months_filled: Object.keys(filled).length,
                total,
                months: filled,
            };
        }).filter(Boolean);
    },

    api_nonstandard_stores: (args) => {
        const total = HANDLERS.api_summary(args)[0].amount;
        return STORES.slice(0, 30).map((s, i) => {
            const ratio = 0.34 / (1 + i * 0.28);
            const food = Math.round(total * s.weight / 60);
            return {
                store: s.name, trade_area: s.trade_area,
                nonstandard_amount: Math.round(food * ratio),
                food_amount: food,
                ratio: ratio.toFixed(4),
                menu_count: 8 + ((i * 3) % 30),
            };
        });
    },

    api_store_metrics: (args) => {
        const rows = HANDLERS.api_by_store(args);
        return rows.map((r, i) => ({
            store: r.store, trade_area: r.trade_area,
            amount: r.amount, qty: r.qty,
            avg_ticket: Math.round(r.amount / Math.max(1, r.qty)),
            hall_amount: Math.round(r.amount * 0.66),
            delivery_amount: Math.round(r.amount * 0.34),
            menu_count: 12 + (i % 6),
            active_months: MONTHS.filter((m) => inRange(m, args.p_ym_from, args.p_ym_to)).length,
        }));
    },

    api_menu_matrix: (args) => {
        const buckets = {
            trade_area: AREAS,
            weekday: ["월", "화", "수", "목", "금", "토", "일"],
            daypart: ["아침", "점심", "오후", "저녁"],
        }[args.p_field] || AREAS;
        return menuMatrix(args, args.p_field, buckets);
    },

    api_unmapped: () => [
        { name: "[[재주문율 1위]] 정통 알리오 올리오", source: "배민", count: 24, ym: 202607 },
        { name: "[[인기1위]] 베이컨 까르보나라", source: "배민", count: 19, ym: 202607 },
        { name: "[[시그니처]] 감바스 파스타", source: "배민", count: 18, ym: 202607 },
        { name: "(신)트러플 크림 뇨끼", source: "쿠팡이츠", count: 11, ym: 202607 },
        { name: "런치세트 A", source: "이지포스(굿모닝)", count: 7, ym: 202607 },
    ],

    // 매출이 0이고 수량만 있는 품목. 실제 데이터에도 2,376행 있습니다.
    // 이 줄들이 화면에서 안 사라지는지 보려고 데모에 넣습니다.
    api_all_items: (args) => {
        const rows = HANDLERS.api_by_menu(args).map((r, i) => ({
            menu: r.menu,
            category: r.category,
            amount: r.amount,
            qty: r.qty,
            store_count: 94 - (i % 9),
            is_giveaway: false,
        }));
        rows.push(
            { menu: "리뷰이벤트 감자튀김", category: "사이드",
              amount: 0, qty: 1840, store_count: 61, is_giveaway: true },
            { menu: "서비스 음료", category: "음료",
              amount: 0, qty: 962, store_count: 38, is_giveaway: true },
        );
        // 실제 함수와 같은 모양 — jsonb 배열을 담은 한 줄 (11_all_items_fix.sql).
        return [{ items: rows }];
    },

    api_by_category: (args) => {
        const map = new Map();
        for (const r of HANDLERS.api_all_items(args)[0].items) {
            const key = r.category || "미분류";
            const acc = map.get(key) || { amount: 0, qty: 0, menu_count: 0 };
            acc.amount += r.amount;
            acc.qty += r.qty;
            acc.menu_count += 1;
            map.set(key, acc);
        }
        return [...map.entries()]
            .map(([category, v]) => ({ category, ...v }))
            .sort((a, b) => b.amount - a.amount);
    },

    // 리뷰 — 화면 배치 확인용 가짜 데이터입니다.
    // 실제 응답과 같은 모양(jsonb 한 줄)으로 돌려줍니다.
    api_reviews: (args) => {
        let rows = DEMO_REVIEWS;
        if (args.p_unanswered_only) rows = rows.filter((r) => !r.replies.length);
        if (args.p_platform) rows = rows.filter((r) => r.platform === args.p_platform);
        if (args.p_min_rating != null) rows = rows.filter((r) => r.rating >= args.p_min_rating);
        if (args.p_max_rating != null) rows = rows.filter((r) => r.rating <= args.p_max_rating);
        if (args.p_store) rows = rows.filter((r) => r.store === args.p_store);
        // 실제 api_reviews 는 반려된 초안을 빼고 돌려줍니다(13_reviews_api.sql).
        return [{ items: rows.map((r) => ({
            ...r,
            drafts: (r.drafts || []).filter((d) => d.status !== "rejected"),
        })) }];
    },

    api_review_summary: (args) => {
        const rows = HANDLERS.api_reviews({ ...args, p_unanswered_only: false })[0].items;
        const byRating = new Map();
        const byPlatform = new Map();
        for (const r of rows) {
            byRating.set(r.rating, (byRating.get(r.rating) || 0) + 1);
            const p = byPlatform.get(r.platform) || { count: 0, unanswered: 0 };
            p.count += 1;
            if (!r.replies.length) p.unanswered += 1;
            byPlatform.set(r.platform, p);
        }
        const total = rows.length;
        const avg = total
            ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / total) * 100) / 100
            : null;
        return [{ summary: {
            total,
            unanswered: rows.filter((r) => !r.replies.length).length,
            avg_rating: avg,
            by_rating: [...byRating.entries()]
                .map(([rating, count]) => ({ rating, count }))
                .sort((a, b) => b.rating - a.rating),
            by_platform: [...byPlatform.entries()]
                .map(([platform, v]) => ({ platform, ...v }))
                .sort((a, b) => b.count - a.count),
        } }];
    },

    // 리뷰 수집 현황. 실제 api_review_sync_status() 와 같은 규칙으로
    // DEMO_REVIEWS 에서 계산합니다(can_reply && 아직 답글 없음 = openable).
    api_review_sync_status: () => {
        const openable = DEMO_REVIEWS.filter(
            (r) => r.can_reply && !r.replies.length,
        ).length;
        const lastDone = new Date(Date.now() - 5 * 3600_000).toISOString();
        return [{ status: {
            last_done_at: lastDone,
            last_any_at: lastDone,
            pending: 0,
            reviews_total: DEMO_REVIEWS.length,
            reviews_openable: openable,
        } }];
    },

    // AI 답글 초안. 데모에서는 DEMO_REVIEWS 의 drafts 를 그대로 셉니다.
    api_draft_summary: () => {
        const all = DEMO_REVIEWS.flatMap((r) => r.drafts || []);
        const count = (s) => all.filter((d) => d.status === s).length;
        return [{ summary: {
            draft: count("draft"),
            approved: count("approved"),
            rejected: count("rejected"),
            posted: count("posted"),
            tone: "기본(정중+온기)",
        } }];
    },

    // 승인·반려·수정. 데모라 메모리에서만 바뀌고 새로고침하면 돌아옵니다.
    // 실제와 같은 모양({ok, reason})으로 돌려줍니다.
    approve_reply_draft: (args) => demoDraftMove(args.p_draft_id, "approved"),
    reject_reply_draft: (args) => demoDraftMove(args.p_draft_id, "rejected"),
    edit_reply_draft: (args) => {
        const draft = demoFindDraft(args.p_draft_id);
        if (!draft) return { ok: false, reason: "초안을 찾지 못했습니다" };
        const clean = (args.p_contents || "").trim();
        if (!clean) return { ok: false, reason: "내용이 비어 있습니다" };
        draft.contents = clean;
        draft.status = "draft";
        return { ok: true, status: "draft" };
    },

    api_by_weekday: (args) => {
        const total = HANDLERS.api_summary(args)[0].amount;
        const sum = Object.values(WEEKDAY_SHAPE).reduce((a, b) => a + b, 0);
        return Object.entries(WEEKDAY_SHAPE).map(([weekday, weight]) => ({
            weekday,
            amount: Math.round((total * weight) / sum),
            qty: Math.round((total * weight) / sum / 13_500),
        }));
    },

    // 급증·급감 판정 — 18_alerts.sql(api_sales_alerts)과 같은 모양(jsonb 한 줄:
    // {alerts: [...]}). 매장 두 곳(샘플03·07점)만 DEMO_ALERT_BUMPS로 튀게
    // 만들어서 화면에 급증·급감 배지가 실제로 보이게 합니다.
    api_sales_alerts: ({ p_ym, p_store }) => {
        const stores = p_store ? STORES.filter((s) => s.name === p_store) : STORES;
        const perStore = stores.map((store) => {
            const channels = demoStoreCompareRows(p_ym, store).map((c) => ({
                ...c,
                mom_direction: alertDirection(c.mom_pct_change),
                yoy_direction: alertDirection(c.yoy_pct_change),
            }));
            const hasAlert = channels.some((c) =>
                c.mom_direction === "급증" || c.mom_direction === "급감" ||
                c.yoy_direction === "급증" || c.yoy_direction === "급감");
            return { store: store.name, trade_area: store.trade_area,
                     has_alert: hasAlert, channels };
        });
        perStore.sort((a, b) =>
            (Number(b.has_alert) - Number(a.has_alert)) || a.store.localeCompare(b.store));
        return [{ alerts: perStore }];
    },

    // 기간 대비 보고서 — 19_compare.sql(api_sales_compare)과 같은 모양(jsonb
    // 한 줄짜리 객체). 회사 전체·채널별 합계는 항상 전 매장 기준이고, 매장
    // 목록만 p_store로 걸러집니다(실제 함수와 동일한 규칙).
    api_sales_compare: ({ p_ym, p_store }) => {
        const prevMomYm = shiftYm(p_ym, -1);
        const prevYoyYm = shiftYm(p_ym, -12);

        const base = STORES.flatMap((store) => demoStoreCompareRows(p_ym, store)
            .map((c) => ({ ...c, store })));

        const companyAmount = base.reduce((a, r) => a + r.amount, 0);
        const companyPrevMom = sumOrNull(base.map((r) => r.prev_mom_amount));
        const companyPrevYoy = sumOrNull(base.map((r) => r.prev_yoy_amount));
        const company = {
            amount: companyAmount,
            prev_mom_amount: companyPrevMom,
            mom_pct_change: pctChange(companyAmount, companyPrevMom),
            prev_yoy_amount: companyPrevYoy,
            yoy_pct_change: pctChange(companyAmount, companyPrevYoy),
        };

        const byChannel = ["홀", "배달"].map((channel) => {
            const rows = base.filter((r) => r.channel === channel);
            const amount = rows.reduce((a, r) => a + r.amount, 0);
            const prevMom = sumOrNull(rows.map((r) => r.prev_mom_amount));
            const prevYoy = sumOrNull(rows.map((r) => r.prev_yoy_amount));
            return {
                channel, amount,
                prev_mom_amount: prevMom,
                mom_pct_change: pctChange(amount, prevMom),
                prev_yoy_amount: prevYoy,
                yoy_pct_change: pctChange(amount, prevYoy),
            };
        });

        const wanted = p_store ? STORES.filter((s) => s.name === p_store) : STORES;
        const stores = wanted.map((store) => {
            const rows = demoStoreCompareRows(p_ym, store);
            const amount = rows.reduce((a, r) => a + r.amount, 0);
            const prevMom = sumOrNull(rows.map((r) => r.prev_mom_amount));
            const prevYoy = sumOrNull(rows.map((r) => r.prev_yoy_amount));
            return {
                store: store.name, trade_area: store.trade_area,
                amount,
                prev_mom_amount: prevMom,
                mom_pct_change: pctChange(amount, prevMom),
                prev_yoy_amount: prevYoy,
                yoy_pct_change: pctChange(amount, prevYoy),
                by_channel: rows,
            };
        }).sort((a, b) => a.store.localeCompare(b.store));

        return [{ compare: {
            ym: p_ym, prev_mom_ym: prevMomYm, prev_yoy_ym: prevYoyYm,
            company, by_channel: byChannel, stores,
        } }];
    },

    // 22_notices.sql — `returns table (rules jsonb)` 라 다른 table(x jsonb)
    // 함수들과 같은 모양([{rules:[...]}])입니다.
    api_notice_stage_rules: () => [{ rules: NOTICE_RULES }],

    // 23_notice_determination.sql — `returns jsonb`(스칼라)라 감싸지 않고
    // 배열을 그대로 돌려줍니다(approve_reply_draft 등과 같은 반환 형태).
    api_notice_stage_status: ({ p_store }) => computeNoticeStatus(p_store || null),

    // 24_violation_resolve.sql — 실제 함수와 같은 검증 순서(존재→이미 종료
    // →날짜 누락→발생일보다 앞선 종료일)로 {ok, reason} 을 돌려줍니다.
    resolve_violation_event: ({ p_event_id, p_resolved_on, p_note }) => {
        const ev = violationEvents.find((v) => v.id === p_event_id);
        if (!ev) return { ok: false, reason: "위반 기록을 찾지 못했습니다" };
        if (ev.resolved_on) return { ok: false, reason: "이미 종료 처리된 기록입니다" };
        if (!p_resolved_on) return { ok: false, reason: "종료일을 입력하세요" };
        if (p_resolved_on < ev.occurred_on) {
            return { ok: false, reason: "종료일이 발생일보다 앞설 수 없습니다" };
        }
        ev.resolved_on = p_resolved_on;
        const note = (p_note || "").trim();
        if (note) ev.note = ev.note ? `${ev.note} / ${note}` : note;
        return { ok: true, event_id: p_event_id, resolved_on: p_resolved_on };
    },

    // 26_violation_reopen.sql — 최근 종료된 위반 목록. resolve 와 대칭으로
    // event_id 를 검증합니다.
    api_violation_events_resolved: ({ p_store, p_limit }) =>
        computeResolvedViolations(p_store || null, p_limit),

    // 26_violation_reopen.sql — 실제 함수와 같은 검증 순서(존재→이미 진행 중)
    // 로 {ok, reason} 을 돌려줍니다.
    reopen_violation_event: ({ p_event_id, p_note }) => {
        const ev = violationEvents.find((v) => v.id === p_event_id);
        if (!ev) return { ok: false, reason: "위반 기록을 찾지 못했습니다" };
        if (!ev.resolved_on) {
            return { ok: false, reason: "이미 진행 중인 기록입니다(종료 처리된 적이 없습니다)" };
        }
        ev.resolved_on = null;
        const note = (p_note || "").trim();
        if (note) ev.note = ev.note ? `${ev.note} / ${note}` : note;
        return { ok: true, event_id: p_event_id, reopened: true };
    },

    api_store_visits: ({ p_store, p_limit }) => computeStoreVisits(p_store || null, p_limit),

    api_store_lifecycle: ({ p_store, p_limit }) => computeStoreLifecycle(p_store || null, p_limit),
    api_store_lifecycle_status: ({ p_status }) => computeLifecycleStatus(p_status || null),
    api_store_lifecycle_summary: ({ p_year }) => computeLifecycleSummary(p_year || null),
};

export function demoClient() {
    const session = { user: { email: "데모 모드 (가짜 데이터)" } };

    // 데모용 수집 요청 목록. 새로고침하면 사라집니다.
    let nextId = 41;
    const requests = [
        {
            id: 40,
            requested_at: new Date(Date.now() - 3600_000).toISOString(),
            plugins: ["easypos", "imu"],
            date_from: "2026-06-01", date_to: "2026-06-30",
            stores: [], profiles: ["굿모닝", "착한통신"],
            status: "done", progress: "완료", error: null,
            finished_at: new Date(Date.now() - 3000_000).toISOString(),
            log_tail: "[1/2] easypos 수집 중\n  매장 68개 · 계정 굿모닝, 착한통신\n"
                + "  완료 · 12,043행\n[2/2] imu 수집 중\n  완료 · 5,210행\n"
                + "대시보드 갱신 완료\n클라우드 업로드 완료",
        },
        // 리뷰 요청이 실패했을 때 화면에 다음 행동 안내가 붙는지 보는 픽스처(큐 #8).
        // 에러 문구는 agent/mitaly_cloud_agent.py handle_review_request() 의
        // "수집한 채널이 없습니다. 실패: ..." (전 채널 실패 → status=failed) 그대로.
        {
            id: 39,
            kind: "reviews",
            requested_at: new Date(Date.now() - 5400_000).toISOString(),
            plugins: ["baemin", "yogiyo"],
            date_from: "2026-07-14", date_to: "2026-07-27",
            stores: [], profiles: [],
            status: "failed", progress: null,
            error: "RuntimeError: 수집한 채널이 없습니다. 실패: baemin, yogiyo",
            finished_at: new Date(Date.now() - 5300_000).toISOString(),
            log_tail: "[1/2] baemin 리뷰 수집\n  [경고] baemin 리뷰 실패(코드 1)\n"
                + "[2/2] yogiyo 리뷰 수집\n  [경고] yogiyo 리뷰 실패(코드 1)",
        },
    ];

    const builder = (table) => {
        const chain = {
            select: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({
                data: table === "collect_requests"
                    ? [...requests].sort((a, b) => b.id - a.id)
                    : table === "runner_status"
                        ? [{
                            last_seen_at: new Date().toISOString(),
                            hostname: "DEMO-PC", busy: false, current_note: "대기 중",
                        }]
                        : table === "stores"
                            ? STORES.map((s) => ({ id: s.id, name: s.name }))
                                .sort((a, b) => a.name.localeCompare(b.name))
                            : [{ uploaded_at: new Date().toISOString() }],
                error: null,
            }),
            insert: async (row) => {
                if (table === "violation_events") {
                    const store = STORES.find((s) => s.id === Number(row.store_id));
                    violationEvents.push({
                        id: nextViolationId++,
                        store: store ? store.name : "알 수 없는 매장",
                        violation_type: row.violation_type,
                        occurred_on: row.occurred_on,
                        resolved_on: row.resolved_on || null,
                        sequence_no: row.sequence_no ?? null,
                        applies_logo_required_item: row.applies_logo_required_item ?? null,
                        note: row.note || null,
                    });
                    return { data: null, error: null };
                }
                if (table === "store_visits") {
                    const store = STORES.find((s) => s.id === Number(row.store_id));
                    storeVisits.push({
                        id: nextVisitId++,
                        store: store ? store.name : "알 수 없는 매장",
                        visited_on: row.visited_on,
                        visited_by: row.visited_by || null,
                        hygiene_note: row.hygiene_note || null,
                        self_purchase_note: row.self_purchase_note || null,
                        cooking_note: row.cooking_note || null,
                        owner_meeting_note: row.owner_meeting_note || null,
                        special_note: row.special_note || null,
                    });
                    return { data: null, error: null };
                }
                if (table === "store_lifecycle_events") {
                    const store = STORES.find((s) => s.id === Number(row.store_id));
                    storeLifecycleEvents.push({
                        id: nextLifecycleId++,
                        store: store ? store.name : "알 수 없는 매장",
                        event_type: row.event_type,
                        event_date: row.event_date,
                        note: row.note || null,
                    });
                    return { data: null, error: null };
                }
                if (table !== "collect_requests") return { data: null, error: null };
                requests.push({
                    id: nextId++,
                    requested_at: new Date().toISOString(),
                    kind: row.kind || "sales",
                    plugins: row.plugins,
                    date_from: row.date_from,
                    date_to: row.date_to,
                    stores: row.stores || [],
                    profiles: row.profiles || [],
                    status: "pending",
                    progress: null, error: null, finished_at: null, log_tail: null,
                });
                return { data: null, error: null };
            },
        };
        // .limit() 없이 바로 await 하는 경우도 대비합니다.
        chain.then = (resolve, reject) => chain.limit().then(resolve, reject);
        return chain;
    };

    return {
        auth: {
            getSession: async () => ({ data: { session } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signOut: async () => {
                alert("데모 모드에서는 로그아웃이 없습니다.");
            },
        },
        from: builder,
        rpc: async (name, args = {}) => {
            const handler = HANDLERS[name];
            if (!handler) return { data: null, error: { message: `알 수 없는 함수: ${name}` } };
            // 실제 네트워크처럼 약간 지연시켜 로딩 처리도 확인합니다.
            await new Promise((r) => setTimeout(r, 60));
            return { data: handler(args), error: null };
        },
    };
}
