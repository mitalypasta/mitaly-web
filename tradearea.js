// 상권 분석 — 옛 구글시트 '예상매출 계산기'의 주소→반경 분석 이식 (2026-08-29).
//
// 흐름: 주소 입력 → Cloudflare Worker(/analyze)가 카카오 지오코딩 +
// 마이프차(인구·반경 음식점 추정매출)를 대신 수집 → 이 파일이 옛 계산기와
// **같은 공식**으로 브랜드 추출·상권 점수·예상매출을 계산 → 화면 + DB 저장
// (98_trade_area.sql, api_trade_area_*). 공식을 바꾸면 숫자가 계산기와
// 어긋나므로, 모델 상수(BRAND_DB·가중치·티어표)는 계산기 원본 그대로 둡니다.
//
// 비밀값(카카오 키·마이프차 계정)은 Worker 에만 있습니다(절대 규칙 1) —
// 웹은 로그인 세션 토큰을 실어 Worker 를 부를 뿐입니다.

import { $ } from "./dom.js";
import { escape } from "./util.js";
import { int } from "./format.js";
import { palette, drawLine, drawBars } from "./charts.js";
import { db } from "./client.js";

const DEMO = new URLSearchParams(location.search).get("demo") === "1";
const WORKER_ANALYZE = "https://throbbing-bush-cf08.mitaly-pasta.workers.dev/analyze";

// ---------------------------------------------------------------- 모델 상수 (계산기 원본 그대로)

// 지역별 미태리 실매출 분위수(만원) — 예상치가 지역 하한(q25) 아래로 내려가지
// 않게 받치는 용도입니다.
const REGION_Q = {
    "서울": { q25: 1795 }, "경기": { q25: 1807 }, "인천": { q25: 1744 },
    "강원": { q25: 1575 }, "대전": { q25: 863 }, "세종": { q25: 1650 },
    "충북": { q25: 950 }, "충남": { q25: 900 }, "광주": { q25: 850 },
    "전북": { q25: 624 }, "전남": { q25: 700 }, "부산": { q25: 1100 },
    "대구": { q25: 1000 }, "울산": { q25: 1100 }, "경북": { q25: 1000 },
    "경남": { q25: 1100 }, "제주": { q25: 2588 },
};

