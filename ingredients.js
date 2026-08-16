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

import { db } from "./client.js";
import { int, ymLabel, wonFull } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

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
    const { data: stores } = await db.from("stores").select("id,name").order("name");
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.name;            // api_ingredient_usage 는 이름으로 거릅니다
        opt.textContent = s.name;
        storeSelect.append(opt);
    }
    for (const id of ["iu-from", "iu-to", "iu-store"]) {
        $(id).addEventListener("change", refreshIngredientUsage);
    }
    await refreshIngredientUsage();
}

// ---- 조리 레시피 (58_menu_recipes) — 큐 #102 [A] ----

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

    menuSelect.addEventListener("change", renderMenuRecipes);
    statusSelect.addEventListener("change", renderMenuRecipes);
    renderMenuRecipes();
}

function renderMenuRecipes() {
    if (!menuRecipeRows.length) {
        $("t-menu-recipes").innerHTML =
            '<p class="hint">반입된 조리 레시피가 없습니다. tools/import_menu_recipes.py 로 반입하면 여기 나타납니다.</p>';
        return;
    }
    const menu = $("mr-menu").value;
    const status = $("mr-status").value;
    let rows = menuRecipeRows;
    if (menu) rows = rows.filter((r) => r.menu === menu);
    if (status) rows = rows.filter((r) => r.status === status);
    table($("t-menu-recipes"),
        ["시트", "상태", "메뉴", "재료", "소요량(원문)", "g", "부피"],
        rows.map((r) => [
            r.sheet, r.status, r.menu, r.ingredient, r.qty_text,
            r.grams == null ? "—" : int(r.grams),
            // 74 — 레들은 oz, 계량컵은 ml. 원본이 적은 단위 그대로입니다.
            r.volume_value == null ? "—" : `${r.volume_value}${r.volume_unit}`,
        ]));
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
        const options = [];
        let ym = d.ym_min;
        while (ym <= d.ym_max) {
            options.push(ym);
            ym = ym % 100 === 12 ? ym + 89 : ym + 1;   // 12월 → 다음 해 1월
        }
        for (const id of ["iu-from", "iu-to"]) {
            const sel = $(id);
            for (const value of options) {
                const opt = document.createElement("option");
                opt.value = String(value);
                opt.textContent = ymLabel(value);
                sel.append(opt);
            }
        }
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
