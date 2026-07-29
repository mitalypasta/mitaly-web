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
                        : [{ uploaded_at: new Date().toISOString() }],
                error: null,
            }),
            insert: async (row) => {
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