// 프랜차이즈 브랜드 DB — A(대형)/B(주요)/C(중소) 티어. 계산기 프런트판 그대로.
const BRAND_DB = {
    "BBQ": { t: "A", alias: ["비비큐", "bbq"] }, "교촌치킨": { t: "A", alias: ["교촌"] },
    "굽네치킨": { t: "A", alias: ["굽네"] }, "BHC": { t: "A", alias: ["bhc", "비에이치씨"] },
    "네네치킨": { t: "A", alias: ["네네"] }, "맘스터치": { t: "A" }, "롯데리아": { t: "A" },
    "맥도날드": { t: "A" }, "버거킹": { t: "A" }, "KFC": { t: "A", alias: ["케이에프씨"] },
    "써브웨이": { t: "A" }, "스타벅스": { t: "A" }, "투썸플레이스": { t: "A", alias: ["투썸"] },
    "이디야커피": { t: "A", alias: ["이디야"] },
    "메가MGC커피": { t: "A", alias: ["메가커피", "메가엠지씨커피", "메가MGC"] },
    "컴포즈커피": { t: "A", alias: ["컴포즈"] }, "빽다방": { t: "A" }, "더벤티": { t: "A" },
    "파리바게뜨": { t: "A", alias: ["파리바게트"] }, "뚜레쥬르": { t: "A" },
    "배스킨라빈스": { t: "A", alias: ["베스킨라빈스"] }, "던킨": { t: "A", alias: ["던킨도너츠"] },
    "한솥": { t: "A", alias: ["한솥도시락"] }, "신전떡볶이": { t: "A", alias: ["신전"] },
    "도미노피자": { t: "A", alias: ["도미노"] }, "피자헛": { t: "A" },
    "본죽": { t: "A", alias: ["본죽&비빔밥", "본죽앤비빔밥", "본죽and비빔밥"] }, "공차": { t: "A" },
    "호식이두마리치킨": { t: "B", alias: ["호식이", "호식이치킨"] },
    "처갓집양념치킨": { t: "B", alias: ["처갓집"] }, "페리카나": { t: "B" },
    "60계치킨": { t: "B", alias: ["60계", "육공계"] }, "지코바치킨": { t: "B", alias: ["지코바"] },
    "맥시칸치킨": { t: "B", alias: ["맥시칸"] }, "노랑통닭": { t: "B" },
    "노브랜드버거": { t: "B" }, "프랭크버거": { t: "B" }, "이삭토스트": { t: "B", alias: ["이삭"] },
    "할리스": { t: "B", alias: ["할리스커피"] }, "파스쿠찌": { t: "B" }, "커피베이": { t: "B" },
    "더리터": { t: "B" }, "매머드커피": { t: "B", alias: ["매머드익스프레스", "매머드"] },
    "설빙": { t: "B" }, "디저트39": { t: "B" }, "본도시락": { t: "B" }, "김가네": { t: "B" },
    "백채김치찌개": { t: "B" }, "큰맘할매순대국": { t: "B", alias: ["큰맘할매"] },
    "현대옥": { t: "B" }, "한촌설렁탕": { t: "B" }, "명륜진사갈비": { t: "B" },
    "고봉민김밥": { t: "B", alias: ["고봉민"] }, "봉구스밥버거": { t: "B", alias: ["봉구스"] },
    "바르다김선생": { t: "B" }, "우리할매떡볶이": { t: "B" },
    "명랑핫도그": { t: "B", alias: ["명랑시대쌀핫도그", "명랑시대", "명랑"] }, "국수나무": { t: "B" },
    "홍콩반점0410": { t: "B", alias: ["홍콩반점"] }, "탕화쿵푸": { t: "B", alias: ["탕화쿵푸마라탕"] },
    "미소야": { t: "B" }, "미스터피자": { t: "B" }, "파파존스": { t: "B" },
    "피자알볼로": { t: "B" }, "피자마루": { t: "B" }, "가장맛있는족발": { t: "B" },
    "족발야시장": { t: "B" }, "죽이야기": { t: "B" }, "투다리": { t: "B" },
    "역전할머니맥주": { t: "B", alias: ["역전할머니"] }, "두찜": { t: "B" },
    "또래오래": { t: "C" }, "바른치킨": { t: "C" }, "하삼동커피": { t: "C" },
    "청년다방": { t: "C" }, "요거트월드": { t: "C" }, "육대장": { t: "C" }, "소담촌": { t: "C" },
    "일품양평해장국": { t: "C" }, "백소정": { t: "C" }, "마라공방": { t: "C" },
    "등촌샤브칼국수": { t: "C", alias: ["등촌샤브"] }, "샐러디": { t: "C" },
    "땅스부대찌개": { t: "C" },
};

const BRAND_INDEX = {};
for (const [name, info] of Object.entries(BRAND_DB)) {
    BRAND_INDEX[name.replace(/\s/g, "")] = name;
    for (const a of info.alias || []) BRAND_INDEX[a.replace(/\s/g, "")] = name;
}
const BRAND_KEYS = Object.keys(BRAND_INDEX).sort((a, b) => b.length - a.length);

function brandOf(storeName) {
    const n = storeName.replace(/\s*[\(（\[【][^\)）\]】]*[\)）\]】]/g, "").replace(/\s/g, "").trim();
    if (BRAND_INDEX[n]) return BRAND_INDEX[n];
    for (const k of BRAND_KEYS) if (n.startsWith(k)) return BRAND_INDEX[k];
    const upper = storeName.toUpperCase().replace(/\s/g, "");
    for (const k of BRAND_KEYS) {
        if (k.length >= 3 && upper.startsWith(k.toUpperCase())) return BRAND_INDEX[k];
    }
    return null;
}

// ---------------------------------------------------------------- 계산 모델 (계산기와 같은 공식)

function extractBrands(sales) {
    const map = {};
    for (const s of sales) {
        const b = brandOf(s.name || "");
        if (!b) continue;
        if (!map[b]) map[b] = { cnt: 0, revs: [], tier: (BRAND_DB[b] || {}).t || "D" };
        map[b].cnt++;
        if (s.estSale > 0) map[b].revs.push(Math.round(s.estSale / 10000));
    }
    const tierOrder = { A: 0, B: 1, C: 2, D: 3 };
    return Object.entries(map).map(([brand, d]) => ({
        brand, cnt: d.cnt, tier: d.tier,
        avg: d.revs.length
            ? Math.round(d.revs.reduce((a, v) => a + v, 0) / d.revs.length) : 0,
    })).sort((a, b) => (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3)
        || b.avg - a.avg || b.cnt - a.cnt);
}

