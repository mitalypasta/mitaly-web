// 식자재·발주 (10번 영역) — 레시피 + 이론 사용량. app.js 에서 뽑은 영역 모듈
// (docs/web-split-plan.md). db + foundation 만 import.
//
// 발주량(아워홈) 카드는 같은 화면 안이지만 ourhome.js 로 따로 뺐습니다.

import { db } from "./client.js";
import { int, ymLabel, wonFull } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

let recipeRows = [];       // api_recipes 전체(278행 수준) — select 와 표가 같이 씀
let iuRangeReady = false;  // 기간 select 는 첫 응답의 ym_min~ym_max 로 한 번만 채움

export async function initIngredients() {
    // 레시피는 몇백 행뿐이라 한 번에 다 받아 화면에서 거릅니다(D10 jsonb 한 줄).
    const { data, error } = await db.rpc("api_recipes", {});
    if (!error) recipeRows = (((data || [])[0]) || {}).items || [];

    const menuSelect = $("rc-menu");
    const menus = [...new Set(recipeRows.map((r) => r.menu))];
    menus.sort((a, b) => a.localeCompare(b, "ko"));
    for (const name of menus) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        menuSelect.append(opt);
    }
    $("recipe-meta").textContent = recipeRows.length
        ? `메뉴 ${int(menus.length)}개 · ${int(recipeRows.length)}행`
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
                         r.supply_won == null ? "—" : wonFull(r.supply_won)]));
}

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

    $("iu-meta").textContent = d.from_ym
        ? `${ymLabel(d.from_ym)} ~ ${ymLabel(d.to_ym)}`
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
        `레시피가 있는 메뉴 ${int(cov.menu_matched)}/${int(cov.menu_total)}개 · ` +
        `판매 수량 기준 ${pct}% 가 이 계산에 들어갔습니다.`;

    const ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
    table($("t-ingredient-usage"),
        ["재료", "이론 사용량(g·개)", "이론 공급가", "쓰는 메뉴 수"],
        ingredients.map((r) => [r.ingredient, int(r.amount), wonFull(r.cost), int(r.menus)]));

    const unmatched = Array.isArray(d.unmatched_top) ? d.unmatched_top : [];
    if (unmatched.length) {
        table($("t-iu-unmatched"),
            ["레시피 없는 메뉴 (판매 상위)", "분류", "판매 수량"],
            unmatched.map((u) => [u.menu, u.category || "—", int(u.qty)]));
    } else {
        $("t-iu-unmatched").innerHTML = "";
    }
}
