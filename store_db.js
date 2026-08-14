// 가맹점 DB (9번 기반) — api_store_profiles(35) 표 + 인라인 수정 + 신규 등록.
// app.js 에서 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// 수정은 행 단위 인라인. RLS update 를 열지 않고 전용 함수(save_store_profile,
// 44 — updated_by 기록)로만 저장합니다.

import { db } from "./client.js";
import { int } from "./format.js";
import { escape, debounce } from "./util.js";
import { table, $ } from "./dom.js";

const SDB_COLS = [
    ["category", "분류"],
    ["sv_name", "담당 SV"],
    ["region", "지역"],
    ["order_method", "주문방식"],
    ["pos", "포스"],
    ["business_start_date", "영업시작일"],
];
let sdbRows = [];          // [{store_id, store_name, category, ... , has_profile}]
let sdbEditingId = null;   // 지금 편집 중인 store_id (한 번에 한 행만)

export async function initStoreDb() {
    const [profRes, storeRes] = await Promise.all([
        db.rpc("api_store_profiles"),
        db.from("stores").select("id,name").order("name"),
    ]);
    if (profRes.error) {
        $("sdb-table").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(profRes.error.message) + "</p>";
        return;
    }

    const byId = new Map();
    for (const p of (Array.isArray(profRes.data) ? profRes.data : [])) {
        byId.set(Number(p.store_id), { ...p, has_profile: true });
    }
    for (const s of storeRes.data || []) {
        if (!byId.has(Number(s.id))) {
            byId.set(Number(s.id), {
                store_id: Number(s.id), store_name: s.name, has_profile: false,
                category: null, sv_name: null, region: null,
                order_method: null, pos: null, business_start_date: null,
            });
        }
    }
    sdbRows = [...byId.values()].sort((a, b) =>
        a.store_name.localeCompare(b.store_name, "ko"));

    // SV·지역 필터는 실제 들어 있는 값으로만 만듭니다(빈 목록이면 그냥 '전체').
    fillDistinct($("sdb-sv"), sdbRows.map((r) => r.sv_name));
    fillDistinct($("sdb-region"), sdbRows.map((r) => r.region));

    for (const id of ["sdb-sv", "sdb-region"]) {
        $(id).addEventListener("change", drawStoreDb);
    }
    $("sdb-search").addEventListener("input", debounce(drawStoreDb, 150));
    $("sdb-n-submit").addEventListener("click", submitNewStore);
    drawStoreDb();
}

function fillDistinct(select, values) {
    const seen = [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ko"));
    for (const v of seen) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.append(opt);
    }
}

function sdbFiltered() {
    const sv = $("sdb-sv").value;
    const region = $("sdb-region").value;
    const search = $("sdb-search").value.trim();
    return sdbRows.filter((r) =>
        (!sv || r.sv_name === sv)
        && (!region || r.region === region)
        && (!search || r.store_name.includes(search)));
}

function drawStoreDb() {
    sdbEditingId = null;                       // 필터가 바뀌면 편집 행은 접습니다
    sdbRender();
}

function sdbEditRow(r) {
    const inputs = SDB_COLS.map(([key]) => {
        if (key === "business_start_date") {
            return `<td><input type="date" data-key="${key}"
                value="${escape(r[key] || "")}"></td>`;
        }
        return `<td><input type="text" data-key="${key}" autocomplete="off"
            value="${escape(r[key] || "")}"></td>`;
    }).join("");
    return `<tr data-id="${r.store_id}" class="sdb-editing">`
        + `<td>${escape(r.store_name)}</td>${inputs}`
        + `<td><button type="button" class="primary" id="sdb-save">저장</button> `
        + `<button type="button" class="linkish" id="sdb-cancel">취소</button></td></tr>`;
}

// 표 한 벌을 그립니다. sdbEditingId 가 가리키는 행만 입력칸으로 바뀝니다.
function sdbRender() {
    const list = sdbFiltered();
    const missing = sdbRows.filter((r) => !r.has_profile).length;
    $("sdb-summary").textContent =
        `${int(list.length)}곳 표시 · 전체 ${int(sdbRows.length)}곳`
        + (missing ? ` · 프로필 없는 매장 ${int(missing)}곳` : "");

    if (!list.length) {
        $("sdb-table").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }

    const head = ["매장", ...SDB_COLS.map(([, label]) => label), ""]
        .map((h) => `<th>${escape(h)}</th>`).join("");
    const body = list.map((r) => {
        if (r.store_id === sdbEditingId) return sdbEditRow(r);
        const cells = SDB_COLS.map(([key]) =>
            `<td>${escape(r[key] || "—")}</td>`).join("");
        return `<tr data-id="${r.store_id}"><td>${escape(r.store_name)}`
            + (r.has_profile ? "" : ' <span class="tag">프로필 없음</span>')
            + `</td>${cells}`
            + `<td><button type="button" class="linkish sdb-edit" data-id="${r.store_id}">수정</button></td></tr>`;
    }).join("");

    $("sdb-table").innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

    for (const b of $("sdb-table").querySelectorAll(".sdb-edit")) {
        b.addEventListener("click", () => sdbStartEdit(Number(b.dataset.id)));
    }
    if (sdbEditingId !== null) {
        $("sdb-save").addEventListener("click", () => sdbSave(sdbEditingId));
        $("sdb-cancel").addEventListener("click", () => { sdbEditingId = null; sdbRender(); });
        $("sdb-table").querySelector(".sdb-editing input")?.focus();
    }
}