function regionOf(region1) {
    for (const key of Object.keys(REGION_Q)) {
        if ((region1 || "").includes(key)) return key;
    }
    return "서울";
}

export function computeModel(raw, name) {
    const sales = raw.sales || [];
    const pop = raw.pop || {};
    const brands = extractBrands(sales);

    const revs = sales.filter((s) => s.estSale > 0)
        .map((s) => Math.round(s.estSale / 10000));
    const compAvg = revs.length
        ? Math.round(revs.reduce((a, v) => a + v, 0) / revs.length) : 0;

    // 대형(A/B) 브랜드 상위 30% 평균 — 전체 평균의 1.7배로 캡(부풀림 방지).
    const major = brands.filter((b) => b.avg > 0 && (b.tier === "A" || b.tier === "B"));
    let majorAvg = compAvg;
    if (major.length > 0) {
        const sorted = [...major].sort((a, b) => b.avg - a.avg);
        const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.3)));
        majorAvg = Math.round(top.reduce((s, b) => s + b.avg, 0) / top.length);
    }
    const majorAvgEff = compAvg > 0 ? Math.min(majorAvg, Math.round(compAvg * 1.7)) : majorAvg;

    const worker = pop.worker || 0;
    const resident = pop.resident || 0;
    const household = pop.household || 0;
    const ratio2030 = (pop.age && pop.age.ratio2030) || 20;
    const dinnerPeak = (pop.floating && pop.floating.dinnerPeak) || pop.dinner || 0;
    const totalStores = brands.reduce((s, b) => s + b.cnt, 0);

    // 상권 점수 6항목 중 5항목 가중 평균 (계산기와 동일한 임계값·가중치).
    const scores = {
        compDensity: (() => {
            if (worker <= 0 || totalStores <= 0) return 30;
            const d = worker / totalStores;
            if (d >= 80) return 95; if (d >= 50) return 80; if (d >= 30) return 65;
            if (d >= 15) return 45; if (d >= 8) return 30; return 15;
        })(),
        brandLevel: (() => {
            if (majorAvg <= 0) return 30;
            if (majorAvg >= 5000) return 95; if (majorAvg >= 4000) return 80;
            if (majorAvg >= 3000) return 65; if (majorAvg >= 2000) return 50;
            if (majorAvg >= 1000) return 35; return 20;
        })(),
        dinner: (() => {
            if (dinnerPeak >= 50000) return 95; if (dinnerPeak >= 30000) return 80;
            if (dinnerPeak >= 15000) return 60; if (dinnerPeak >= 5000) return 40;
            return 20;
        })(),
        resident: (() => {
            const combined = resident + household * 2;
            if (combined >= 30000) return 90; if (combined >= 20000) return 70;
            if (combined >= 10000) return 50; if (combined >= 5000) return 35;
            return 20;
        })(),
        young: (() => {
            if (ratio2030 >= 35) return 90; if (ratio2030 >= 25) return 70;
            if (ratio2030 >= 15) return 50; return 30;
        })(),
    };
    const weights = { compDensity: 2.5, brandLevel: 2.0, dinner: 2.0, resident: 1.0, young: 1.0 };
    let sum = 0, wsum = 0;
    for (const k of Object.keys(weights)) { sum += scores[k] * weights[k]; wsum += weights[k]; }
    const areaScore = Math.min(100, Math.max(0, Math.round(sum / wsum)));

    // 상권 점수 → 포지션 계수 → 예상매출(상위 25% 운영 기준). 지역 q25 로 하한.
    const ratio = areaScore >= 80 ? 0.80 + (areaScore - 80) / 20 * 0.10
        : areaScore >= 50 ? 0.70 + (areaScore - 50) / 30 * 0.10
        : areaScore >= 20 ? 0.60 + (areaScore - 20) / 30 * 0.10
        : 0.50 + areaScore / 20 * 0.10;
    let q75 = Math.round(majorAvgEff * ratio);
    const region = regionOf(raw.geo && raw.geo.region_1);
    const rq = REGION_Q[region];
    if (rq && q75 < rq.q25) q75 = rq.q25;

    // 상권 유형 판정 (계산기 generateInsight 와 동일).
    const isOffice = worker >= 8000;
    const isResidential = household >= 4000 && resident >= 10000;
    const areaType = isOffice && isResidential ? "직주혼합"
        : isOffice ? "오피스"
        : isResidential ? "거주밀집"
        : (pop.dinner || 0) >= 30000 ? "유흥/상업"
        : resident < 5000 && (pop.dinner || 0) < 10000 ? "소규모 근린"
        : "복합";

    return {
        v: 1,
        analyzedAt: new Date().toISOString(),
        geo: raw.geo || null,
        region, areaType,
        radius: raw.radius || 500,
        name: name || (raw.geo && raw.geo.region_3) || "",
        counts: { stores: sales.length, brands: brands.length, brandStores: totalStores },
        compAvg, majorAvg, areaScore, scores,
        expected: {
            q75,
            sm: Math.round(q75 * 0.75),
            q90: Math.round(q75 * 1.20),
            q25: Math.round(q75 * 0.50),
        },
        brands,
        pop: raw.pop || null,
        popError: raw.popError || "",
        salesError: raw.salesError || "",
    };
}

