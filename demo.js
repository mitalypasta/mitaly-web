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

// 레시피 데모(32_recipes.sql) — 실제 원가분석 반입분과 같은 필드 이름을 씁니다.
// 메뉴 이름은 위 MENUS 와 겹치게 둡니다(이론 사용량 계산이 이걸 씁니다).
const DEMO_RECIPES = [
    { category: "파스타", menu: "로제 파스타", ingredient: "스파게티면", grams: 130, unit_price: 3.2, supply_won: 416 },
    { category: "파스타", menu: "로제 파스타", ingredient: "로제 소스", grams: 180, unit_price: 5.1, supply_won: 918 },
    { category: "파스타", menu: "로제 파스타", ingredient: "베이컨", grams: 30, unit_price: 12.0, supply_won: 360 },
    { category: "파스타", menu: "까르보나라", ingredient: "스파게티면", grams: 130, unit_price: 3.2, supply_won: 416 },
    { category: "파스타", menu: "까르보나라", ingredient: "크림 소스", grams: 170, unit_price: 4.8, supply_won: 816 },
    { category: "파스타", menu: "까르보나라", ingredient: "베이컨", grams: 40, unit_price: 12.0, supply_won: 480 },
    { category: "파스타", menu: "토마토 파스타", ingredient: "스파게티면", grams: 130, unit_price: 3.2, supply_won: 416 },
    { category: "파스타", menu: "토마토 파스타", ingredient: "토마토 소스", grams: 190, unit_price: 4.0, supply_won: 760 },
    { category: "피자", menu: "마르게리따 피자", ingredient: "도우", grams: 1, unit_price: 1200, supply_won: 1200 },
    { category: "피자", menu: "마르게리따 피자", ingredient: "모짜렐라", grams: 110, unit_price: 9.5, supply_won: 1045 },
    { category: "피자", menu: "마르게리따 피자", ingredient: "토마토 소스", grams: 90, unit_price: 4.0, supply_won: 360 },
];

// 광고 데모(48_ad_spend.sql) — 실서버는 자료 반입 전이라 빈 표가 정상이고,
// 데모는 반대로 '채워진' 화면이 제대로 그려지는지 봅니다.
const DEMO_ADS = [
    { ym: 202607, store: "샘플01점", channel: "배민", campaign: "우리가게클릭", cost: 330000, impressions: 41200, clicks: 1180, orders: 96 },
    { ym: 202607, store: "샘플01점", channel: "쿠팡이츠", campaign: "매장 부스트", cost: 210000, impressions: 28800, clicks: 640, orders: 51 },
    { ym: 202607, store: "샘플02점", channel: "배민", campaign: "우리가게클릭", cost: 275000, impressions: 35400, clicks: 990, orders: 74 },
    { ym: 202607, store: "샘플03점", channel: "요기요", campaign: "", cost: 120000, impressions: 15100, clicks: 310, orders: 22 },
    { ym: 202606, store: "샘플01점", channel: "배민", campaign: "우리가게클릭", cost: 310000, impressions: 39900, clicks: 1050, orders: 88 },
    { ym: 202606, store: "샘플02점", channel: "쿠팡이츠", campaign: "매장 부스트", cost: 190000, impressions: 24500, clicks: 570, orders: 43 },
];

// 점주 연락처 데모(44_store_contacts.sql) — 전부 가짜 값입니다.
const demoContacts = [
    { store_id: 1, store_name: "샘플01점", owner_name: "김샘플", owner_phone: "010-0000-0001",
      operator_name: "이운영", operator_phone: "010-0000-0002", store_phone: "02-000-0001",
      email: "sample01@example.com", address: "서울 샘플구 예시로 1",
      business_number: "000-00-00001", contract_period: "2024.01 ~ 2029.01",
      transfer_note: null, updated_at: new Date(Date.now() - 86400_000).toISOString() },
    { store_id: 2, store_name: "샘플02점", owner_name: "박샘플", owner_phone: "010-0000-0003",
      operator_name: null, operator_phone: null, store_phone: "02-000-0002",
      email: null, address: "서울 샘플구 예시로 22",
      business_number: "000-00-00002", contract_period: "2023.06 ~ 2028.06",
      transfer_note: "2025.03 양도(전 점주 최샘플)",
      updated_at: new Date(Date.now() - 43200_000).toISOString() },
];

// POS 메뉴 데모(50_pos_menu.sql). 품절여부는 이지포스 공통코드 POS_246 이고
// 1(품절)·7(일시판매중지)이 '지금 못 파는 상태' 입니다.
// large_code 003 은 매장 단독 메뉴, 나머지는 전 매장 공통(본사 메뉴)입니다.
const DEMO_POS_SOLDOUT = {
    "0": "정상", "1": "품절", "2": "매장상품", "3": "포장상품",
    "4": "사용자이미지", "5": "숨김", "6": "출시예정", "7": "일시판매중지",
};
const DEMO_POS_UNAVAILABLE = new Set(["1", "7"]);
// 계정 둘은 서로 다른 본부(HI5·INY)이고 **대분류 004 의 뜻이 다릅니다** —
// 굿모닝은 '직영점', 착한통신은 '26년 메뉴'. 데모도 그 차이를 그대로 둡니다.
// 이 줄이 있어야 '계정을 안 고르면 분류 고르개에 계정 이름이 붙는' 동작을
// 화면에서 확인할 수 있습니다.
const DEMO_POS_MENUS = [
    { menu_item_id: 1, account: "굿모닝", hq_code: "HI5", large_code: "001", large_name: "본사(1채널)[본사 메뉴]",
      store: "전 매장 공통", store_matched: false, store_scope: "common",
      category: "미태리 파스타 > 토마토",
      item_code: "000001", item_name: "토마토 파스타", price: 6800, soldout_code: "0" },
    { menu_item_id: 2, account: "굿모닝", hq_code: "HI5", large_code: "001", large_name: "본사(1채널)[본사 메뉴]",
      store: "전 매장 공통", store_matched: false, store_scope: "common",
      category: "미태리 파스타 > 시그니처",
      item_code: "000100", item_name: "블랙페퍼 목살 스테이크", price: 19800, soldout_code: "1" },
    { menu_item_id: 3, account: "굿모닝", hq_code: "HI5", large_code: "001", large_name: "본사(1채널)[본사 메뉴]",
      store: "전 매장 공통", store_matched: false, store_scope: "common",
      category: "미태리 파스타 > 레드 와인",
      item_code: "000116", item_name: "파블로 올드 바인 가르나차", price: 28000, soldout_code: "1" },
    { menu_item_id: 4, account: "굿모닝", hq_code: "HI5", large_code: "003", large_name: "매장(3채널)[단독/본사 메뉴 외]",
      store: "샘플01점", store_matched: true, store_scope: "store",
      category: "미태리 샘플01점 > 카페",
      item_code: "000334", item_name: "토피넛 라떼", price: 4500, soldout_code: "1" },
    { menu_item_id: 5, account: "굿모닝", hq_code: "HI5", large_code: "003", large_name: "매장(3채널)[단독/본사 메뉴 외]",
      store: "샘플01점", store_matched: true, store_scope: "store",
      category: "미태리 샘플01점 > 카페",
      item_code: "000335", item_name: "고구마 라떼", price: 4500, soldout_code: "0" },
    { menu_item_id: 6, account: "굿모닝", hq_code: "HI5", large_code: "003", large_name: "매장(3채널)[단독/본사 메뉴 외]",
      store: "샘플02점", store_matched: true, store_scope: "store",
      category: "미태리 샘플02점 > 까르보나라",
      item_code: "000623", item_name: "양송이 까르보나라", price: 8800, soldout_code: "7" },
    // 매장 대장에 없는 표기(폐점·이름 차이)도 한 줄 둡니다 — 그 줄이 화면에
    // 어떻게 보이는지가 이 데모의 확인 항목입니다.
    // 못 맞춘 매장은 실제로 **POS 원문 표기**가 그대로 뜹니다
    // (api_pos_menus 의 store 폴백이 store_name → pos_store_label 순서라서).
    // 정규화된 이름을 두면 실제와 다르게 보여 확인이 안 됩니다.
    { menu_item_id: 7, account: "굿모닝", hq_code: "HI5", large_code: "003", large_name: "매장(3채널)[단독/본사 메뉴 외]",
      store: "[폐점]미태리 샘플99점", store_matched: false, store_scope: "store",
      category: "[폐점]미태리 샘플99점 > 주류", item_code: "000701",
      item_name: "하우스 레드", price: 6000, soldout_code: "0" },
    { menu_item_id: 8, account: "굿모닝", hq_code: "HI5", large_code: "004", large_name: "미태리 직영점(4채널)",
      store: "전 매장 공통", store_matched: false, store_scope: "common",
      category: "직영 > 옵션", item_code: "000810", item_name: "매운맛", price: 0, soldout_code: "0" },
    // ↓ 같은 대분류 코드 004 인데 뜻이 다릅니다 (착한통신 = 26년 메뉴)
    { menu_item_id: 9, account: "착한통신", hq_code: "INY", large_code: "004", large_name: "본사(26년 메뉴)",
      store: "전 매장 공통", store_matched: false, store_scope: "common",
      category: "26년 > 파스타", item_code: "000210",
      item_name: "고기고기 분모자 파스타", price: 13800, soldout_code: "0" },
    { menu_item_id: 10, account: "착한통신", hq_code: "INY", large_code: "003", large_name: "매장(3채널)[단독/본사 메뉴 외]",
      store: "샘플03점", store_matched: true, store_scope: "store",
      category: "미태리 샘플03점 > 사이드", item_code: "000415",
      item_name: "감자튀김", price: 4000, soldout_code: "0" },
];
// SQL 의 mitaly_pos_store_name 과 같은 규칙 — '[폐점]미태리 고덕점' → '고덕점'.
// 고르개는 정규화된 이름을 보여주고 표는 원문을 보여주므로, 거를 때 둘 다 받습니다.
function demoPosStoreName(label) {
    return String(label || "").replace(/^\s*\[[^\]]*\]\s*/, "")
        .replace(/^미태리\s*/, "").trim();
}

// 변경 요청 ↔ 업무 연결.
// 한 건은 **미리 채워 둡니다** — 실행 이력은 실제로는 명령줄 도구
// (tools/pos_menu_record.py)가 남기는 것이라 웹만으로는 절대 안 생깁니다.
// 비워 두면 '이력' 단추와 이력 표가 데모에서 영영 안 보입니다.
// 나머지는 눌러서 만들어지는 것을 봅니다.
let demoPosRequests = [{
    id: 1, menu_item_id: 4, task_id: 6, change_type: "soldout", field: "품절여부",
    before_value: "1", after_value: "0", reason: "재고 들어옴 (데모 예시)",
    created_at: tsOffset(-2),
}];
let nextPosRequestId = 2;
let demoPosExecutions = [{
    execution_id: 1, request_id: 1, mode: "dry_run", ok: true,
    response_code: null, response_msg: null, verified_value: null,
    note: "보내지 않았습니다 — 담당자 입회 전 dry-run", executed_at: tsOffset(-1),
}];
let nextPosExecutionId = 2;

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

