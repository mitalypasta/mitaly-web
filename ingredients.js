// 식자재·발주 (10번 영역) — 조리 레시피 + 발주 상품 + 레시피 소요량 + 이론
// 사용량. app.js 에서 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation
// 만 import.
//
// 발주량(아워홈) 카드는 같은 화면 안이지만 ourhome.js 로 따로 뺐습니다.
//
// 두 레시피 원천을 구분해 보여줍니다 (큐 #102 [A]·[C]·[D], CLAUDE.md 10번 정정):
//   · 조리 레시피(58_menu_recipes, 98메뉴) — 이미지레시피 원본, 조리 단위
//   · 원가분석(32_recipes, 40메뉴)        — g 수 + 공급단가 확정분
// 이론 사용량은 원가분석만 씁니다(49). "원가분석 없는 메뉴" 가 조리 레시피까지
// 없다는 뜻이 아니라서, 그 표에 조리 레시피 유무를 같이 표시합니다.

import { db, fetchStores } from "./client.js";
import { int, ymLabel, wonFull } from "./format.js";
import { escape } from "./util.js";
import { table, $, monthPicker } from "./dom.js";

let recipeRows = [];       // api_recipes 전체(278행 수준) — select 와 표가 같이 씀
let menuRecipeRows = [];   // api_menu_recipes 전체(617행 수준, 데코 제외)
let menuRecipeNames = new Set();   // 조리 레시피가 있는 메뉴 이름 (표 [C] 표시용)
let supplyRows = [];       // api_supply_products 전체(209품목 수준)
let iuRangeReady = false;  // 기간 select 는 첫 응답의 ym_min~ym_max 로 한 번만 채움

export async function initIngredients() {
    // 레시피·상품 마스터는 몇백 행뿐이라 한 번에 다 받아 화면에서 거릅니다
    // (D10 jsonb 한 줄). 서로 독립 조회라 같이 던집니다.
    const [costRes, mrRes, mrStatusRes, spRes] = await Promise.all([
        db.rpc("api_recipes", {}),
        db.rpc("api_menu_recipes", {}),
        db.rpc("api_menu_recipe_status", {}),
        db.rpc("api_supply_products", {}),
    ]);
    if (!costRes.error) recipeRows = (((costRes.data || [])[0]) || {}).items || [];

    initMenuRecipes(mrRes, mrStatusRes);
    initSupplyProducts(spRes);

    const menuSelect = $("rc-menu");
    const menus = [...new Set(recipeRows.map((r) => r.menu))];
    menus.sort((a, b) => a.localeCompare(b, "ko"));
    for (const name of menus) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        menuSelect.append(opt);
    }
    // '메뉴 40개' 가 레시피 전부로 읽히지 않게 원천을 메타에도 밝힙니다 ([D]).
    $("recipe-meta").textContent = recipeRows.length
        ? `원가분석 메뉴 ${int(menus.length)}개 · ${int(recipeRows.length)}행`
        : "";
    menuSelect.addEventListener("change", renderRecipes);
    renderRecipes();

    // 이론 사용량 — 매장 목록은 방문·점검과 같은 원천(stores 표)입니다.
    const storeSelect = $("iu-store");
    const { data: stores } = await fetchStores();
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.name;            // api_ingredient_usage 는 이름으로 거릅니다
        opt.textContent = s.name;
        storeSelect.append(opt);
    }
    // 시작·종료월은 브라우저 달력(0-1). 값 규칙(YYYYMM)은 monthPicker 가 맞춥니다.
    monthPicker("iu-from");
    monthPicker("iu-to");
    for (const id of ["iu-from", "iu-to", "iu-store"]) {
        $(id).addEventListener("change", refreshIngredientUsage);
    }
    await refreshIngredientUsage();
}

// ---- 조리 레시피 (58_menu_recipes) — 큐 #102 [A] ----
//
// 4라운드 재설계: 행 단위(메뉴×원료) 나열은 메뉴명이 원료 수만큼 반복돼
// (98메뉴·833행) 보기 불편하다는 담당자 피드백 — 기본을 **메뉴 목록**으로
// 바꾸고, 메뉴 행의 ▸ 토글로 원료 상세를 펼칩니다(급증·급감 카드의 매장→채널
// 패턴 그대로 — 컨테이너 위임 클릭 + Set 으로 펼침 유지, styles.css 의
// .alerts-exp/.alerts-chrow 재사용). 필터(검색·메뉴·상태)는 메뉴 단위로
// 동작하고, 엑셀 내보내기는 options.export 로 평탄한 메뉴×원료 행을 그대로
// 등록합니다(엑셀에서는 반복이 정상).