function sdbStartEdit(storeId) {
    sdbEditingId = storeId;
    sdbRender();
}

async function sdbSave(storeId) {
    const notice = $("sdb-notice");
    const row = $("sdb-table").querySelector(`tr[data-id="${storeId}"]`);
    const values = {};
    for (const input of row.querySelectorAll("input")) {
        values[input.dataset.key] = input.value.trim() || null;
    }

    $("sdb-save").disabled = true;
    const { data, error } = await db.rpc("save_store_profile", {
        p_store_id: storeId,
        p_category: values.category,
        p_sv_name: values.sv_name,
        p_region: values.region,
        p_order_method: values.order_method,
        p_pos: values.pos,
        p_business_start_date: values.business_start_date,
    });

    if (error || !data?.ok) {
        $("sdb-save").disabled = false;
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: "
            + (error ? error.message : (data?.reason || "알 수 없는 이유"));
        return;
    }

    const local = sdbRows.find((r) => r.store_id === storeId);
    Object.assign(local, values, { has_profile: true });
    sdbEditingId = null;
    notice.hidden = false;
    notice.className = "notice";
    notice.textContent = `${data.store_name} 저장했습니다.`;
    sdbRender();
}

// 신규 매장 등록 — 매출 이력 0인 매장을 stores+프로필로 미리 만듭니다(44).
async function submitNewStore() {
    const notice = $("sdb-n-notice");
    const name = $("sdb-n-name").value.trim();
    if (!name) {
        notice.hidden = false;
        notice.className = "notice error";
        notice.textContent = "가맹점명은 필수입니다.";
        return;
    }

    $("sdb-n-submit").disabled = true;
    notice.hidden = false;
    notice.className = "notice";
    notice.textContent = "등록하는 중…";

    const { data, error } = await db.rpc("register_store", {
        p_name: name,
        p_category: $("sdb-n-category").value.trim() || null,
        p_sv_name: $("sdb-n-sv").value.trim() || null,
        p_region: $("sdb-n-region").value.trim() || null,
        p_order_method: $("sdb-n-order").value.trim() || null,
        p_pos: $("sdb-n-pos").value.trim() || null,
        p_business_start_date: $("sdb-n-start").value || null,
    });

    $("sdb-n-submit").disabled = false;
    if (error || !data?.ok) {
        notice.className = "notice error";
        notice.textContent = "등록하지 못했습니다: "
            + (error ? error.message : (data?.reason || "알 수 없는 이유"));
        return;
    }

    notice.className = "notice";
    notice.textContent = `${data.store_name} 등록했습니다. 매출이 올라오면 이 이름으로 이어집니다.`;
    for (const id of ["sdb-n-name", "sdb-n-category", "sdb-n-sv", "sdb-n-region",
                       "sdb-n-order", "sdb-n-pos", "sdb-n-start"]) {
        $(id).value = "";
    }
    // 서버가 정리한 값(트림·중복 검사)과 어긋나지 않게 처음부터 다시 받습니다.
    await reloadStoreDb();
}

// 등록 직후 서버 상태로 표를 다시 맞춥니다. 이벤트 리스너는 이미 걸려
// 있으므로 데이터만 다시 받습니다.
async function reloadStoreDb() {
    const [profRes, storeRes] = await Promise.all([
        db.rpc("api_store_profiles"),
        db.from("stores").select("id,name").order("name"),
    ]);
    if (profRes.error) return;
    const byId = new Map();
    for (const p of (Array.isArray(profRes.data) ? profRes.data : [])) {
        byId.set(Number(p.store_id), { ...p, has_profile: true });
    }
    for (const s of storeRes.data || []) {
        if (!byId.has(Number(s.id))) {
            byId.set(Number(s.id), {
                store_id: Number(s.id), store_name: s.name, has_profile: false,
                category: null, sv_name: null, region: null,
                order_method: null, pos: null, business_start_date: null,
            });
        }
    }
    sdbRows = [...byId.values()].sort((a, b) =>
        a.store_name.localeCompare(b.store_name, "ko"));
    drawStoreDb();
}