// ---- 과거 공문 아카이브 데모 (60_board_archive.sql) ----------------------
//
// 실제 반입분(138건)의 **성질 네 가지**가 화면에서 다 보이게 골랐습니다.
// 하나라도 빠지면 그 경우의 화면을 아무도 안 보게 됩니다:
//
//   ① OCR 로 뽑은 본문        — 본문 81%가 A4 이미지였습니다(source='OCR')
//   ② 문서번호가 없는 옛 공문 — 2024년 이전에는 체계 자체가 없었습니다(38건)
//   ③ 목록에 안 뜨는 글       — 실재하는데 게시판 목록에 없는 글(14건)
//   ④ 확인필요               — OCR 이 무너진 건(18건). 숨기지 않는 것이 요점
//
// 날짜는 relative 가 아니라 고정입니다 — 아카이브는 '지난 3년 5개월' 이라는
// 기간 자체가 정보라 오늘 기준으로 밀면 뜻이 없어집니다.
const DEMO_BOARD_NOTICES = [
    { article_no: 12, posted_on: "2023-05-18", list_no: "8",
      title: "샘플 사이드 3종 출시 및 중량 변경 안내의 건",
      doc_title: null, doc_no: null, verified: false,   // ② 옛 공문 — 번호 없음
      listed: true, need_review: false, source: "원본텍스트", views: 214,
      attachments: ["샘플_사이드3종_안내.pdf"],
      body: "안녕하세요. 점주님\n미태리 본사 ㈜샘플입니다.\n\n"
          + "1. 귀 점포의 무궁한 발전을 기원합니다.\n"
          + "2. 본사는 아래와 같이 사이드 메뉴 3종을 출시하오니 참고 바랍니다.\n"
          + "3. 출시 품목\n   ■ 샘플 갈릭브레드   · 판매가 4,000원\n"
          + "   ■ 샘플 치즈스틱     · 판매가 4,500원\n"
          + "   ■ 샘플 감자튀김     · 판매가 3,500원\n"
          + "4. 운영 안내\n   ※ 기존 사이드 재고 소진 후 전환 바랍니다.\n\n"
          + "이상 안내드리오니 협조 부탁드립니다.\n감사합니다." },

    { article_no: 96, posted_on: "2024-09-25", list_no: "61",
      title: "샘플 원산지 표기 변경 안내의 건",
      doc_title: null, doc_no: null, verified: false,
      listed: true, need_review: true, source: "OCR", views: 187,  // ④ 확인필요
      attachments: [],
      // 인식이 무너진 건이 화면에서 어떻게 보이는지 그대로 보여 줍니다.
      body: "샘플 가맹점 원산지 표기 변경 안내\n\n"
          + "원 산 지 표 기 는 아 래 와 같 이 변 경 됩 니 다\n"
          + "1 . 돼 지 고 기 : 국 내 산 → 국 내 산 · 수 입 산 혼 용\n"
          + "2 . 게 시 위 치 : 메 뉴 판 하 단\n"
          + "※ 이 본문은 인식이 무너진 예시입니다. 원문을 함께 보세요." },

    { article_no: 120, posted_on: "2025-02-27", list_no: "",
      title: "★★★샘플 우삼겹 짜파스타 출시 안내★★★",
      // ①·③ — OCR 본문이고 게시판 목록에는 안 뜨는 글
      doc_title: "샘플 가맹점 우삼겹 짜파스타 시즌 메뉴 안내 건",
      doc_no: "20250227_01", verified: true,
      listed: false, need_review: false, source: "원본텍스트+OCR", views: 302,
      attachments: ["우삼겹_짜파스타_조리매뉴얼.pdf", "우삼겹_POP.zip"],
      body: "문서번호 20250227-01                      2025년 02월 27일\n"
          + "수   신 : 미태리 전 가맹점\n발   신 : ㈜샘플\n"
          + "제   목 : 샘플 가맹점 우삼겹 짜파스타 시즌 메뉴 안내 건\n"
          + "────────────────────────────────\n"
          + "안녕하세요. 점주님\n미태리 본사 ㈜샘플입니다.\n\n"
          + "1. 귀 점포의 무궁한 발전을 기원합니다.\n"
          + "2. 시즌 메뉴 '우삼겹 짜파스타' 를 아래와 같이 출시합니다.\n"
          + "3. 판매 기간\n   ■ 2025-03-04 ~ 소진 시까지\n"
          + "4. 조리 안내\n   · 우삼겹 120g 을 선굽기 후 면과 함께 볶습니다.\n"
          + "   ※ 조리매뉴얼 첨부 참고.\n\n감사합니다.\n              ㈜샘플" },

    { article_no: 173, posted_on: "2026-03-25", list_no: "104",
      title: "샘플 배달앱 리뷰 이벤트 운영 안내의 건",
      doc_title: null, doc_no: "20260318_02", verified: false,   // 날짜 불일치 배지
      listed: true, need_review: false, source: "OCR", views: 156,
      attachments: ["리뷰이벤트_안내문.pdf"],
      // 줄바꿈 없이 통째로 오는 본문 — .ba-body 의 줄 접기가 필요한 경우입니다.
      body: "샘플 배달앱 리뷰 이벤트 운영 안내의 건 본사는 배달앱 리뷰 이벤트를"
          + " 아래와 같이 운영하오니 각 점포에서는 리뷰 이벤트 문구를 배달앱"
          + " 매장 소개란에 동일하게 등록하여 주시고 증정 품목은 본사 지정"
          + " 품목으로만 운영하여 주시기 바라며 임의 품목 운영 시 리뷰 이벤트"
          + " 대상에서 제외될 수 있음을 안내드립니다 문의는 운영지원팀으로"
          + " 연락 주시기 바랍니다 감사합니다" },

    { article_no: 221, posted_on: "2026-08-06", list_no: "108",
      title: "최신 표준 레시피 및 간편 레시피 배포 안내의 건",
      doc_title: "최신 표준 레시피 및 간편 레시피 배포 안내의 건",
      doc_no: "260806_01", verified: true,
      listed: true, need_review: false, source: "OCR", views: 88,
      attachments: ["[3세대]샘플 레시피북_260806.pdf", "[3세대]샘플 간편레시피_260806.pdf",
                    "[4세대]샘플 레시피북_260806.pdf", "[4세대]샘플 간편레시피_260806.pdf"],
      body: "문서번호 260806_01                        2026년 08월06일\n"
          + "수   신 : 미태리 전 가맹점\n발   신 : ㈜샘플\n"
          + "제   목 : 최신 표준 레시피 및 간편 레시피 배포 안내의 건\n"
          + "────────────────────────────────\n"
          + "안녕하세요. 점주님\n미태리 본사 ㈜샘플입니다.\n\n"
          + "1. 귀 점포의 무궁한 발전을 기원합니다.\n"
          + "2. 최신 표준 레시피를 아래와 같이 배포하오니 숙지 바랍니다.\n"
          + "3. 배포 자료\n   ■ 3세대 레시피북 / 간편레시피\n"
          + "   ■ 4세대 레시피북 / 간편레시피\n"
          + "4. 운영 안내\n   ※ 기존 레시피북은 폐기하여 주십시오.\n\n"
          + "감사합니다.\n              ㈜샘플" },
];

// api_board_notices — 검색은 제목·문서번호·공문제목·본문에서 찾습니다(60 과 동일).
function computeBoardNotices(pQ, pLimit) {
    const q = (pQ || "").trim().toLowerCase();
    const has = (v) => (v || "").toLowerCase().includes(q);
    const hit = DEMO_BOARD_NOTICES
        .filter((n) => !q || has(n.title) || has(n.doc_no) || has(n.doc_title) || has(n.body))
        .sort((a, b) => b.posted_on.localeCompare(a.posted_on) || (b.article_no - a.article_no));
    const dates = DEMO_BOARD_NOTICES.map((n) => n.posted_on).sort();

    return {
        total:       DEMO_BOARD_NOTICES.length,
        matched:     hit.length,
        need_review: DEMO_BOARD_NOTICES.filter((n) => n.need_review).length,
        unlisted:    DEMO_BOARD_NOTICES.filter((n) => !n.listed).length,
        with_doc_no: DEMO_BOARD_NOTICES.filter((n) => n.doc_no).length,
        span:        { from: dates[0], to: dates[dates.length - 1] },
        rows: hit.slice(0, pLimit || 60).map((n) => ({
            article_no: n.article_no, posted_on: n.posted_on, title: n.title,
            doc_title: n.doc_title, doc_no: n.doc_no, verified: n.verified,
            listed: n.listed, need_review: n.need_review, source: n.source,
            attachments: n.attachments,
            // SQL 의 left(regexp_replace(body,'\s+',' ','g'), 160) 과 같은 모양.
            excerpt: n.body.replace(/\s+/g, " ").slice(0, 160),
        })),
    };
}