// 펼쳐 둔 메뉴. 필터·검색으로 다시 그려도 펼침 상태를 잃지 않습니다.
const mrOpen = new Set();

function initMenuRecipes(mrRes, mrStatusRes) {
    if (mrRes.error) {
        $("t-menu-recipes").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(mrRes.error.message) + "</p>";
        return;
    }
    menuRecipeRows = Array.isArray(mrRes.data) ? mrRes.data : [];
    menuRecipeNames = new Set(menuRecipeRows.map((r) => r.menu));

    const menuSelect = $("mr-menu");
    const menus = [...menuRecipeNames];
    menus.sort((a, b) => a.localeCompare(b, "ko"));
    for (const name of menus) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        menuSelect.append(opt);
    }
    const statusSelect = $("mr-status");
    for (const status of [...new Set(menuRecipeRows.map((r) => r.status))]) {
        const opt = document.createElement("option");
        opt.value = status;
        opt.textContent = status;
        statusSelect.append(opt);
    }

    // 상태 요약은 서버 함수(api_menu_recipe_status)가 원천입니다 — 무엇이 아직
    // 확정 안 됐는지(49 커버리지와 같은 취지)를 화면이 정직하게 보이게.
    const st = (!mrStatusRes.error && mrStatusRes.data) || null;
    if (st && st.lines) {
        $("mr-meta").textContent =
            `메뉴 ${int(st.menus)}개 · ${int(st.lines)}행 · g 확정 ${int(st.grams_known)}행`;
        const byStatus = st.by_status || {};
        const parts = Object.keys(byStatus)
            .sort((a, b) => byStatus[b] - byStatus[a])
            .map((k) => `${k} ${int(byStatus[k])}`);
        // 부피 환산(74)까지 하고도 안 잡히는 행 — 개당 중량 미확인 등(null 유지 방침).
        const openLines = menuRecipeRows
            .filter((r) => r.grams == null && r.volume_value == null).length;
        $("mr-coverage").textContent =
            `상태별 메뉴: ${parts.join(" · ")}` +
            (openLines ? ` · g·부피 미확정 ${int(openLines)}행` : "");
    }

    menuSelect.addEventListener("change", () => {
        // 특정 메뉴를 골랐으면 바로 펼쳐 보입니다 — 접힌 한 줄만 남아
        // 한 번 더 눌러야 하는 헛걸음을 막습니다.
        if (menuSelect.value) mrOpen.add(menuSelect.value);
        renderMenuRecipes();
    });
    statusSelect.addEventListener("change", renderMenuRecipes);
    $("mr-q").addEventListener("input", renderMenuRecipes);

    // 행은 다시 그려도 컨테이너는 그대로라 위임 클릭을 한 번만 겁니다.
    $("t-menu-recipes").addEventListener("click", (event) => {
        const button = event.target.closest(".mr-exp");
        if (!button) return;
        const name = button.dataset.exp;
        if (mrOpen.has(name)) mrOpen.delete(name);
        else mrOpen.add(name);
        button.classList.toggle("open", mrOpen.has(name));
        button.setAttribute("aria-expanded", String(mrOpen.has(name)));
        syncMenuRecipeRows();
    });
    renderMenuRecipes();
}

// 메뉴 행 아래 원료 행의 보이기를 펼침 상태에 맞춥니다.
function syncMenuRecipeRows() {
    $("t-menu-recipes").querySelectorAll("tbody tr").forEach((tr) => {
        const marker = tr.querySelector(".mr-chind");
        if (!marker) return;
        tr.classList.add("alerts-chrow");
        tr.hidden = !mrOpen.has(marker.dataset.parent);
    });
}