// ---------------------------------------------------------------- 수집 (Worker 호출)

async function fetchAnalysis(address, radius) {
    if (DEMO) {
        await new Promise((r) => setTimeout(r, 500));
        return demoRaw(address, radius);
    }
    const { data } = await db.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) return { ok: false, error: "로그인이 필요합니다" };
    const res = await fetch(WORKER_ANALYZE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ address, radius }),
    });
    return res.json();
}

// 데모 모드 — Worker 없이 화면·공식만 확인하는 가짜 수집 응답입니다.
function demoRaw(address, radius) {
    const mk = (name, est) => ({ name, estSale: est * 10000, category: "", categoryDetail: "" });
    return {
        ok: true,
        geo: { x: 126.92, y: 37.55, address_name: address || "서울 마포구 양화로 186",
               region_1: "서울", region_2: "마포구", region_3: "서동교동" },
        radius,
        pop: {
            resident: 18500, household: 8200, lunch: 42000, dinner: 61000,
            worker: 12400, workerTotal: 13100,
            housing: { apt: 4100, house: 1200, officetel: 2300, villa: 600, aptRatio: 50 },
            age: { total: [900, 1500, 4200, 3900, 3100, 2600, 1500, 800],
                   male: [450, 760, 2100, 2000, 1550, 1300, 740, 380],
                   female: [450, 740, 2100, 1900, 1550, 1300, 760, 420],
                   pop2030: 8100, ratio2030: 44 },
            floating: {
                lunchPeak: 38000, dinnerPeak: 61000,
                day: [{ hour: 1, total: 4000 }, { hour: 6, total: 9000 },
                      { hour: 11, total: 38000 }, { hour: 15, total: 45000 },
                      { hour: 18, total: 61000 }, { hour: 21, total: 52000 }],
                week: [{ hour: 1, total: 6000 }, { hour: 6, total: 8000 },
                       { hour: 11, total: 33000 }, { hour: 15, total: 51000 },
                       { hour: 18, total: 66000 }, { hour: 21, total: 58000 }],
            },
        },
        popError: "",
        sales: [
            mk("스타벅스 홍대점", 8200), mk("버거킹 홍대점", 5100),
            mk("맘스터치 서교점", 3900), mk("교촌치킨 서교점", 3600),
            mk("롯데리아 홍대점", 3400), mk("빽다방 홍대점", 2100),
            mk("컴포즈커피 서교점", 1700), mk("파리바게뜨 서교점", 4300),
            mk("역전할머니맥주 홍대점", 2600), mk("김가네 서교점", 1500),
            mk("육대장 홍대점", 2200), mk("샐러디 서교점", 1300),
            mk("동네피자집", 900), mk("서교분식", 700), mk("골목냉면", 600),
            mk("홍대돈까스", 1100), mk("연남파스타", 1900), mk("서교초밥", 2400),
        ],
        salesError: "",
    };
}

// ---------------------------------------------------------------- 화면

let lastResult = null;
let brandsExpanded = false;
let historyLoaded = false;

function status(msg, isError) {
    const el = $("ta-status");
    el.className = isError ? "notice error" : "notice";
    el.textContent = msg || "";
}

function tile(label, value, sub, cls) {
    return `<div class="tile${cls ? " " + cls : ""}"><div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${escape(sub)}</div>` : "") + `</div>`;
}