// api_board_notice — 없는 글은 {found:false} 입니다(실제 함수와 같은 모양).
function computeBoardNotice(pArticleNo) {
    const n = DEMO_BOARD_NOTICES.find((x) => x.article_no === Number(pArticleNo));
    return n ? { ...n } : { found: false };
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
    // 실물 양식 스타일 픽스처(QUEUE #63) — 항목 "- ", 후속 조치 "ㄴ ",
    // 여러 줄. '보고 복사' 버튼이 만드는 텍스트가 실물 예시와 같은 모양인지
    // 데모에서 바로 확인하는 용도입니다.
    { id: 2, store: "샘플01점", visited_on: dateOffset(-8), visited_by: "박SV",
      hygiene_note: "- 냉동고 성에제거 미흡\nㄴ 성에제거 및 관리방법 교육 진행\n- 후드 청결작업 미흡\nㄴ 이전 방문 시 안내했으나 미진행",
      self_purchase_note: "- 특이사항 없음",
      cooking_note: "- 감바스 파스타 : 특이사항 없음\n- 페퍼로니 피자 : 도우 색 고르게 나오도록 체크, 토핑 넓게 교육",
      owner_meeting_note: "- 네이버 플레이스 광고 재진행\nㄴ 유입 감소로 재진행, 한 달 추이 확인 후 유지/변경 결정",
      special_note: "- 냉장고 소음 발생 — 확인 필요, 점주와 지속 소통 예정" },
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

// ---- 가맹점 DB 데모 (35_store_profiles.sql + 44_store_admin.sql) ----------
//
// 마지막 두 매장(샘플93·94점)은 일부러 프로필 없이 둡니다 — '프로필 없음'
// 표시와 빈 행 인라인 편집(저장이 곧 생성, upsert)이 화면에서 보이는지
// 확인용. 값들은 실제 DB 에 들어 있는 부류의 값입니다(분류 일반/자활 등) —
// 데모에만 있는 표기를 만들지 않습니다.
const DEMO_REGIONS = ["서울", "경기", "인천", "충청", "전라", "경상"];
const DEMO_POS = ["이지포스(굿모닝)", "이지포스(착한통신)", "아임유"];
const DEMO_ORDER = ["키오스크", "테이블오더", "대면"];
let storeProfiles = STORES.slice(0, -2).map((s, i) => ({
    store_id: s.id, store_name: s.name,
    category: i % 9 === 0 ? "자활" : "일반",
    sv_name: ["김SV", "박SV", "이SV", "최SV"][i % 4],
    region: DEMO_REGIONS[i % DEMO_REGIONS.length],
    order_method: DEMO_ORDER[i % DEMO_ORDER.length],
    pos: DEMO_POS[i % DEMO_POS.length],
    business_start_date: `20${19 + (i % 7)}-${String(1 + (i % 12)).padStart(2, "0")}-15`,
    imported_at: null, updated_at: null,
}));

// 채널별 계정 유무(44 api_account_presence). 실제 분포를 흉내 냅니다 —
// 배민·쿠팡이츠는 대부분, 요기요는 1/3쯤, 신규 채널은 소수. 마지막 두
// 매장은 계정이 하나도 없게 둬 '계정 없는 매장만' 필터가 보이게 합니다.
const AP_CHANNELS = ["배민", "쿠팡이츠", "요기요", "땡겨요", "위메프오", "먹깨비"];
function computeAccountPresence() {
    const stores = STORES.map((s, i) => {
        const has = {};
        if (i < STORES.length - 2) {
            if (i % 10 !== 3) has["배민"] = true;
            if (i % 5 !== 2) has["쿠팡이츠"] = true;
            if (i % 3 === 0) has["요기요"] = true;
            if (i % 12 === 1) has["땡겨요"] = true;
            if (i === 30) has["위메프오"] = true;
            if (i % 46 === 7) has["먹깨비"] = true;
        }
        return { store_id: s.id, store_name: s.name, has };
    }).sort((a, b) => a.store_name.localeCompare(b.store_name));
    const totals = {};
    for (const st of stores) {
        for (const ch of Object.keys(st.has)) totals[ch] = (totals[ch] || 0) + 1;
    }
    return { channels: AP_CHANNELS, stores, totals };
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

// ---- 업무 흐름 데모 (30_tasks.sql) ---------------------------------------
//
// 픽스처는 화면에서 확인해야 하는 것들이 한 번에 다 보이게 골랐습니다.
//   · 미처리(접수 후 기준일 초과) 건 — 홈 타일 숫자와 빨간 배지
//   · 승인 필요 종류(보상·감면)가 승인 대기에 걸려 있는 건 — D18
//   · 이관된 건 — "판단 불가 건은 담당 SV 이관"(운영 원칙)
// advance_task 의 거절 규칙도 여기 그대로 옮겨 뒀습니다. 화면이 규칙을
// 흉내내지 않고 함수의 사유를 그대로 보여주는지 확인하려면 데모 쪽도
// 똑같이 거절해야 하기 때문입니다.
function tsOffset(days) {
    return new Date(Date.now() + days * 86400_000).toISOString();
}

const DEMO_TASK_KINDS = [
    { kind: "inquiry", name: "가맹점 문의", needs_approval: false, enabled: true },
    { kind: "visit_followup", name: "방문·점검 후속", needs_approval: false, enabled: true },
    { kind: "compensation", name: "보상·감면", needs_approval: true, enabled: true },
    { kind: "notice_send", name: "공문·내용증명 발송", needs_approval: true, enabled: true },
    { kind: "receivable_notice", name: "미수 안내 발송", needs_approval: true, enabled: true },
    // 5번 영역. 품절은 저위험(자동) 후보로 올렸지만 담당자 확인 전까지는
    // 승인 필요로 둡니다 (50_pos_menu.sql 설계 판단 [1]).
    { kind: "pos_soldout", name: "POS 품절 처리·해제", needs_approval: true, enabled: true },
    { kind: "pos_menu_change", name: "POS 메뉴·가격 변경", needs_approval: true, enabled: true },
    { kind: "announcement_send", name: "공지 발송", needs_approval: true, enabled: true },
];

const DEMO_OVERDUE_DAYS = 7;   // task_settings 의 데모용 미러(실제 값은 표에 있음)

let demoTasks = [
    { id: 1, kind: "inquiry", title: "포스 영수증 출력 불량 문의", body: "용지를 갈아도 흐리게 나옵니다.",
      store: "샘플02점", source: "phone", status: "in_progress", assigned_to: "김SV",
      created_at: tsOffset(-11) },
    { id: 2, kind: "compensation", title: "배달 지연 보상 요청", body: "라이더 배차 지연 40분.",
      store: "샘플05점", source: "kakao", status: "waiting_approval", assigned_to: "박매니저",
      created_at: tsOffset(-9) },
    { id: 3, kind: "inquiry", title: "메뉴판 교체 일정 문의", body: null,
      store: "샘플11점", source: "web", status: "escalated", assigned_to: null,
      created_at: tsOffset(-3) },
    { id: 4, kind: "visit_followup", title: "냉장고 온도계 교체 필요", body: "방문점검 특이사항에서 이어짐.",
      store: "샘플07점", source: "auto", status: "received", assigned_to: null,
      created_at: tsOffset(-1) },
    { id: 5, kind: "inquiry", title: "영업시간 변경 신고", body: null,
      store: "샘플03점", source: "web", status: "done", assigned_to: "김SV",
      created_at: tsOffset(-20) },
    // POS 메뉴(5번)의 미리 채워 둔 요청과 짝입니다 — demoPosRequests 참조.
    // 승인까지 끝났고 실행은 dry-run 만 돌아서, 화면에 '실행 대기' 로 뜹니다.
    { id: 6, kind: "pos_soldout", title: "POS 품절 해제 — 샘플01점 · 토피넛 라떼",
      body: "품절여부 품절 → 정상\n상품코드 000334",
      store: "샘플01점", source: "web", status: "done", assigned_to: null,
      created_at: tsOffset(-2) },
    // 공지(12번)의 미리 채워 둔 건과 짝입니다 — demoAnnouncements 참조.
    { id: 7, kind: "announcement_send", title: "공지 발송 — 8월 오일데이 행사 안내 (전체 94곳)",
      body: "8/14(금) 오일데이 행사 안내입니다. 행사 포스터는 금주 중 발송됩니다.",
      store: null, source: "web", status: "waiting_approval", assigned_to: null,
      created_at: tsOffset(-1) },
];
let nextTaskId = 8;

let demoTaskEvents = [
    { id: 1, task_id: 1, from: "received", to: "in_progress", note: null,
      approval_kind: null, preauth_id: null, created_at: tsOffset(-10) },
    { id: 2, task_id: 2, from: "received", to: "waiting_approval", note: "금액 3만원",
      approval_kind: null, preauth_id: null, created_at: tsOffset(-8) },
    { id: 3, task_id: 3, from: "received", to: "escalated", note: "본사 기준 확인 필요 — 최SV",
      approval_kind: null, preauth_id: null, created_at: tsOffset(-2) },
    { id: 4, task_id: 5, from: "received", to: "done", note: null,
      approval_kind: null, preauth_id: null, created_at: tsOffset(-19) },
    { id: 5, task_id: 7, from: "received", to: "waiting_approval",
      note: "공지 접수에서 승인 요청 생성 (공지 #1)",
      approval_kind: null, preauth_id: null, created_at: tsOffset(-1) },
];
let nextTaskEventId = 6;

// 발송 승인 흐름 연결(39_notice_tasks.sql). 처음에는 비워 둡니다 —
// '발송 승인 요청' 버튼을 눌러 생기는 것까지가 화면 확인 대상입니다.
let demoNoticeSendTasks = [];

// 배달 지도 데모(6번, QUEUE #55). 경계는 데모에서도 진짜 파일
// (web/dong_boundaries.json)을 씁니다 — 예전에는 여기에 사각형 4개를 손으로
// 그려 뒀는데, 그건 '폴리곤이 그려지는가' 만 확인할 뿐 **코드로 경계를 찾는
// 진짜 사슬**을 하나도 안 봤습니다. 그래서 실제 법정동·행정동 코드를 씁니다.
//
// 화면에서 확인할 것 네 가지를 일부러 섞어 뒀습니다:
//   · 구로3동  — 행정동 코드가 경계에 그대로 있는 경우(1단 exact)
//   · 신림동   — **법정동** 코드라 그 코드의 경계가 없음 → 이름으로 찾아감
//   · 서원동   — 시군구 표기가 달라 추정으로 붙은 것(주황으로 보여야 함)
//   · (미상)   — 주소에서 동을 못 읽은 주문. 지도에 없고 숫자로만 보입니다.
const DEMO_DONG_ROWS = [
    { ym: 202607, store: "샘플01점", source: "배민", sido: "서울", sigungu: "구로구",
      dong: "구로3동", dong_code: "1153054000", match: "exact",
      orders: 610, amount: 12_800_000, delivery_fee: null },
    { ym: 202607, store: "샘플01점", source: "쿠팡이츠", sido: "서울", sigungu: "관악구",
      dong: "신림동", dong_code: "1162010200", match: "exact",
      orders: 1240, amount: 25_100_000, delivery_fee: null },
    { ym: 202607, store: "샘플02점", source: "요기요", sido: "서울", sigungu: "동작구",
      dong: "상도1동", dong_code: "1159053000", match: "exact",
      orders: 860, amount: 17_400_000, delivery_fee: null },
    { ym: 202607, store: "샘플02점", source: "땡겨요", sido: "서울", sigungu: "관악구",
      dong: "서원동", dong_code: "1162064500", match: "sido_dong",
      orders: 320, amount: 6_300_000, delivery_fee: null },
    { ym: 202607, store: "샘플02점", source: "배민", sido: "서울", sigungu: "관악구",
      dong: "없는동", dong_code: null, match: null,
      orders: 90, amount: 1_800_000, delivery_fee: null },
    { ym: 202607, store: "샘플01점", source: "배민", sido: "", sigungu: "",
      dong: "(미상)", dong_code: null, match: null,
      orders: 210, amount: 4_100_000, delivery_fee: null },
];

// 공지(12번, 53_announcements.sql). 한 건은 미리 채워 둡니다 — 승인 대기
// 업무 #7 과 짝. target_count 는 접수 시점 스냅샷이라 숫자로 저장합니다.
let demoAnnouncements = [{
    id: 1, title: "8월 오일데이 행사 안내",
    body: "8/14(금) 오일데이 행사 안내입니다. 행사 포스터는 금주 중 발송됩니다.",
    audience_kind: "all", audience_value: null, target_count: STORES.length,
    task_id: 7, created_at: tsOffset(-1),
    sent: 0, dry_run: 0, failed: 0, reads: 0,
}];
let nextAnnouncementId = 2;

let demoPreauths = [
    { id: 1, kind: "compensation", scope: "배달 지연 보상 3만원 이하",
      note: "3만원 이하 지연 보상은 승인된 내용입니다. 바로 처리하세요.",
      created_at: tsOffset(-5), revoked_at: null },
    { id: 2, kind: null, scope: "여름 성수기 위생용품 지원 (7월분)",
      note: "7월 한정 승인 건. 8월부터는 다시 결재.",
      created_at: tsOffset(-30), revoked_at: tsOffset(-2) },
];
let nextPreauthId = 3;

function taskIsOverdue(t) {
    return !["done", "rejected"].includes(t.status)
        && Date.now() - new Date(t.created_at).getTime() > DEMO_OVERDUE_DAYS * 86400_000;
}

function computeTasks({ p_status, p_store, p_limit }) {
    return demoTasks
        .filter((t) => (!p_status || t.status === p_status)
            && (!p_store || t.store === p_store))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || (b.id - a.id))
        .slice(0, p_limit || 200)
        .map((t) => ({
            task_id: t.id, kind: t.kind,
            kind_name: DEMO_TASK_KINDS.find((k) => k.kind === t.kind)?.name || t.kind,
            title: t.title, body: t.body,
            store_id: null, store_name: t.store,
            source: t.source, visit_id: null, status: t.status,
            assigned_to: t.assigned_to,
            created_at: t.created_at, updated_at: t.created_at,
            age_days: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400_000),
            overdue: taskIsOverdue(t),
        }));
}