function renderMenuRecipes() {
    if (!menuRecipeRows.length) {
        $("t-menu-recipes").innerHTML =
            '<p class="hint">반입된 조리 레시피가 없습니다. tools/import_menu_recipes.py 로 반입하면 여기 나타납니다.</p>';
        return;
    }
    const menu = $("mr-menu").value;
    const status = $("mr-status").value;
    const query = $("mr-q").value.trim();

    // 메뉴 단위로 묶습니다(원본 순서 유지). 필터도 메뉴 단위 — 상태·검색이
    // 걸린 메뉴는 원료 상세를 통째로 보여 줍니다(원료 행을 잘라내면 펼쳤을
    // 때 레시피가 불완전하게 보입니다).
    const groups = new Map();
    for (const r of menuRecipeRows) {
        if (!groups.has(r.menu)) groups.set(r.menu, []);
        groups.get(r.menu).push(r);
    }
    const shown = [...groups.entries()].filter(([name, list]) =>
        (!menu || name === menu)
        && (!status || list.some((r) => r.status === status))
        && (!query || name.includes(query)
            || list.some((r) => (r.ingredient || "").includes(query))));

    $("mr-shown").textContent = shown.length === groups.size
        ? `메뉴 ${int(groups.size)}개 · 행을 누르면 원료가 펼쳐집니다`
        : `메뉴 ${int(shown.length)} / ${int(groups.size)}개`;

    // 74 — 레들은 oz, 계량컵은 ml. 원본이 적은 단위 그대로입니다.
    const volText = (r) =>
        (r.volume_value == null ? "—" : `${r.volume_value}${r.volume_unit}`);

    const rows = shown.flatMap(([name, list]) => {
        const open = mrOpen.has(name);
        const statuses = [...new Set(list.map((r) => r.status))];
        const openLines = list
            .filter((r) => r.grams == null && r.volume_value == null).length;
        const menuRow = [
            `<button type="button" class="alerts-exp mr-exp${open ? " open" : ""}"`
                + ` data-exp="${escape(name)}" aria-expanded="${open}"`
                + ` aria-label="원료 펼치기"></button>${escape(name)}`,
            escape(statuses.join(" · ")),
            `원료 ${int(list.length)}`
                + (openLines ? ` · g·부피 미확정 ${int(openLines)}` : ""),
            "", "", "",
        ];
        const detailRows = list.map((r) => [
            `<span class="mr-chind" data-parent="${escape(name)}"></span>`,
            `<span class="meta">${escape(r.sheet)}</span>`,
            escape(r.ingredient),
            escape(r.qty_text ?? ""),
            r.grams == null ? "—" : int(r.grams),
            escape(volText(r)),
        ]);
        return [menuRow, ...detailRows];
    });

    table($("t-menu-recipes"),
        ["메뉴", "상태", "재료", "소요량(원문)", "g", "부피"],
        rows, {
            html: true,
            // 엑셀은 종전 그대로 평탄한 메뉴×원료 행 — 필터는 화면과 같이 먹고,
            // 펼침 여부와 무관하게 걸린 메뉴의 전 행이 나갑니다.
            export: {
                headers: ["시트", "상태", "메뉴", "재료", "소요량(원문)", "g", "부피"],
                rows: shown.flatMap(([, list]) => list.map((r) => [
                    r.sheet, r.status, r.menu, r.ingredient, r.qty_text,
                    r.grams == null ? "—" : int(r.grams),
                    volText(r),
                ])),
            },
        });
    syncMenuRecipeRows();
}

// ---- 발주 상품 마스터 (58_menu_recipes supply_products) — 큐 #102 [A] ----

function initSupplyProducts(spRes) {
    if (spRes.error) {
        $("t-supply-products").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(spRes.error.message) + "</p>";
        return;
    }
    supplyRows = Array.isArray(spRes.data) ? spRes.data : [];

    const withCode = supplyRows.filter((r) => r.code != null).length;
    $("sp-meta").textContent = supplyRows.length
        ? `${int(supplyRows.length)}품목 · 아워홈 코드 ${int(withCode)}`
        : "";

    const catSelect = $("sp-cat");
    const cats = [...new Set(supplyRows.map((r) => r.category).filter(Boolean))];
    cats.sort((a, b) => a.localeCompare(b, "ko"));
    for (const cat of cats) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        catSelect.append(opt);
    }

    $("sp-q").addEventListener("input", renderSupplyProducts);
    catSelect.addEventListener("change", renderSupplyProducts);
    renderSupplyProducts();
}

function renderSupplyProducts() {
    if (!supplyRows.length) {
        $("t-supply-products").innerHTML =
            '<p class="hint">반입된 발주 상품이 없습니다. tools/import_recipes.py 로 반입하면 여기 나타납니다.</p>';
        return;
    }
    const query = $("sp-q").value.trim();
    const cat = $("sp-cat").value;
    let rows = supplyRows;
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (query) {
        rows = rows.filter((r) => (r.product || "").includes(query)
            || (r.code || "").includes(query));
    }
    table($("t-supply-products"),
        ["구분", "전용", "코드번호", "상품명", "규격", "출고단위", "규격 g"],
        rows.map((r) => [
            r.category || "—", r.exclusive || "—", r.code || "—", r.product,
            r.spec || "—", r.ship_unit || "—",
            r.spec_grams == null ? "—" : int(r.spec_grams),
        ]));
}

// ---- 레시피 소요량 (32_recipes, 원가분석) ----