function render(r) {
    lastResult = r;
    $("ta-result").hidden = false;

    // 머리 — 예상매출과 상권 요약
    const e = r.expected;
    $("ta-hero").innerHTML =
        tile("예상 월매출 (상위 25% 운영 기준)", `${int(e.q75)}만원`,
            `중앙값 ${int(e.sm)}만 · 상위 10% ${int(e.q90)}만`, "hero")
        + tile("상권", `${escape(r.areaType)}`,
            `${escape(r.region)} · 점수 ${r.areaScore}/100 · 반경 ${r.radius}m`)
        + tile("주변 음식점", `${int(r.counts.stores)}곳`,
            `인식 브랜드 ${r.counts.brands}개 (${int(r.counts.brandStores)}곳)`);
    $("ta-meta").textContent = (r.geo && r.geo.address_name ? r.geo.address_name + " · " : "")
        + new Date(r.analyzedAt).toLocaleString("ko-KR");

    const errs = [r.popError, r.salesError].filter(Boolean);
    $("ta-warn").textContent = errs.length ? "⚠️ " + errs.join(" · ") : "";
    $("ta-warn").hidden = errs.length === 0;

    // 매출 비교
    const c = palette();
    const compareRows = [{ label: "미태리 예상", value: e.q75 }];
    if (r.majorAvg > 0) compareRows.push({ label: "대형 프랜차이즈 평균", value: r.majorAvg });
    if (r.compAvg > 0) compareRows.push({ label: "전체 음식점 평균", value: r.compAvg });
    drawBars($("c-ta-compare"), { rows: compareRows, color: c.s1, horizontal: true,
        colors: c, unitSuffix: "만" });

    // 주변 브랜드
    drawBrands(r);

    // 인구
    if (r.pop) {
        const p = r.pop;
        $("ta-pop").innerHTML =
            tile("거주인구", `${int(p.resident)}<span class="unit">명</span>`,
                p.age ? `2030세대 ${p.age.ratio2030}%` : "")
            + tile("배후세대", `${int(p.household)}<span class="unit">세대</span>`,
                p.housing ? `아파트 ${p.housing.aptRatio}%` : "")
            + tile("점심 유동", `${int(p.lunch)}<span class="unit">명</span>`, "")
            + tile("저녁 유동", `${int(p.dinner)}<span class="unit">명</span>`, "")
            + tile("직장인구", `${int(p.worker)}<span class="unit">명</span>`, "");
        // 시간대별 유동
        const fl = p.floating;
        const svg = $("c-ta-float");
        if (fl && fl.day && fl.day.length > 1) {
            svg.hidden = false;
            const hours = fl.day.map((x) => x.hour);
            const label = (h) => (h < 6 ? "새벽" : h < 11 ? "오전" : h < 15 ? "점심"
                : h < 18 ? "오후" : h < 21 ? "저녁" : "밤") + `(${h}시)`;
            drawLine(svg, {
                xLabels: hours.map(label),
                series: [
                    { name: "평일", color: c.s1, values: fl.day.map((x) => x.total) },
                    { name: "주말", color: c.s2,
                      values: (fl.week || []).map((x) => x.total) },
                ],
                colors: c,
                fmt: (v) => int(v),
                fmtFull: (v) => int(v) + "명",
            });
        } else {
            svg.hidden = true;
        }
        $("ta-pop-card").hidden = false;
    } else {
        $("ta-pop-card").hidden = true;
    }
}

function drawBrands(r) {
    const list = (r.brands || []).filter((b) => b.avg > 0).sort((a, b) => b.avg - a.avg);
    const btn = $("ta-brands-all");
    if (list.length === 0) {
        $("c-ta-brands").hidden = true;
        btn.hidden = true;
        $("ta-brands-hint").textContent = "매출이 잡힌 프랜차이즈가 없습니다.";
        return;
    }
    $("c-ta-brands").hidden = false;
    $("ta-brands-hint").textContent = "";
    const visible = brandsExpanded ? list : list.slice(0, 10);
    const c = palette();
    drawBars($("c-ta-brands"), {
        rows: visible.map((b) => ({
            label: b.brand + (b.cnt > 1 ? ` (${b.cnt}곳)` : ""),
            value: b.avg,
        })),
        color: c.s1, colors: c, horizontal: true, unitSuffix: "만",
    });
    btn.hidden = list.length <= 10;
    btn.textContent = brandsExpanded ? "상위 10개만 보기" : `전체 ${list.length}개 보기`;
}

// ---------------------------------------------------------------- 저장·이력