function computeTasksSummary() {
    const byStatus = {};
    for (const t of demoTasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    return {
        by_status: byStatus,
        overdue: demoTasks.filter(taskIsOverdue).length,
        overdue_days: DEMO_OVERDUE_DAYS,
    };
}

const TASK_STATUSES = {
    received: 1, in_progress: 1, waiting_approval: 1, escalated: 1, done: 1, rejected: 1,
};

// 30_tasks.sql advance_task() 의 거절 규칙을 그대로 옮긴 것입니다.
function demoAdvanceTask({ p_task_id, p_to_status, p_note, p_preauth_id }) {
    const task = demoTasks.find((t) => t.id === Number(p_task_id));
    if (!task) return { ok: false, reason: "업무를 찾지 못했습니다" };
    if (["done", "rejected"].includes(task.status)) {
        return { ok: false, reason: "이미 끝난 업무입니다" };
    }
    if (!Object.prototype.hasOwnProperty.call(TASK_STATUSES, p_to_status)) {
        return { ok: false, reason: "모르는 상태입니다: " + (p_to_status || "(없음)") };
    }
    if (p_to_status === task.status) return { ok: false, reason: "이미 그 상태입니다" };

    if (p_preauth_id != null) {
        const preauth = demoPreauths.find((p) => p.id === Number(p_preauth_id));
        if (!preauth) return { ok: false, reason: "사전 고지를 찾지 못했습니다" };
        if (preauth.revoked_at) return { ok: false, reason: "이미 철회된 고지입니다" };
        if (preauth.kind && preauth.kind !== task.kind) {
            return { ok: false, reason: "이 업무 종류에 해당하는 고지가 아닙니다" };
        }
    }

    let approvalKind = null;
    if (p_to_status === "done"
        && DEMO_TASK_KINDS.find((k) => k.kind === task.kind)?.needs_approval) {
        if (task.status === "waiting_approval") {
            approvalKind = p_preauth_id == null ? "manual" : "preauthorized";
        } else if (p_preauth_id != null) {
            approvalKind = "preauthorized";
        } else {
            return { ok: false, reason:
                "승인이 필요한 업무입니다 — 승인 대기로 보내거나 사전 고지(D35)를 대세요" };
        }
    }

    const from = task.status;
    task.status = p_to_status;
    demoTaskEvents.push({
        id: nextTaskEventId++, task_id: task.id, from, to: p_to_status,
        note: (p_note || "").trim() || null,
        approval_kind: approvalKind,
        preauth_id: p_preauth_id == null ? null : Number(p_preauth_id),
        created_at: new Date().toISOString(),
    });
    return { ok: true, task_id: task.id, from, to: p_to_status, approval_kind: approvalKind };
}

// ---- AI 1차 응대 데모 (38_inquiry_answers.sql) ---------------------------
//
// 세 갈래가 한 화면에 다 보이게 골랐습니다: 검토 대기 초안 · 이관 판정 ·
// 이미 승인한 것. 근거(sources)에 발췌를 넣은 것은 cs-manual.md 제목이
// '슬라이드 N' 이라 제목만으로는 무엇을 봤는지 알 수 없기 때문입니다.
let demoInquiryAnswers = [
    {
        id: 1, task_id: 1, routing: "answer",
        rule_id: 8, rule_kind: "allow", rule_category: "매뉴얼 운영 질문",
        escalate_to: null,
        contents: "영수증이 흐리게 나오는 것은 대부분 감열지 방향이 뒤집혔거나 "
            + "프린터 헤드에 먼지가 앉은 경우입니다. 용지를 광택면이 위로 오게 "
            + "다시 넣어 보시고, 그래도 같으면 헤드를 마른 천으로 닦아 주세요. "
            + "두 가지로 해결되지 않으면 포스 점검을 접수해 드리겠습니다.",
        sources: [
            { doc: "cs-manual.md", heading: "슬라이드 12",
              excerpt: "실전 응대 매뉴얼 (전화·예약·배달·클레임 응대) 상황별 응대 지침" },
            { doc: "hall-kitchen-operations.md", heading: "오픈마감 매뉴얼",
              excerpt: "| 홀 오픈 및 마감 순서 및 체크리스트 | | | |" },
        ],
        model: "claude-sonnet-5", status: "draft", reject_reason: null,
        created_at: tsOffset(-0.2), reviewed_at: null,
    },
    {
        id: 2, task_id: 3, routing: "escalate",
        rule_id: 3, rule_kind: "block", rule_category: "계약·법무",
        escalate_to: "운영지원팀장",
        contents: null, sources: [], model: "claude-sonnet-5",
        status: "draft", reject_reason: null,
        created_at: tsOffset(-2.5), reviewed_at: null,
    },
    {
        id: 3, task_id: 5, routing: "answer",
        rule_id: 8, rule_kind: "allow", rule_category: "매뉴얼 운영 질문",
        escalate_to: null,
        contents: "영업시간 변경은 변경 예정일 7일 전까지 알려 주시면 "
            + "배달앱과 포스에 함께 반영해 드립니다.",
        sources: [{ doc: "cs-manual.md", heading: "슬라이드 7",
                    excerpt: "가맹점 요청 접수 및 처리 기준" }],
        model: "claude-sonnet-5", status: "approved", reject_reason: null,
        created_at: tsOffset(-19), reviewed_at: tsOffset(-18),
    },
];
let nextInquiryAnswerId = 4;

function demoInquiryRows({ p_status, p_routing, p_limit }) {
    return demoInquiryAnswers
        .filter((a) => (!p_status || a.status === p_status)
            && (!p_routing || a.routing === p_routing))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || (b.id - a.id))
        .slice(0, p_limit || 100)
        .map((a) => {
            const task = demoTasks.find((t) => t.id === a.task_id) || {};
            return {
                answer_id: a.id, task_id: a.task_id,
                task_title: task.title, task_body: task.body,
                task_status: task.status, store_name: task.store,
                source: task.source, received_at: task.created_at,
                routing: a.routing, rule_id: a.rule_id, rule_kind: a.rule_kind,
                rule_category: a.rule_category, escalate_to: a.escalate_to,
                contents: a.contents, sources: a.sources, model: a.model,
                status: a.status, reject_reason: a.reject_reason,
                created_at: a.created_at, reviewed_at: a.reviewed_at,
            };
        });
}

// ---- 정산 · 로열티 데모 (41_settlement.sql) -------------------------------
//
// 픽스처는 화면에서 확인해야 하는 상태가 한 번에 다 보이게 골랐습니다.
//   · 최신 달(202607)은 미청구 — '청구 생성·갱신' 버튼의 동작 확인용.
//     생성하면 납기(2026-08-01)가 이미 지나 전 매장이 미수로 잡힙니다 —
//     실제로도 청구를 늦게 만들면 그렇게 됩니다(버그 아님).
//   · 202606: 샘플05점 전액 미납 · 샘플11점 절반 입금(둘 다 미수), 나머지 완납
//   · 202605: 샘플07점 전액 미납(두 달 연체) — 미수 정렬·지연이자 확인
// 계산·거절 규칙은 41_settlement.sql 함수를 그대로 옮깁니다.

const DEMO_SETTLEMENT = { rate_pct: 3.3, due_day: 1, late_pct: 20 };  // settlement_settings 미러

let demoInvoices = [];          // {id, ym, store(이름), sales, amount, due_date, source}
let demoPayments = [];          // {id, invoice_id, paid_on, amount, note, source, canceled_at, canceled_note}
let demoSettleNoticeTasks = []; // {task_id, invoice_id, created_at}
let nextInvoiceId = 1;
let nextPaymentId = 1;

function demoDaysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function demoDueDate(ym) {
    const next = shiftYm(ym, 1);
    return `${String(next).slice(0, 4)}-${String(next).slice(4, 6)}-`
        + String(DEMO_SETTLEMENT.due_day).padStart(2, "0");
}

function demoStoreSales(ym, store) {
    const hall = demoAmountAt(ym, store, "홀");
    const delivery = demoAmountAt(ym, store, "배달");
    if (hall == null && delivery == null) return null;
    return (hall || 0) + (delivery || 0);
}

function demoPaidTotal(invoiceId) {
    return demoPayments
        .filter((p) => p.invoice_id === invoiceId && !p.canceled_at)
        .reduce((a, p) => a + p.amount, 0);
}

function demoMakeInvoice(ym, store) {
    const sales = demoStoreSales(ym, store);
    if (!sales) return null;
    const invoice = {
        id: nextInvoiceId++, ym, store: store.name, sales,
        amount: Math.round(sales * DEMO_SETTLEMENT.rate_pct / 100),
        due_date: demoDueDate(ym), source: "computed",
    };
    demoInvoices.push(invoice);
    return invoice;
}

// 202601~202606 청구 + 입금 픽스처 (202607 은 일부러 미청구로 비워 둡니다).
for (let fixtureYm = 202601; fixtureYm <= 202606; fixtureYm++) {
    for (const store of STORES) {
        const invoice = demoMakeInvoice(fixtureYm, store);
        if (!invoice) continue;
        const unpaid = (fixtureYm === 202606 && store.name === "샘플05점")
            || (fixtureYm === 202605 && store.name === "샘플07점");
        if (unpaid) continue;
        const half = fixtureYm === 202606 && store.name === "샘플11점";
        demoPayments.push({
            id: nextPaymentId++, invoice_id: invoice.id, paid_on: invoice.due_date,
            amount: half ? Math.round(invoice.amount / 2) : invoice.amount,
            note: half ? "CMS 부분 이체" : null, source: "hq",
            canceled_at: null, canceled_note: null,
        });
    }
}

// api_royalty_month 와 같은 모양(jsonb 스칼라 → 객체 그대로).
function computeRoyaltyMonth(p_ym) {
    const today = dateOffset(0);
    const invByStore = new Map(
        demoInvoices.filter((i) => i.ym === p_ym).map((i) => [i.store, i]));

    const rows = [];
    for (const store of STORES) {
        const sales = demoStoreSales(p_ym, store);
        const invoice = invByStore.get(store.name) || null;
        if (!sales && !invoice) continue;
        const paid = invoice ? demoPaidTotal(invoice.id) : 0;
        const outstanding = invoice ? invoice.amount - paid : null;
        const overdue = invoice && today > invoice.due_date;
        rows.push({
            store_id: store.id, store: store.name, trade_area: store.trade_area,
            sales_amount: sales,
            invoice_id: invoice ? invoice.id : null,
            source: invoice ? invoice.source : null,
            billed_sales: invoice ? invoice.sales : null,
            billed_amount: invoice ? invoice.amount : null,
            rate_pct: invoice ? DEMO_SETTLEMENT.rate_pct : null,
            due_date: invoice ? invoice.due_date : null,
            paid_amount: paid,
            outstanding,
            payments: invoice
                ? demoPayments.filter((p) => p.invoice_id === invoice.id)
                    .map((p) => ({ payment_id: p.id, paid_on: p.paid_on, amount: p.amount,
                                   note: p.note, source: p.source, canceled: !!p.canceled_at }))
                : [],
            status: !invoice ? "미청구"
                : outstanding <= 0 ? "완납"
                : !overdue ? (paid > 0 ? "부분 입금" : "기한 전")
                : "미수",
            overdue_days: overdue ? demoDaysBetween(invoice.due_date, today) : 0,
        });
    }
    rows.sort((a, b) =>
        (Number(b.status === "미수") - Number(a.status === "미수"))
        || ((b.outstanding ?? -1) - (a.outstanding ?? -1))
        || a.store.localeCompare(b.store));

    const billed = rows.filter((r) => r.invoice_id != null);
    return {
        ym: p_ym,
        rate_pct: DEMO_SETTLEMENT.rate_pct,
        due_date: demoDueDate(p_ym),
        stores: rows,
        totals: {
            sales: rows.reduce((a, r) => a + (r.sales_amount || 0), 0),
            billed: billed.reduce((a, r) => a + r.billed_amount, 0),
            paid: rows.reduce((a, r) => a + r.paid_amount, 0),
            outstanding: rows.reduce((a, r) => a + Math.max(r.outstanding || 0, 0), 0),
            stores: rows.length,
            billed_stores: billed.length,
            unbilled_stores: rows.length - billed.length,
            overdue_stores: rows.filter((r) => r.status === "미수").length,
        },
    };
}

// api_royalty_receivables 와 같은 모양 + 같은 판정(납기 경과 · 입금 부족).
function computeReceivables() {
    const today = dateOffset(0);
    const items = demoInvoices
        .map((invoice) => {
            const paid = demoPaidTotal(invoice.id);
            const outstanding = invoice.amount - paid;
            if (outstanding <= 0 || invoice.due_date >= today) return null;
            const overdueDays = demoDaysBetween(invoice.due_date, today);
            const link = demoSettleNoticeTasks
                .filter((n) => n.invoice_id === invoice.id)
                .map((n) => ({ ...n,
                    status: (demoTasks.find((t) => t.id === n.task_id) || {}).status }))
                .filter((n) => n.status !== "rejected")
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
            return {
                invoice_id: invoice.id, ym: invoice.ym,
                store_id: (STORES.find((s) => s.name === invoice.store) || {}).id ?? null,
                store: invoice.store,
                amount: invoice.amount, paid_amount: paid, outstanding,
                due_date: invoice.due_date, overdue_days: overdueDays,
                late_interest_est: Math.floor(
                    outstanding * DEMO_SETTLEMENT.late_pct / 100 * overdueDays / 365),
                notice_task_id: link ? link.task_id : null,
                notice_task_status: link ? link.status : null,
                notice_created_at: link ? link.created_at : null,
            };
        })
        .filter(Boolean)
        .sort((a, b) => (b.overdue_days - a.overdue_days) || (b.outstanding - a.outstanding));
    return {
        late_interest_pct_year: DEMO_SETTLEMENT.late_pct,
        items,
        totals: {
            count: items.length,
            outstanding: items.reduce((a, x) => a + x.outstanding, 0),
        },
    };
}