function renderRecipes() {
    if (!recipeRows.length) {
        $("t-recipes").innerHTML =
            '<p class="hint">반입된 레시피가 없습니다. tools/import_recipes.py 로 반입하면 여기 나타납니다.</p>';
        return;
    }
    const menu = $("rc-menu").value;
    const rows = menu ? recipeRows.filter((r) => r.menu === menu) : recipeRows;
    table($("t-recipes"), ["분류", "메뉴", "재료", "1인분 소요량(g·개)", "1인분 공급가"],
        rows.map((r) => [r.category, r.menu, r.ingredient, int(r.grams),
                         // 원천에 단가가 빈 재료(3행 수준) — 0원이 아니라 미상입니다 ([H]).
                         r.supply_won == null ? "단가 미상" : wonFull(r.supply_won)]));
}

// ---- 이론 재료 사용량 (49_ingredient_usage) ----

async function refreshIngredientUsage() {
    const args = {};
    if ($("iu-from").value) args.p_from = Number($("iu-from").value);
    if ($("iu-to").value) args.p_to = Number($("iu-to").value);
    if ($("iu-store").value) args.p_store = $("iu-store").value;

    const { data, error } = await db.rpc("api_ingredient_usage", args);
    if (error) {
        $("t-ingredient-usage").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};

    if (!iuRangeReady && d.ym_min) {
        iuRangeReady = true;
        monthPicker("iu-from", { min: d.ym_min, max: d.ym_max });
        monthPicker("iu-to", { min: d.ym_min, max: d.ym_max });
        $("iu-from").value = String(d.from_ym);
        $("iu-to").value = String(d.to_ym);
    }

    // 기본창이 진행 중인 달까지 물면 발주량(월 마감 자료)과 숫자가 안 맞아
    // 보입니다 ([F]). 창을 좁히는 대신 진행 중임을 밝힙니다.
    const now = new Date();
    const currentYm = now.getFullYear() * 100 + (now.getMonth() + 1);
    $("iu-meta").textContent = d.from_ym
        ? `${ymLabel(d.from_ym)} ~ ${ymLabel(d.to_ym)}` +
          (d.to_ym === currentYm ? ` · ${ymLabel(d.to_ym)}은 집계 진행 중` : "")
        : "";

    const cov = d.coverage || {};
    if (!cov.qty_total) {
        $("iu-coverage").textContent = "";
        $("t-ingredient-usage").innerHTML =
            '<p class="hint">선택한 기간에 판매 데이터가 없습니다.</p>';
        $("t-iu-unmatched").innerHTML = "";
        return;
    }

    // 커버리지를 숨기지 않습니다 — 원가분석 메뉴명과 매핑표 메뉴명이 어긋난
    // 만큼 계산에서 빠지므로, 몇 % 가 들어간 숫자인지 같이 보여야 합니다.
    const pct = Math.round((1000 * cov.qty_matched) / cov.qty_total) / 10;
    $("iu-coverage").textContent =
        `원가분석이 있는 메뉴 ${int(cov.menu_matched)}/${int(cov.menu_total)}개 · ` +
        `판매 수량 기준 ${pct}% 가 이 계산에 들어갔습니다.`;

    // 단가가 빈 재료는 공급가 합계에 0 으로 들어가 과소 표시됩니다 ([H]).
    // 합계를 손대지 않고(추정 금지) 그 재료만 표시로 구분합니다.
    const unknownPrice = new Set(
        recipeRows.filter((r) => r.supply_won == null).map((r) => r.ingredient));
    const ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
    table($("t-ingredient-usage"),
        ["재료", "이론 사용량(g·개)", "이론 공급가", "쓰는 메뉴 수"],
        ingredients.map((r) => [r.ingredient, int(r.amount),
            unknownPrice.has(r.ingredient)
                ? `${wonFull(r.cost)} · 일부 단가 미상`
                : wonFull(r.cost),
            int(r.menus)]));

    // "레시피 없음" 이 아닙니다 — 이 표의 상위 메뉴 대부분은 조리 레시피(58)는
    // 있고 원가분석(32)만 없습니다 ([C]). 그 구분을 열로 보여줍니다.
    const unmatched = Array.isArray(d.unmatched_top) ? d.unmatched_top : [];
    if (unmatched.length) {
        table($("t-iu-unmatched"),
            ["원가분석 없는 메뉴 (판매 상위)", "분류", "판매 수량", "조리 레시피"],
            unmatched.map((u) => [u.menu, u.category || "—", int(u.qty),
                menuRecipeNames.has(u.menu) ? "있음" : "—"]));
    } else {
        $("t-iu-unmatched").innerHTML = "";
    }
}