async function saveResult(r, addressInput) {
    const { data, error } = await db.rpc("api_trade_area_save", {
        p_name: r.name || "",
        p_address: (r.geo && r.geo.address_name) || addressInput,
        p_lat: r.geo ? r.geo.y : null,
        p_lng: r.geo ? r.geo.x : null,
        p_radius: r.radius,
        p_q75: r.expected.q75,
        p_result: r,
    });
    if (error || (data && data.ok === false)) {
        status("분석은 끝났지만 저장하지 못했습니다 — "
            + (error ? error.message : data.reason), true);
        return;
    }
    await loadHistory();
}

async function loadHistory() {
    const { data, error } = await db.rpc("api_trade_area_list");
    const tv = $("t-ta-history");
    if (error) {
        tv.innerHTML = `<p class="hint">이력을 불러오지 못했습니다: ${escape(error.message)}</p>`;
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    historyLoaded = true;
    $("ta-h-meta").textContent = rows.length ? `${rows.length}건` : "";
    if (!rows.length) {
        tv.innerHTML = '<p class="hint">저장된 분석이 없습니다 — 위에서 주소를 분석하면 자동으로 쌓입니다.</p>';
        return;
    }
    tv.innerHTML = "<table><thead><tr><th class='tl'>지점명</th><th class='tl'>주소</th>"
        + "<th>반경</th><th>예상매출</th><th class='tl'>분석일</th><th></th></tr></thead><tbody>"
        + rows.map((h) => `<tr class="ta-row" data-id="${h.id}">`
            + `<td class="tl">${escape(h.name || "—")}</td>`
            + `<td class="tl">${escape(h.address)}</td>`
            + `<td>${h.radius}m</td>`
            + `<td><b>${int(h.q75)}만</b></td>`
            + `<td class="tl">${escape(new Date(h.created_at).toLocaleDateString("ko-KR"))}</td>`
            + `<td><button type="button" class="ghost ta-del" data-id="${h.id}">지우기</button></td>`
            + `</tr>`).join("")
        + "</tbody></table>";
}

async function openHistory(id) {
    const { data, error } = await db.rpc("api_trade_area_get", { p_id: id });
    if (error || !data || data.ok === false) {
        status("분석을 불러오지 못했습니다 — "
            + (error ? error.message : (data && data.reason) || ""), true);
        return;
    }
    status("");
    render(data.result);
    window.scrollTo({ top: 0, behavior: "instant" });
}

// ---------------------------------------------------------------- 배선

async function run() {
    const address = $("ta-address").value.trim();
    if (!address) { status("주소를 입력하세요.", true); return; }
    const radius = Number($("ta-radius").value) || 500;
    const button = $("ta-run");
    button.disabled = true;
    brandsExpanded = false;
    status("상권 데이터를 수집하고 있습니다 — 반경이 넓으면 1분 안팎 걸립니다…");
    try {
        const raw = await fetchAnalysis(address, radius);
        if (!raw || raw.ok === false) {
            status("분석 실패 — " + ((raw && raw.error) || "서버 응답 없음"), true);
            return;
        }
        const r = computeModel(raw, $("ta-name").value.trim());
        render(r);
        status("");
        await saveResult(r, address);
    } catch (e) {
        status("분석 실패 — " + (e && e.message ? e.message : String(e)), true);
    } finally {
        button.disabled = false;
    }
}

export function initTradeArea() {
    $("ta-run").addEventListener("click", run);
    for (const id of ["ta-address", "ta-name"]) {
        $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    }
    $("ta-brands-all").addEventListener("click", () => {
        brandsExpanded = !brandsExpanded;
        if (lastResult) drawBrands(lastResult);
    });
    $("t-ta-history").addEventListener("click", async (e) => {
        const del = e.target.closest(".ta-del");
        if (del) {
            e.stopPropagation();
            if (!window.confirm("이 분석 기록을 지울까요?")) return;
            const { data, error } = await db.rpc("api_trade_area_delete",
                { p_id: Number(del.dataset.id) });
            if (error || (data && data.ok === false)) {
                status("지우지 못했습니다 — " + (error ? error.message : data.reason), true);
                return;
            }
            await loadHistory();
            return;
        }
        const row = e.target.closest(".ta-row");
        if (row) openHistory(Number(row.dataset.id));
    });
    // 이력은 탭에 처음 들어올 때 한 번만 조회합니다(부팅 조회 절약 — app.js 방침).
    document.addEventListener("mitaly:area-shown", (e) => {
        if (e.detail && e.detail.area === "tradearea" && !historyLoaded) loadHistory();
    });
}