const HANDLERS = {
    // 매장 좌표 (63_store_points). 마커가 폴리곤 위에 뜨는지와, **좌표가 없는
    // 매장이 있을 때 안내가 나오는지**를 같이 봅니다 — 샘플02점은 일부러
    // 좌표를 안 줍니다(주문은 있는데 마커가 없는 경우).
    api_store_points: () => ({
        count: 1,
        rows: [
            { store_id: 1, store: "샘플01점", lat: 37.4954, lng: 126.9295,
              sido: "서울", sigungu: "관악구", dong: "신림동", confidence: "road_addr" },
        ],
    }),

    // 배달 지도 (QUEUE #55, 54_dong_agg + 61_dong_alias). 합계는 행에서 세어
    // 두 숫자가 어긋나지 않게 합니다 — 커버리지 표시가 이 합에 걸립니다.
    // 기간·매장 인자를 실제 함수처럼 거릅니다(S17) — 지도 카드의 자체 고르개가
    // 데모에서도 화면을 실제로 바꿔야 확인이 됩니다. 데모 행이 전부 202607 이라
    // 다른 달을 고르면 '집계 있는 달' 안내까지 그대로 시험됩니다.
    api_dong_month: (args = {}) => {
        const rows = DEMO_DONG_ROWS.filter((r) =>
            (!args.p_from || r.ym >= args.p_from)
            && (!args.p_to || r.ym <= args.p_to)
            && (!args.p_store || r.store === args.p_store));
        return {
            summary: {
                orders: rows.reduce((a, r) => a + r.orders, 0),
                amount: rows.reduce((a, r) => a + r.amount, 0),
                unknown_orders: rows
                    .filter((r) => r.dong === "(미상)").reduce((a, r) => a + r.orders, 0),
                unmatched_orders: rows
                    .filter((r) => r.dong !== "(미상)" && !r.dong_code)
                    .reduce((a, r) => a + r.orders, 0),
                inferred_orders: rows
                    .filter((r) => r.match === "sido_dong").reduce((a, r) => a + r.orders, 0),
                dongs: new Set(rows.filter((r) => r.dong !== "(미상)")
                    .map((r) => `${r.sigungu}|${r.dong}`)).size,
            },
            rows,
        };
    },

    // 배달앱 메뉴 대조 (QUEUE #61, 57_delivery_menu.sql). 종류 4가지가 화면에
    // 어떻게 갈려 보이는지가 이 픽스처의 확인 항목이라 종류마다 한 줄 이상 둡니다.
    // 값은 2026-08-07 dev 실측(고척점·부안점·구월힐캐슬점)에서 가져온 모양입니다.
    api_delivery_menu_check: () => ({
        collected_at: new Date().toISOString(),
        stores: 3,
        menus: 190,
        // 배달 가격 채널이 아직 안 정해졌다는 표시 — 화면 안내가 여기에 걸립니다.
        price_channel_set: false,
        counts: { app_only: 3, hidden: 2, channel_gap: 2, price_diff: 2 },
        items: [
            { kind: "app_only", store: "미태리 샘플01점", platform: "baemin",
              menu_name: "사이드 한판 샘플러", category: "[사이드ㅣ 같이 먹기 좋은 메뉴]",
              price: 7800, pos_price: null, hidden: false },
            { kind: "app_only", store: "미태리 샘플01점", platform: "baemin",
              menu_name: "스테이크 홈파티 세트", category: "[세트메뉴 ㅣ 가성비 BEST]",
              price: 67800, pos_price: null, hidden: false },
            { kind: "app_only", store: "미태리 샘플02점", platform: "yogiyo",
              menu_name: "고구마프라이즈", category: "Side 메뉴",
              price: 4800, pos_price: null, hidden: true },
            { kind: "hidden", store: "미태리 샘플01점", platform: "baemin",
              menu_name: "미태리 가든 샐러드", category: "[사이드ㅣ 같이 먹기 좋은 메뉴]",
              price: 7900, pos_price: null, hidden: true },
            { kind: "hidden", store: "미태리 샘플02점", platform: "yogiyo",
              menu_name: "오징어링(5ea)", category: "Side 메뉴",
              price: 4000, pos_price: null, hidden: true },
            { kind: "channel_gap", store: "미태리 샘플01점", platform: "yogiyo",
              menu_name: "[NEW]머쉬룸 바질 리조또", category: "신메뉴",
              price: 13800, pos_price: null, hidden: false },
            { kind: "channel_gap", store: "미태리 샘플01점", platform: "baemin",
              menu_name: "라구 파스타", category: "[토마토 ㅣ 클래식]",
              price: 11800, pos_price: null, hidden: false },
            { kind: "price_diff", store: "미태리 샘플03점", platform: "yogiyo",
              menu_name: "치킨 부리또", category: "부리또",
              price: 9800, pos_price: 7900, hidden: false },
            { kind: "price_diff", store: "미태리 샘플03점", platform: "baemin",
              menu_name: "떡볶이 치킨 그라탕", category: "매장 요청",
              price: 10300, pos_price: 8800, hidden: false },
        ],
    }),

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

    // ---- 발송 승인 흐름 (39_notice_tasks.sql) — 함수의 거절 규칙 그대로 ----
    api_notice_send_tasks: () => demoNoticeSendTasks.map((n) => ({
        violation_id: n.violation_id, stage: n.stage, task_id: n.task_id,
        task_status: (demoTasks.find((t) => t.id === n.task_id) || {}).status,
        created_at: n.created_at,
    })),
    create_notice_send_task: ({ p_event_id }) => {
        const row = computeNoticeStatus(null).find((r) => r.event_id === Number(p_event_id));
        if (!row) {
            return { ok: false, reason: "진행 중인 위반이 아닙니다 (이미 종료됐거나 없는 건입니다)" };
        }
        if (!row.stage) {
            return { ok: false, reason: "아직 발송 단계에 도달하지 않았습니다 — 판정 단계가 0입니다" };
        }
        const live = demoNoticeSendTasks.find((n) =>
            n.violation_id === Number(p_event_id) && n.stage === row.stage
            && (demoTasks.find((t) => t.id === n.task_id) || {}).status !== "rejected");
        if (live) {
            return { ok: false, reason: "이미 승인 흐름에 있는 건입니다",
                     task_id: live.task_id };
        }
        const taskId = nextTaskId++;
        demoTasks.push({
            id: taskId, kind: "notice_send",
            title: `내용증명 ${row.stage}단계 발송 — ${row.store_name} · ${row.violation_type}`,
            body: `판정: ${row.stage_label || row.stage + "단계"} (발생일 ${row.occurred_on}`
                + ` · 경과 ${row.days_elapsed}일 · 누적 ${row.total_occurrences}회)`
                + (row.requires_legal_review ? "\n⚠️ 법무 검토 필요 단계입니다 — 승인 전에 법무 확인을 받으세요." : "")
                + (row.needs_manual_review ? `\n⚠️ 담당자 확인 필요: ${row.manual_review_reason || ""}` : ""),
            store: row.store_name, source: "web", status: "waiting_approval",
            assigned_to: null, created_at: new Date().toISOString(),
        });
        demoTaskEvents.push({
            id: nextTaskEventId++, task_id: taskId,
            from: "received", to: "waiting_approval",
            note: `내용증명 판정에서 승인 요청 생성 (위반 #${p_event_id})`,
            approval_kind: null, preauth_id: null,
            created_at: new Date().toISOString(),
        });
        demoNoticeSendTasks.push({ violation_id: Number(p_event_id), stage: row.stage,
                                   task_id: taskId, created_at: new Date().toISOString() });
        return { ok: true, task_id: taskId, stage: row.stage };
    },

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

    // 60_board_archive.sql — 둘 다 jsonb 스칼라라 감싸지 않고 그대로 돌려줍니다.
    api_board_notices: ({ p_q, p_limit }) => computeBoardNotices(p_q, p_limit),
    api_board_notice: ({ p_article_no }) => computeBoardNotice(p_article_no),

    api_store_visits: ({ p_store, p_limit }) => computeStoreVisits(p_store || null, p_limit),

    // 34_account_health.sql — jsonb 스칼라라 객체를 그대로 돌려줍니다.
    // 세 상태(ok/warn/fail)가 화면에서 어떻게 보이는지 다 섞어 뒀습니다.
    api_account_health: () => ({
        run_id: 1,
        started_at: new Date(Date.now() - 7200_000).toISOString(),
        finished_at: new Date(Date.now() - 7100_000).toISOString(),
        note: "ok 3 · warn 2 · fail 1",
        results: [
            { channel: "easypos", account: "굿모닝", store: "",
              status: "ok", detail: "로그인 성공 (코드 0)",
              checked_at: new Date(Date.now() - 7150_000).toISOString() },
            { channel: "easypos", account: "착한통신", store: "",
              status: "warn",
              detail: "로그인 성공 · 코드 5636 (비밀번호 정책 경고 — 곧 만료될 수 있음)",
              checked_at: new Date(Date.now() - 7150_000).toISOString() },
            { channel: "baemin", account: "", store: "샘플01점",
              status: "ok", detail: "로그인 성공",
              checked_at: new Date(Date.now() - 7140_000).toISOString() },
            { channel: "yogiyo", account: "", store: "샘플02점",
              status: "ok", detail: "로그인 성공 · 매장 1개",
              checked_at: new Date(Date.now() - 7130_000).toISOString() },
            { channel: "coupangeats", account: "", store: "샘플03점",
              status: "warn",
              detail: "로그인 성공 · 단, ID 가 계정표에 숫자 서식 (앞자리 0 소실 위험)",
              checked_at: new Date(Date.now() - 7120_000).toISOString() },
            { channel: "imu", account: "", store: "",
              status: "fail", detail: "로그인은 됐지만 조회 화면 진입 실패",
              checked_at: new Date(Date.now() - 7110_000).toISOString() },
        ],
    }),

    // 가맹점DB 반입분(35_store_profiles.sql). 가맹점 DB 관리 화면이 전 열을
    // 쓰므로 storeProfiles(위 픽스처)를 그대로 내려줍니다. 방문·점검 화면의
    // SV 필터도 같은 데이터를 씁니다.
    api_store_profiles: () => storeProfiles.map((p) => ({ ...p })),

    // 44_store_admin.sql — 인라인 수정 저장. 실제 함수처럼 upsert 입니다
    // (프로필 없는 매장의 저장이 곧 생성).
    save_store_profile: (args) => {
        const store = STORES.find((s) => s.id === Number(args.p_store_id));
        if (!store) return { ok: false, reason: "그런 매장이 없습니다" };
        const values = {
            category: args.p_category || null,
            sv_name: args.p_sv_name || null,
            region: args.p_region || null,
            order_method: args.p_order_method || null,
            pos: args.p_pos || null,
            business_start_date: args.p_business_start_date || null,
        };
        const row = storeProfiles.find((p) => p.store_id === store.id);
        if (row) Object.assign(row, values, { updated_at: new Date().toISOString() });
        else storeProfiles.push({ store_id: store.id, store_name: store.name,
                                  ...values, imported_at: null,
                                  updated_at: new Date().toISOString() });
        return { ok: true, store_id: store.id, store_name: store.name };
    },

    // 44_store_admin.sql — 신규 매장 등록. stores 에도 넣어 매장 select
    // (방문·수집 화면)에 같이 나타나게 합니다. weight 0 = 매출 이력 0.
    register_store: (args) => {
        const name = (args.p_name || "").trim();
        if (!name) return { ok: false, reason: "매장 이름이 비어 있습니다" };
        if (STORES.some((s) => s.name === name)) {
            return { ok: false, reason: `이미 있는 매장입니다: ${name}` };
        }
        const id = Math.max(...STORES.map((s) => s.id)) + 1;
        STORES.push({ id, name, trade_area: null, weight: 0 });
        storeProfiles.push({
            store_id: id, store_name: name,
            category: args.p_category || null,
            sv_name: args.p_sv_name || null,
            region: args.p_region || null,
            order_method: args.p_order_method || null,
            pos: args.p_pos || null,
            business_start_date: args.p_business_start_date || null,
            imported_at: null, updated_at: new Date().toISOString(),
        });
        return { ok: true, store_id: id, store_name: name };
    },

    // 44_store_admin.sql — 채널별 계정 유무(아이디·비밀번호 없음).
    api_account_presence: () => computeAccountPresence(),

    api_store_lifecycle: ({ p_store, p_limit }) => computeStoreLifecycle(p_store || null, p_limit),
    api_store_lifecycle_status: ({ p_status }) => computeLifecycleStatus(p_status || null),
    api_store_lifecycle_summary: ({ p_year }) => computeLifecycleSummary(p_year || null),

    api_tasks: (args) => computeTasks(args),
    api_tasks_summary: () => computeTasksSummary(),
    api_task_events: ({ p_task_id }) => demoTaskEvents
        .filter((e) => e.task_id === Number(p_task_id))
        .sort((a, b) => a.id - b.id)
        .map((e) => ({
            event_id: e.id, from: e.from, to: e.to, note: e.note,
            approval_kind: e.approval_kind, preauth_id: e.preauth_id,
            preauth_scope: demoPreauths.find((p) => p.id === e.preauth_id)?.scope || null,
            created_at: e.created_at,
        })),
    advance_task: (args) => demoAdvanceTask(args),

    // 53_announcements.sql — 공지 접수·목록 (12번). 승인 상태는 업무에서
    // 실시간으로 읽습니다 — 승인하면 목록의 상태 태그가 같이 바뀝니다.
    api_announcements: () => demoAnnouncements
        .map((a) => ({
            ...a,
            task_status: (demoTasks.find((t) => t.id === a.task_id) || {}).status
                || "waiting_approval",
        }))
        .sort((a, b) => b.id - a.id),

    create_announcement: (args) => {
        const title = (args.p_title || "").trim();
        const body = (args.p_body || "").trim();
        const kind = args.p_audience_kind;
        const value = (args.p_audience_value || "").trim() || null;
        if (!title || !body) return { ok: false, reason: "제목과 본문을 채워 주세요" };
        if (!["all", "region", "sv", "stores"].includes(kind)) {
            return { ok: false, reason: `대상 종류가 올바르지 않습니다: ${kind || "(없음)"}` };
        }
        if ((kind === "region" || kind === "sv") && !value) {
            return { ok: false, reason: "지역 또는 담당 SV 를 골라 주세요" };
        }
        let count = 0;
        if (kind === "all") count = STORES.length;
        else if (kind === "stores") count = (args.p_store_ids || []).length;
        else {
            const key = kind === "region" ? "region" : "sv_name";
            count = storeProfiles.filter((p) => p[key] === value).length;
        }
        if (!count) return { ok: false, reason: "대상 매장이 없습니다 — 대상을 다시 골라 주세요" };
        const label = kind === "all" ? "전체" : kind === "region" ? `지역 ${value}`
            : kind === "sv" ? `SV ${value}` : "선택 매장";
        const taskId = nextTaskId++;
        demoTasks.push({
            id: taskId, kind: "announcement_send",
            title: `공지 발송 — ${title} (${label} ${count}곳)`,
            body, store: null, source: "web", status: "waiting_approval",
            assigned_to: null, created_at: new Date().toISOString(),
        });
        demoTaskEvents.push({
            id: nextTaskEventId++, task_id: taskId,
            from: "received", to: "waiting_approval",
            note: `공지 접수에서 승인 요청 생성 (공지 #${nextAnnouncementId})`,
            approval_kind: null, preauth_id: null,
            created_at: new Date().toISOString(),
        });
        const annId = nextAnnouncementId++;
        demoAnnouncements.push({
            id: annId, title, body, audience_kind: kind, audience_value: value,
            target_count: count, task_id: taskId,
            created_at: new Date().toISOString(),
            sent: 0, dry_run: 0, failed: 0, reads: 0,
        });
        return { ok: true, announcement_id: annId, task_id: taskId, target_count: count };
    },

    api_inquiry_answers: (args) => demoInquiryRows(args),
    api_inquiry_answer_summary: () => {
        const byStatus = {};
        for (const a of demoInquiryAnswers) {
            byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        }
        const answered = demoInquiryAnswers.filter((a) => a.routing === "answer").length;
        return {
            by_status: byStatus,
            pending: demoInquiryAnswers.filter(
                (a) => a.status === "draft" && a.routing === "answer").length,
            escalated: demoInquiryAnswers.filter((a) => a.routing === "escalate").length,
            answer_rate: demoInquiryAnswers.length
                ? Math.round(1000 * answered / demoInquiryAnswers.length) / 10 : null,
        };
    },
    // 38_inquiry_answers.sql 의 거절 조건을 그대로 옮긴 것입니다.
    approve_inquiry_answer: ({ p_answer_id }) => {
        const row = demoInquiryAnswers.find((a) => a.id === Number(p_answer_id));
        if (!row) return { ok: false, reason: "답변을 찾지 못했습니다" };
        if (row.status !== "draft") {
            return { ok: false, reason: `검토를 마친 답변입니다 (지금 상태: ${row.status})` };
        }
        if (row.routing !== "answer") {
            return { ok: false, reason: "이관으로 판정된 건입니다 — 업무 목록에서 이관으로 넘기세요" };
        }
        row.status = "approved";
        row.reviewed_at = new Date().toISOString();
        return { ok: true, status: "approved" };
    },
    reject_inquiry_answer: ({ p_answer_id, p_reason }) => {
        const row = demoInquiryAnswers.find((a) => a.id === Number(p_answer_id));
        if (!row) return { ok: false, reason: "답변을 찾지 못했습니다" };
        if (row.status === "sent") return { ok: false, reason: "이미 나간 답변입니다" };
        if (row.status === "rejected") return { ok: false, reason: "이미 반려한 답변입니다" };
        row.status = "rejected";
        row.reject_reason = (p_reason || "").trim() || null;
        row.reviewed_at = new Date().toISOString();
        return { ok: true, status: "rejected" };
    },
    edit_inquiry_answer: ({ p_answer_id, p_contents }) => {
        const row = demoInquiryAnswers.find((a) => a.id === Number(p_answer_id));
        if (!row) return { ok: false, reason: "답변을 찾지 못했습니다" };
        if (!["draft", "approved"].includes(row.status)) {
            return { ok: false, reason: `고칠 수 없는 상태입니다 (지금 상태: ${row.status})` };
        }
        const text = (p_contents || "").trim();
        if (!text) return { ok: false, reason: "내용이 비어 있습니다" };
        if (text.length > 4000) return { ok: false, reason: "너무 깁니다(4000자 초과)" };
        row.contents = text;
        row.routing = "answer";
        row.status = "draft";
        row.reject_reason = null;
        row.reviewed_at = null;
        return { ok: true, status: "draft" };
    },
    revoke_task_preauthorization: ({ p_preauth_id }) => {
        const preauth = demoPreauths.find((p) => p.id === Number(p_preauth_id));
        if (!preauth) return { ok: false, reason: "고지를 찾지 못했습니다" };
        if (preauth.revoked_at) return { ok: false, reason: "이미 철회된 고지입니다" };
        preauth.revoked_at = new Date().toISOString();
        return { ok: true, preauth_id: preauth.id };
    },

    // ---- 정산 · 로열티 (41_settlement.sql) — 함수 규칙 그대로 ----
    api_royalty_month: ({ p_ym }) => computeRoyaltyMonth(Number(p_ym)),
    api_royalty_receivables: () => computeReceivables(),

    generate_royalty_invoices: ({ p_ym }) => {
        const ym = Number(p_ym);
        if (!ym || ym < 200001 || ym > 209912 || ym % 100 < 1 || ym % 100 > 12) {
            return { ok: false, reason: `연월(YYYYMM)이 이상합니다: ${p_ym || "(없음)"}` };
        }
        let written = 0;
        let removed = 0;
        for (const store of STORES) {
            const sales = demoStoreSales(ym, store);
            const invoice = demoInvoices.find((i) => i.ym === ym && i.store === store.name);
            if (sales) {
                if (!invoice) {
                    demoMakeInvoice(ym, store);
                    written += 1;
                } else if (invoice.source === "computed") {
                    invoice.sales = sales;
                    invoice.amount = Math.round(sales * DEMO_SETTLEMENT.rate_pct / 100);
                    invoice.due_date = demoDueDate(ym);
                    written += 1;
                }
            } else if (invoice && invoice.source === "computed"
                       && !demoPayments.some((p) => p.invoice_id === invoice.id && !p.canceled_at)) {
                demoInvoices = demoInvoices.filter((i) => i !== invoice);
                removed += 1;
            }
        }
        return {
            ok: true, ym,
            stores: STORES.filter((s) => demoStoreSales(ym, s)).length,
            written, removed,
            hq_kept: demoInvoices.filter((i) => i.ym === ym && i.source === "hq").length,
            rate_pct: DEMO_SETTLEMENT.rate_pct, due_date: demoDueDate(ym),
        };
    },

    record_royalty_payment: ({ p_invoice_id, p_paid_on, p_amount, p_note }) => {
        const invoice = demoInvoices.find((i) => i.id === Number(p_invoice_id));
        if (!invoice) return { ok: false, reason: "청구를 찾지 못했습니다" };
        if (!p_paid_on) return { ok: false, reason: "입금일을 입력하세요" };
        const amount = Number(p_amount);
        if (!amount || amount <= 0) return { ok: false, reason: "금액은 0보다 커야 합니다" };
        demoPayments.push({
            id: nextPaymentId++, invoice_id: invoice.id, paid_on: p_paid_on,
            amount, note: (p_note || "").trim() || null, source: "web",
            canceled_at: null, canceled_note: null,
        });
        const paid = demoPaidTotal(invoice.id);
        return { ok: true, payment_id: nextPaymentId - 1,
                 paid_total: paid, outstanding: invoice.amount - paid };
    },

    cancel_royalty_payment: ({ p_payment_id, p_note }) => {
        const payment = demoPayments.find((p) => p.id === Number(p_payment_id));
        if (!payment) return { ok: false, reason: "입금 기록을 찾지 못했습니다" };
        if (payment.canceled_at) return { ok: false, reason: "이미 취소된 기록입니다" };
        payment.canceled_at = new Date().toISOString();
        payment.canceled_note = (p_note || "").trim() || null;
        return { ok: true, payment_id: payment.id };
    },

    request_receivable_notice: ({ p_invoice_id }) => {
        const invoice = demoInvoices.find((i) => i.id === Number(p_invoice_id));
        if (!invoice) return { ok: false, reason: "청구를 찾지 못했습니다" };
        const paid = demoPaidTotal(invoice.id);
        const outstanding = invoice.amount - paid;
        if (outstanding <= 0) return { ok: false, reason: "미수가 없는 청구입니다" };
        const today = dateOffset(0);
        if (invoice.due_date >= today) {
            return { ok: false, reason: `아직 납기(${invoice.due_date})가 지나지 않았습니다` };
        }
        const live = demoSettleNoticeTasks.find((n) => n.invoice_id === invoice.id
            && (demoTasks.find((t) => t.id === n.task_id) || {}).status !== "rejected");
        if (live) {
            return { ok: false, reason: "이미 승인 흐름에 있는 건입니다", task_id: live.task_id };
        }
        const over = demoDaysBetween(invoice.due_date, today);
        const est = Math.floor(outstanding * DEMO_SETTLEMENT.late_pct / 100 * over / 365);
        const label = `${String(invoice.ym).slice(0, 4)}.${String(invoice.ym).slice(4, 6)}`;
        const taskId = nextTaskId++;
        demoTasks.push({
            id: taskId, kind: "receivable_notice",
            title: `미수 안내 발송 — ${invoice.store} · ${label}분 로열티`,
            body: `청구 ${invoice.amount}원 · 입금 ${paid}원 · 미수 ${outstanding}원\n`
                + `납기 ${invoice.due_date} (경과 ${over}일)\n`
                + `지연이자 참고 ${est}원 (연 ${DEMO_SETTLEMENT.late_pct}%, 실제 부과는 본사 결정)`,
            store: invoice.store, source: "web", status: "waiting_approval",
            assigned_to: null, created_at: new Date().toISOString(),
        });
        demoTaskEvents.push({
            id: nextTaskEventId++, task_id: taskId, from: "received", to: "waiting_approval",
            note: `미수 판정에서 승인 요청 생성 (청구 #${invoice.id})`,
            approval_kind: null, preauth_id: null, created_at: new Date().toISOString(),
        });
        demoSettleNoticeTasks.push({ task_id: taskId, invoice_id: invoice.id,
                                     created_at: new Date().toISOString() });
        return { ok: true, task_id: taskId, outstanding };
    },

    // 44_store_contacts.sql — 게이트 암호는 배달앱 계정과 같은 demo1234.
    api_store_contacts_summary: () => ({
        stores_with_contacts: demoContacts.length,
        last_imported_at: new Date(Date.now() - 43200_000).toISOString(),
    }),
    api_store_contacts: ({ p_passcode, p_store }) => {
        if (p_passcode !== "demo1234") {
            return { ok: false, error: "암호가 올바르지 않습니다 (데모: demo1234)" };
        }
        const rows = demoContacts.filter((c) => !p_store || c.store_name === p_store);
        return { ok: true, contacts: rows.map((c) => ({ ...c })) };
    },
    save_store_contact: (args) => {
        if (args.p_passcode !== "demo1234") {
            return { ok: false, error: "암호가 올바르지 않습니다" };
        }
        let row = demoContacts.find((c) => c.store_name === args.p_store);
        if (!row) {
            row = { store_id: 100 + demoContacts.length, store_name: args.p_store };
            demoContacts.push(row);
        }
        Object.assign(row, {
            owner_name: args.p_owner_name, owner_phone: args.p_owner_phone,
            operator_name: args.p_operator_name, operator_phone: args.p_operator_phone,
            store_phone: args.p_store_phone, email: args.p_email,
            address: args.p_address, business_number: args.p_business_number,
            contract_period: args.p_contract_period, transfer_note: args.p_transfer_note,
            updated_at: new Date().toISOString(),
        });
        return { ok: true, store: args.p_store };
    },

    // 31_notifications.sql — 발송 이력. 세 상태(dry_run/sent/failed)가 화면에서
    // 어떻게 보이는지 다 섞어 뒀습니다(2026-08-06 리뷰: 핸들러 누락 보충).
    api_notifications: ({ p_limit }) => [
        { id: 3, created_at: new Date(Date.now() - 1800_000).toISOString(),
          kind: "review_alert", channel: "mail", recipient: "ops@demo.example",
          subject: "부정 리뷰 2건 — 샘플01점 외", status: "dry_run",
          error: null, task_id: null },
        { id: 2, created_at: new Date(Date.now() - 7200_000).toISOString(),
          kind: "notice", channel: "mail", recipient: "ops@demo.example",
          subject: "내용증명 발송 — 샘플02점 2단계", status: "sent",
          error: null, task_id: 1 },
        { id: 1, created_at: new Date(Date.now() - 86400_000).toISOString(),
          kind: "store_close", channel: "alimtalk", recipient: "운영지원팀",
          subject: "폐점 매장 계정 정리 — 샘플03점", status: "failed",
          error: "알림톡 제공자 미구성", task_id: null },
    ].slice(0, Number(p_limit) || 200),

    // 65_hq_imports.sql — 수신처 목록. 본사 명단을 반입하면 이 모양이 됩니다
    // (import_recipients.py 가 한 사람을 '받을 것마다 한 줄' 로 폅니다).
    // 꺼진 행도 하나 섞어 '사용/꺼짐' 이 화면에서 갈리는지 봅니다.
    api_notify_recipients: () => ({
        items: [
            { id: 1, kind: "report", channel: "mail", recipient: "sv1@demo.example",
              display_name: "샘플 SV1", sv_name: "샘플 SV1", enabled: true,
              note: "슈퍼바이저", updated_at: tsOffset(-1) },
            { id: 2, kind: "review_alert", channel: "mail", recipient: "ops@demo.example",
              display_name: "샘플 팀장", sv_name: null, enabled: true,
              note: "운영지원팀 팀장", updated_at: tsOffset(-1) },
            { id: 3, kind: "notice", channel: "mail", recipient: "ops@demo.example",
              display_name: "샘플 팀장", sv_name: null, enabled: true,
              note: "운영지원팀 팀장", updated_at: tsOffset(-1) },
            { id: 4, kind: "store_close", channel: "mail", recipient: "sv2@demo.example",
              display_name: "샘플 SV2", sv_name: "샘플 SV2", enabled: false,
              note: "휴직 중", updated_at: tsOffset(-3) },
        ],
        enabled: 3,
        total: 4,
    }),

    // 42_consents.sql + 65(source). 본사 명단 반입분과 웹 기록, 철회 이력이
    // 화면에서 갈려 보이는지 확인하는 그림입니다.
    api_review_reply_consents: ({ p_include_withdrawn }) => {
        const items = [
            { consent_id: 1, store_id: 1, store: "샘플01점", signed_at: "2026-08-01",
              signer_name: "샘플대표1", note: "원본: 운영지원팀 캐비닛",
              source: "import", withdrawn_at: null, withdraw_note: null,
              created_at: tsOffset(-6) },
            { consent_id: 2, store_id: 2, store: "샘플02점", signed_at: "2026-08-03",
              signer_name: null, note: null, source: "web",
              withdrawn_at: null, withdraw_note: null, created_at: tsOffset(-4) },
            { consent_id: 3, store_id: 3, store: "샘플03점", signed_at: "2026-06-10",
              signer_name: "샘플대표3", note: null, source: "web",
              withdrawn_at: tsOffset(-2), withdraw_note: "점주 요청",
              created_at: tsOffset(-40) },
        ];
        return {
            items: p_include_withdrawn ? items : items.filter((c) => !c.withdrawn_at),
            live: 2,
            withdrawn: 1,
        };
    },

    // 48_ad_spend.sql — jsonb 스칼라(객체) 그대로.
    api_ad_spend: () => {
        const sum = (rows, key) => rows.reduce((t, r) => t + (r[key] || 0), 0);
        const channels = [...new Set(DEMO_ADS.map((r) => r.channel))]
            .map((ch) => {
                const mine = DEMO_ADS.filter((r) => r.channel === ch);
                return { channel: ch, cost: sum(mine, "cost"),
                         impressions: sum(mine, "impressions"),
                         clicks: sum(mine, "clicks"), orders: sum(mine, "orders") };
            })
            .sort((a, b) => b.cost - a.cost);
        return {
            summary: { cost: sum(DEMO_ADS, "cost"),
                       impressions: sum(DEMO_ADS, "impressions"),
                       clicks: sum(DEMO_ADS, "clicks"),
                       orders: sum(DEMO_ADS, "orders") },
            by_channel: channels,
            rows: [...DEMO_ADS].sort((a, b) => b.ym - a.ym),
        };
    },

    // 32_recipes.sql — returns table(items jsonb) 이라 [{items: [...]}] 모양.
    api_recipes: () => [{ items: DEMO_RECIPES.map((r) => ({ ...r })) }],

    // 56_oilday_check.sql — 오일데이 원복 점검(QUEUE #62). 행사 다음 날
    // 스냅샷에서 반값 이벤트 상품이 켜진 채 남은 매장 2곳이 보이는 그림
    // (2026-08-06 실측에서 실제로 나온 모양 그대로).
    api_oilday_check: () => ({
        snapshot_at: tsOffset(0),
        event_day: 5,
        is_event_day: false,
        rule_enabled: true,
        items: [
            { account: "굿모닝", large_name: "매장(3채널)[단독/본사 메뉴]",
              medium_name: "미태리 샘플07점", store_name: "샘플07점",
              item_name: "봉골레 파스타Event", price: 4400,
              soldout_code: "0", soldout_name: "정상" },
            { account: "굿모닝", large_name: "매장(3채널)[단독/본사 메뉴]",
              medium_name: "미태리 샘플07점", store_name: "샘플07점",
              item_name: "엑스트라 버진 알리오 올리오Event", price: 4400,
              soldout_code: "0", soldout_name: "정상" },
        ],
    }),

    // ---- POS 메뉴 (50_pos_menu.sql) — 함수 규칙 그대로 ----
    api_pos_menu_summary: () => ({
        items: DEMO_POS_MENUS.length,
        // 실제는 count(distinct store_id) 라 **맞춘 매장만** 셉니다.
        // 못 맞춘 것까지 세면 바로 옆 unmatched 와 뜻이 반대로 읽힙니다.
        stores: new Set(DEMO_POS_MENUS
            .filter((m) => m.store_scope === "store" && m.store_matched)
            .map((m) => m.store)).size,
        unmatched: new Set(DEMO_POS_MENUS
            .filter((m) => m.store_scope === "store" && !m.store_matched)
            .map((m) => m.store)).size,
        unavailable: DEMO_POS_MENUS
            .filter((m) => DEMO_POS_UNAVAILABLE.has(m.soldout_code)).length,
        collected_at: tsOffset(0),
        open_requests: demoPosRequests.filter((r) => {
            const task = demoTasks.find((t) => t.id === r.task_id);
            return task && !["done", "rejected"].includes(task.status);
        }).length,
        // 계정별로 나눕니다 — code 만으로 묶으면 뜻이 다른 004 두 개가
        // 한 줄로 합쳐집니다 (실제 함수와 같은 규칙).
        by_large: [...new Map(DEMO_POS_MENUS.map((m) =>
            [`${m.account}|${m.large_code}`, m])).values()]
            .map((m) => ({
                account: m.account, code: m.large_code, name: m.large_name,
                items: DEMO_POS_MENUS.filter((x) => x.account === m.account
                    && x.large_code === m.large_code).length,
            }))
            .sort((a, b) => a.account.localeCompare(b.account, "ko")
                || a.code.localeCompare(b.code)),
        by_account: [...new Set(DEMO_POS_MENUS.map((m) => m.account))].sort()
            .map((account) => ({
                account,
                hq_code: DEMO_POS_MENUS.find((m) => m.account === account).hq_code,
                items: DEMO_POS_MENUS.filter((m) => m.account === account).length,
                collected_at: tsOffset(0),
            })),
    }),

    api_pos_menu_stores: ({ p_account } = {}) => {
        const seen = new Map();
        for (const m of DEMO_POS_MENUS) {
            if (m.store_scope !== "store") continue;
            if (p_account && m.account !== p_account) continue;
            // 실제와 같이 표준이름으로 모읍니다 — 원문 그대로 두면 같은 매장이
            // 계정마다 따로 나옵니다.
            const name = m.store_matched ? m.store : demoPosStoreName(m.store);
            const row = seen.get(name)
                || { store: name, label: m.category.split(" > ")[0],
                     matched: m.store_matched, items: 0 };
            row.items += 1;
            seen.set(name, row);
        }
        return [...seen.values()]
            .sort((a, b) => (b.matched - a.matched)
                || a.store.localeCompare(b.store, "ko"));
    },

    api_pos_menus: ({ p_store, p_large, p_only_unavailable, p_q, p_limit, p_account }) => {
        const query = (p_q || "").trim();
        const matched = DEMO_POS_MENUS.filter((m) => {
            if (p_account && m.account !== p_account) return false;
            // 실제 함수처럼 원문·표준이름 둘 다 받습니다.
            if (p_store && m.store !== p_store
                && demoPosStoreName(m.store) !== p_store) return false;
            if (p_large && m.large_code !== p_large) return false;
            if (p_only_unavailable && !DEMO_POS_UNAVAILABLE.has(m.soldout_code)) return false;
            if (query && !m.item_name.includes(query) && m.item_code !== query) return false;
            return true;
        });
        const items = matched
            .map((m) => {
                const live = demoPosRequests.find((r) => {
                    if (r.menu_item_id !== m.menu_item_id) return false;
                    const task = demoTasks.find((t) => t.id === r.task_id);
                    return task && !["done", "rejected"].includes(task.status);
                });
                const task = live && demoTasks.find((t) => t.id === live.task_id);
                return {
                    ...m,
                    soldout_name: DEMO_POS_SOLDOUT[m.soldout_code] || m.soldout_code,
                    unavailable: DEMO_POS_UNAVAILABLE.has(m.soldout_code),
                    delivery_yn: "Y",
                    collected_at: tsOffset(0),
                    change_task_id: task ? live.task_id : null,
                    change_task_status: task ? task.status : null,
                };
            })
            .sort((a, b) => (b.unavailable - a.unavailable)
                || a.large_code.localeCompare(b.large_code)
                || a.item_name.localeCompare(b.item_name, "ko"))
            .slice(0, Math.max(Number(p_limit) || 300, 1));
        return { items, shown: items.length, total: matched.length };
    },

    api_pos_menu_requests: ({ p_limit }) =>
        [...demoPosRequests]
            .sort((a, b) => b.id - a.id)
            .slice(0, Math.max(Number(p_limit) || 100, 1))
            .map((r) => {
                // 요청이 남은 채 DEMO_POS_MENUS 를 손보면 못 찾을 수 있습니다.
                // 그때 표 전체가 안 뜨는 것보다 그 줄만 비는 편이 낫습니다.
                const menu = DEMO_POS_MENUS.find((m) => m.menu_item_id === r.menu_item_id) || {};
                const task = demoTasks.find((t) => t.id === r.task_id) || {};
                const runs = demoPosExecutions.filter((e) => e.request_id === r.id);
                const last = runs[runs.length - 1];
                return {
                    request_id: r.id, task_id: r.task_id, task_status: task.status,
                    kind: task.kind, menu_item_id: r.menu_item_id,
                    store: menu.store, item_name: menu.item_name,
                    item_code: menu.item_code, change_type: r.change_type,
                    field: r.field, before_value: r.before_value,
                    after_value: r.after_value,
                    before_label: DEMO_POS_SOLDOUT[r.before_value] || null,
                    after_label: DEMO_POS_SOLDOUT[r.after_value] || null,
                    reason: r.reason, created_at: r.created_at,
                    executions: runs.length,
                    last_mode: last ? last.mode : null,
                    last_ok: last ? last.ok : null,
                    applied: runs.some((e) => e.mode === "live" && e.ok),
                };
            }),

    api_pos_menu_executions: ({ p_request_id }) =>
        demoPosExecutions.filter((e) => e.request_id === Number(p_request_id)),

    // 실제 함수의 거절 규칙을 그대로 옮긴 것입니다 — 화면이 사유를 그대로
    // 보여주므로(D18 판정을 화면이 흉내내지 않음) 문구까지 같아야 합니다.
    request_pos_menu_change: ({ p_menu_item_id, p_change_type, p_after_value, p_reason }) => {
        const menu = DEMO_POS_MENUS.find((m) => m.menu_item_id === Number(p_menu_item_id));
        if (!menu) return { ok: false, reason: "메뉴를 찾지 못했습니다" };
        if (!["soldout", "price", "other"].includes(p_change_type)) {
            return { ok: false,
                     reason: "모르는 변경 종류입니다: " + (p_change_type || "(없음)") };
        }
        const after = String(p_after_value || "").trim();
        if (!after) return { ok: false, reason: "바꿀 값을 입력하세요" };
        if (p_change_type === "soldout" && !["0", "1", "7"].includes(after)) {
            return { ok: false, reason: "품절 처리는 0(정상)·1(품절)·7(일시판매중지)만 됩니다" };
        }
        if (menu.soldout_code === after) return { ok: false, reason: "지금 값과 같습니다" };

        const live = demoPosRequests.find((r) => {
            if (r.menu_item_id !== menu.menu_item_id) return false;
            const task = demoTasks.find((t) => t.id === r.task_id);
            return task && !["done", "rejected"].includes(task.status);
        });
        if (live) {
            const task = demoTasks.find((t) => t.id === live.task_id);
            return { ok: false, reason: "이미 승인 흐름에 있는 건입니다",
                     task_id: live.task_id, status: task.status };
        }

        const taskId = nextTaskId++;
        demoTasks.push({
            id: taskId, kind: "pos_soldout",
            title: `POS 품절 ${after === "0" ? "해제" : "처리"} — `
                + `${menu.store} · ${menu.item_name}`,
            body: `품절여부 ${DEMO_POS_SOLDOUT[menu.soldout_code]} → ${DEMO_POS_SOLDOUT[after]}`
                + `\n상품코드 ${menu.item_code}`
                + (menu.store_scope === "common"
                    ? "\n⚠️ 본사 상품 마스터라 전 매장에 걸릴 수 있습니다"
                    + " (매장 단위 여부 미확인 — 입회 시험 항목)" : ""),
            store: menu.store_scope === "store" ? menu.store : null,
            source: "web", status: "waiting_approval", assigned_to: null,
            created_at: tsOffset(0),
        });
        demoTaskEvents.push({
            id: nextTaskEventId++, task_id: taskId, from: "received",
            to: "waiting_approval",
            note: `POS 메뉴 변경 승인 요청 (메뉴 #${menu.menu_item_id})`,
            approval_kind: null, preauth_id: null, created_at: tsOffset(0),
        });
        const requestId = nextPosRequestId++;
        demoPosRequests.push({
            id: requestId, menu_item_id: menu.menu_item_id, task_id: taskId,
            change_type: p_change_type, field: "품절여부",
            before_value: menu.soldout_code, after_value: after,
            reason: (p_reason || "").trim() || null, created_at: tsOffset(0),
        });
        return { ok: true, task_id: taskId, request_id: requestId,
                 before: menu.soldout_code, after };
    },

    record_pos_menu_execution: ({ p_request_id, p_mode, p_ok, p_response_code,
                                  p_response_msg, p_verified_value, p_note }) => {
        const request = demoPosRequests.find((r) => r.id === Number(p_request_id));
        if (!request) return { ok: false, reason: "변경 요청을 찾지 못했습니다" };
        if (!["dry_run", "live"].includes(p_mode)) {
            return { ok: false, reason: "mode 는 dry_run 또는 live 입니다" };
        }
        const id = nextPosExecutionId++;
        demoPosExecutions.push({
            execution_id: id, request_id: request.id, mode: p_mode, ok: !!p_ok,
            response_code: p_response_code || null, response_msg: p_response_msg || null,
            verified_value: p_verified_value || null, note: p_note || null,
            executed_at: tsOffset(0),
        });
        // dry-run 은 현황을 바꾸지 않습니다 — 실제 함수와 같은 규칙입니다.
        if (p_mode === "live" && p_ok && request.change_type === "soldout"
            && p_verified_value) {
            const menu = DEMO_POS_MENUS.find((m) => m.menu_item_id === request.menu_item_id);
            if (menu) menu.soldout_code = p_verified_value;
        }
        return { ok: true, execution_id: id };
    },

    // 49_ingredient_usage.sql — 데모 레시피 × 고정 난수 판매량으로 실제와
    // 같은 모양(coverage·unmatched_top 포함)을 돌려줍니다.
    api_ingredient_usage: ({ p_from, p_to, p_store }) => {
        const to = Number(p_to) || 202607;
        const from = Number(p_from) || 202605;
        const rand = seeded(from * 31 + to * 7 + (p_store ? p_store.length : 0));

        const qtyByMenu = new Map();
        for (const [name] of MENUS) {
            qtyByMenu.set(name, 200 + Math.floor(rand() * 800));
        }
        const recipeMenus = new Set(DEMO_RECIPES.map((r) => r.menu));

        const usage = new Map();
        for (const r of DEMO_RECIPES) {
            const qty = qtyByMenu.get(r.menu) || 0;
            const u = usage.get(r.ingredient)
                || { amount: 0, cost: 0, menus: new Set() };
            u.amount += qty * r.grams;
            u.cost += qty * (r.supply_won || 0);
            u.menus.add(r.menu);
            usage.set(r.ingredient, u);
        }

        let qtyMatched = 0, qtyTotal = 0, menuMatched = 0;
        for (const [name, qty] of qtyByMenu) {
            qtyTotal += qty;
            if (recipeMenus.has(name)) { qtyMatched += qty; menuMatched += 1; }
        }

        return {
            from_ym: from, to_ym: to, ym_min: 202501, ym_max: 202607,
            coverage: { menu_matched: menuMatched, menu_total: qtyByMenu.size,
                        qty_matched: qtyMatched, qty_total: qtyTotal },
            ingredients: [...usage.entries()]
                .map(([ingredient, u]) => ({
                    ingredient,
                    amount: Math.round(u.amount * 10) / 10,
                    cost: Math.round(u.cost),
                    menus: u.menus.size,
                }))
                .sort((a, b) => b.cost - a.cost),
            unmatched_top: [...qtyByMenu.entries()]
                .filter(([name]) => !recipeMenus.has(name))
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([menu, qty]) => ({
                    menu, qty,
                    category: (MENUS.find(([n]) => n === menu) || [])[1] || null,
                })),
        };
    },

    // 아워홈 발주량 (59_ourhome_orders.sql). 실제 모양을 그대로 흉내 냅니다 —
    // 특히 화면이 반드시 보여야 하는 두 가지를 데모에도 넣어 둡니다:
    //   · 사업장 수 ≠ 매장 수 (한 매장에 아워홈 코드가 둘일 수 있음 — 상계역점 실측)
    //   · 우리 매장 대장과 안 이어진 사업장 (커버리지를 숨기면 안 됩니다)
    api_ourhome_orders: ({ p_from, p_to, p_store }) => {
        const to = Number(p_to) || 202607;
        const from = Number(p_from) || 202607;
        const rand = seeded(from * 17 + to * 3);

        const months = [];
        for (let ym = from; ym <= to; ym = ym % 100 === 12 ? ym + 89 : ym + 1) months.push(ym);

        // 데모 매장 60곳 + 대장에 없는 사업장 2곳(실제로도 이런 곳이 있습니다).
        const picked = STORES.slice(0, 60).map((s) => ({ store: s.name, matched: true }));
        picked.push({ store: "샘플랩실", matched: false },
                    { store: "샘플미연결점", matched: false });

        const rows = picked.map((s, i) => {
            const qty = months.length * (300 + Math.floor(rand() * 1500));
            return {
                store: s.store,
                // 첫 매장만 사업장코드가 둘 — 재계약으로 코드가 새로 난 경우입니다.
                busiplcd: i === 0 ? "FNAA1,FNAA2" : `FN${String(i).padStart(3, "0")}`,
                busipl_count: i === 0 ? 2 : 1,
                months: months.length,
                qty,
                amount: qty * (8000 + Math.floor(rand() * 4000)),
                matched: s.matched,
            };
        }).filter((r) => !p_store || r.store === p_store)
          .sort((a, b) => b.amount - a.amount);

        const sum = (key) => rows.reduce((acc, r) => acc + r[key], 0);
        return {
            ym_min: 202501, ym_max: 202607, from_ym: from, to_ym: to,
            collected_at: "2026-08-07T14:58:54+09:00",
            total: {
                stores: rows.length,
                busipl: rows.reduce((acc, r) => acc + r.busipl_count, 0),
                qty: sum("qty"), amount: sum("amount"),
            },
            coverage: {
                stores_total: rows.length,
                stores_matched: rows.filter((r) => r.matched).length,
            },
            months: months.map((ym) => ({
                ym,
                busipl: rows.reduce((acc, r) => acc + r.busipl_count, 0),
                qty: Math.round(sum("qty") / months.length),
                amount: Math.round(sum("amount") / months.length),
            })),
            stores: rows,
        };
    },
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

    // 표를 그대로 읽는 화면들이 쓰는 픽스처. 이름이 안 걸리면 마지막 업로드
    // 시각(가장 흔한 용도)을 돌려주던 원래 동작을 그대로 뒀습니다.
    const demoTableRows = (table) => {
        switch (table) {
            case "collect_requests":
                return [...requests].sort((a, b) => b.id - a.id);
            case "runner_status":
                return [{
                    last_seen_at: new Date().toISOString(),
                    hostname: "DEMO-PC", busy: false, current_note: "대기 중",
                }];
            case "stores":
                return STORES.map((s) => ({ id: s.id, name: s.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            case "task_kinds":
                return DEMO_TASK_KINDS;
            case "task_preauthorizations":
                return [...demoPreauths];
            case "agg_store_dong_month":
                // 지도의 '집계 있는 달' 조회(dongAggRange)가 ym 만 읽습니다.
                // 이 builder 의 order() 는 무시라 min·max 가 같게 나오는데,
                // 데모 행이 전부 한 달(202607)이라 결과는 실제와 같습니다.
                return DEMO_DONG_ROWS.map((r) => ({ ym: r.ym }));
            default:
                return [{ uploaded_at: new Date().toISOString() }];
        }
    };

    const builder = (table) => {
        const chain = {
            select: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({ data: demoTableRows(table), error: null }),
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
                if (table === "tasks") {
                    const store = STORES.find((s) => s.id === Number(row.store_id));
                    demoTasks.push({
                        id: nextTaskId++,
                        kind: row.kind,
                        title: row.title,
                        body: row.body || null,
                        store: store ? store.name : null,
                        source: row.source || "web",
                        status: "received",
                        assigned_to: row.assigned_to || null,
                        created_at: new Date().toISOString(),
                    });
                    return { data: null, error: null };
                }
                if (table === "task_preauthorizations") {
                    demoPreauths.push({
                        id: nextPreauthId++,
                        kind: row.kind || null,
                        scope: row.scope,
                        note: row.note || null,
                        created_at: new Date().toISOString(),
                        revoked_at: null,
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
