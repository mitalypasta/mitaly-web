// 미태리 매출 대시보드 — 프론트엔드
//
// 데이터베이스에서 이미 합계를 내서 내려주므로(api_* 함수), 이 파일은
// 받은 숫자를 그리기만 합니다. 59만 행을 브라우저로 가져오지 않습니다.
//
// 차트는 라이브러리 없이 SVG로 직접 그립니다. 막대 두께·모서리·간격 같은
// 규격을 정확히 지키기 위해서입니다.

// index.html?demo=1 로 열면 Supabase 없이 가짜 데이터로 화면만 봅니다.
const DEMO = new URLSearchParams(location.search).get("demo") === "1";

const CONFIG = window.MITALY_CONFIG || {};

let db;
if (DEMO) {
    const { demoClient } = await import("./demo.js");
    db = demoClient();
} else {
    if (!CONFIG.url || !CONFIG.anonKey || CONFIG.url.includes("여기에")) {
        const missing = !CONFIG.url || CONFIG.url.includes("여기에")
            ? "<code>url</code>과 <code>anonKey</code>"
            : "<code>anonKey</code>";
        // 인터넷에 올라간 화면인데 값이 비어 있으면, 대개 키를 채우기 전에
        // 올린 폴더가 그대로 남아 있는 경우입니다. 실제로 한 번 겪었습니다.
        const deployed = !["localhost", "127.0.0.1"].includes(location.hostname);
        document.body.innerHTML =
            '<div class="gate"><h1>설정이 필요합니다</h1>' +
            `<p><code>web/config.js</code> 의 ${missing} 가 비어 있습니다.</p>` +
            (deployed
                ? "<p><b>내 PC의 config.js에는 키를 넣었는데 이 화면이 보인다면, " +
                  "키를 넣기 전 폴더가 올라가 있는 것입니다. web 폴더를 다시 올리세요.</b></p>"
                : "<p>Supabase &gt; Settings &gt; API Keys 의 <b>anon</b> 또는 " +
                  "<b>publishable</b> 키입니다. (secret 키가 아닙니다)</p>") +
            '<p>먼저 화면만 보려면 <a href="?demo=1">데모 모드</a>로 여세요.</p></div>';
        throw new Error("config.js 가 설정되지 않았습니다.");
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    db = createClient(CONFIG.url, CONFIG.anonKey);
}

const $ = (id) => document.getElementById(id);
const gate = $("gate");
const app = $("app");
const tooltip = $("tooltip");

// 시리즈 색은 CSS 변수에서 읽습니다. 라이트/다크 전환 시 같이 바뀝니다.
const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const palette = () => ({
    s1: cssVar("--series-1"),
    s2: cssVar("--series-2"),
    grid: cssVar("--gridline"),
    base: cssVar("--baseline"),
    muted: cssVar("--text-muted"),
    secondary: cssVar("--text-secondary"),
    primary: cssVar("--text-primary"),
    surface: cssVar("--surface-1"),
});

const CHANNEL_COLORS = { "홀": "s1", "배달": "s2" };
const WEEKDAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

// ---------------------------------------------------------------- 숫자 표기

function won(value) {
    const v = Number(value) || 0;
    const sign = v < 0 ? "-" : "";
    const n = Math.abs(v);
    if (n >= 1e8) return `${sign}${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}억`;
    if (n >= 1e4) return `${sign}${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
    return `${sign}${n.toLocaleString("ko-KR")}`;
}

const wonFull = (v) => `${(Number(v) || 0).toLocaleString("ko-KR")}원`;
const int = (v) => (Number(v) || 0).toLocaleString("ko-KR");
const ymLabel = (ym) => `${String(ym).slice(0, 4)}.${String(ym).slice(4, 6)}`;

// ---------------------------------------------------------------- 로그인

async function boot() {
    const { data } = await db.auth.getSession();
    render(data.session);
    db.auth.onAuthStateChange((_event, session) => render(session));
}

function render(session) {
    if (session) {
        gate.hidden = true;
        app.hidden = false;
        $("who").textContent = session.user.email + " · ";
        if (!app.dataset.ready) {
            app.dataset.ready = "1";
            initDashboard();
        }
    } else {
        gate.hidden = false;
        app.hidden = true;
    }
}

// 오류 메시지를 사람 말로 바꿉니다. 영어 원문 그대로 두면 아무도 못 알아봅니다.
function friendlyAuthError(message) {
    const text = String(message || "");
    if (/rate limit/i.test(text)) {
        return "메일 발송 한도를 넘었습니다. 무료 기본 메일은 시간당 2통까지입니다. " +
               "비밀번호로 로그인하시거나, 1시간 뒤 다시 시도하세요.";
    }
    if (/invalid login credentials/i.test(text)) {
        return "이메일 또는 비밀번호가 맞지 않습니다.";
    }
    if (/email not confirmed/i.test(text)) {
        return "아직 메일 인증이 끝나지 않은 계정입니다.";
    }
    if (/signups not allowed|signup is disabled/i.test(text)) {
        return "가입이 잠겨 있습니다. 관리자에게 계정 등록을 요청하세요.";
    }
    return text;
}

function checkDomain(email, notice) {
    const domains = CONFIG.allowedEmailDomains || [];
    if (domains.length && !domains.some((d) => email.toLowerCase().endsWith("@" + d))) {
        notice.className = "notice error";
        notice.textContent = `회사 이메일(${domains.join(", ")})로만 로그인할 수 있습니다.`;
        return false;
    }
    return true;
}

// 기본 로그인 = 비밀번호. 메일 발송 한도에 걸리지 않습니다.
$("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    const notice = $("gate-notice");
    const button = $("login-button");

    if (!checkDomain(email, notice)) return;
    if (!password) {
        notice.className = "notice error";
        notice.textContent =
            "비밀번호를 입력하세요. 모르시면 아래 '이메일로 로그인 링크 받기'를 누르세요.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "확인 중…";

    const { error } = await db.auth.signInWithPassword({ email, password });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = friendlyAuthError(error.message);
    } else {
        notice.textContent = "";
    }
});

// 보조 수단 = 메일 링크. 한도가 있으니 비밀번호를 모를 때만 씁니다.
$("magic-link").addEventListener("click", async () => {
    const email = $("email").value.trim();
    const notice = $("gate-notice");

    if (!email) {
        notice.className = "notice error";
        notice.textContent = "이메일을 먼저 입력하세요.";
        return;
    }
    if (!checkDomain(email, notice)) return;

    notice.className = "notice";
    notice.textContent = "보내는 중…";

    const { error } = await db.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href.split("#")[0] },
    });

    if (error) {
        notice.className = "notice error";
        notice.textContent = friendlyAuthError(error.message);
    } else {
        notice.className = "notice";
        notice.textContent = "메일함을 확인하세요. 링크를 누르면 로그인됩니다.";
    }
});

$("logout").addEventListener("click", () => db.auth.signOut());

$("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.getAttribute("data-theme") === "dark"
        || (!root.hasAttribute("data-theme")
            && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "light" : "dark");
    if (lastData) draw(lastData);
});

// ---------------------------------------------------------------- 대시보드

let lastData = null;

async function initDashboard() {
    const { data, error } = await db.rpc("api_filters");
    if (error) return fail(error);

    const info = Array.isArray(data) ? data[0] : data;
    if (!info || !info.ym_max) {
        $("app-notice").textContent =
            "아직 올라온 데이터가 없습니다. 수집 PC에서 업로더를 먼저 실행하세요.";
        return;
    }

    const months = monthsBetween(info.ym_min, info.ym_max);
    fillSelect($("f-from"), months, ymLabel);
    fillSelect($("f-to"), months, ymLabel);

    // 기본값: 최근 12개월
    $("f-from").value = String(months[Math.max(0, months.length - 12)]);
    $("f-to").value = String(info.ym_max);

    const storeSelect = $("f-store");
    for (const name of info.stores || []) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        storeSelect.append(option);
    }

    // 내보내기 기본 기간을 데이터 범위에 맞추는 데 씁니다.
    filterRange = { min: info.ym_min, max: info.ym_max };

    for (const id of ["f-from", "f-to", "f-store", "f-channel"]) {
        $(id).addEventListener("change", load);
    }

    document.querySelectorAll("[data-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = $(button.dataset.toggle);
            target.hidden = !target.hidden;
            button.textContent = target.hidden ? "표로 보기" : "차트로 보기";
        });
    });

    // 창 크기 대신 카드 영역의 실제 너비를 봅니다.
    // 창 크기가 안 바뀌어도 칸 배치가 달라질 수 있기 때문입니다.
    const redraw = debounce(() => lastData && draw(lastData), 150);
    let lastWidth = 0;
    new ResizeObserver((entries) => {
        const width = Math.round(entries[0].contentRect.width);
        if (width && width !== lastWidth) { lastWidth = width; redraw(); }
    }).observe(document.querySelector(".grid"));

    initRequests();
    initExport();

    await load();
    loadLastUpdated();
}

// ---------------------------------------------------------------- 수집 요청

// 5개 채널 전부 동작합니다. (요기요는 2026-07-23 완성)
const PLUGIN_LIST = [
    { id: "easypos", name: "이지포스", ready: true },
    { id: "baemin", name: "배달의민족", ready: true },
    { id: "imu", name: "아임유", ready: true },
    { id: "coupangeats", name: "쿠팡이츠", ready: true },
    { id: "yogiyo", name: "요기요", ready: true },
];

const STATUS_LABEL = {
    pending: "대기 중 — 수집 PC가 가져가면 시작합니다",
    running: "실행 중",
    done: "완료",
    failed: "실패",
    canceled: "취소됨",
};

let requestTimer = null;
let targets = [];              // 수집 대상 매장 카탈로그 (러너가 올려줌)
let chosenStores = new Set();  // 수집 요청용. 비어 있으면 '전체'
let xStores = new Set();       // 엑셀 내보내기용. 비어 있으면 '전체'

// 매장 선택창은 수집 요청과 내보내기가 함께 씁니다. 지금 어느 쪽이 열었는지에 따라
// 다른 선택 집합을 만집니다. 이렇게 안 하면 두 기능이 같은 선택을 공유해 버립니다.
let pickerCtx = "request";
function curStoreSet() { return pickerCtx === "export" ? xStores : chosenStores; }

function initRequests() {
    const box = $("r-plugins");
    for (const plugin of PLUGIN_LIST) {
        const label = document.createElement("label");
        label.innerHTML =
            `<input type="checkbox" value="${plugin.id}"` +
            `${plugin.ready ? " checked" : " disabled"}>` +
            `<span>${escape(plugin.name)}</span>`;
        box.append(label);
    }

    // 이지포스는 계정이 굿모닝/착한통신으로 나뉩니다. 기존 프로그램과 같은 규칙입니다.
    const profileBox = $("r-profiles");
    for (const name of ["굿모닝", "착한통신"]) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${name}" checked><span>${name}</span>`;
        profileBox.append(label);
    }

    // 이지포스를 껐다 켜면 계정 선택칸도 같이 숨기고 보입니다.
    const syncProfileVisibility = () => {
        const easypos = document.querySelector('#r-plugins input[value="easypos"]');
        $("r-profile-field").hidden = !(easypos && easypos.checked);
        refreshStoreButton();
    };
    document.querySelectorAll("#r-plugins input").forEach((el) =>
        el.addEventListener("change", syncProfileVisibility));
    syncProfileVisibility();

    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    $("r-from").value = isoDate(firstOfLastMonth);
    $("r-to").value = isoDate(yesterday);

    $("r-submit").addEventListener("click", submitRequest);
    initStorePicker();
    loadTargets();
    refreshRequests();
    refreshRunner();
}

// ---- 수집 대상 매장 ----------------------------------------------------

function selectedPlugins() {
    return [...document.querySelectorAll("#r-plugins input:checked")].map((el) => el.value);
}

async function loadTargets() {
    const { data, error } = await db.rpc("api_targets", { p_plugins: null });
    if (error) {
        // 아직 러너가 목록을 안 올렸거나 SQL 적용 전입니다.
        $("r-store-open").textContent = "전체 매장";
        $("r-store-open").disabled = false;
        return;
    }
    targets = data || [];
    refreshStoreButton();
}

// 고른 채널에 실제로 붙어 있는 매장만 보여줍니다.
function visibleTargets() {
    const plugins = selectedPlugins();
    if (!plugins.length) return targets;
    return targets.filter((t) => (t.plugins || []).some((p) => plugins.includes(p)));
}

function refreshStoreButton() {
    const total = visibleTargets().length;
    const chosen = [...chosenStores].filter((name) =>
        visibleTargets().some((t) => t.name === name)).length;
    $("r-store-open").textContent = chosen === 0
        ? `전체 매장${total ? ` (${total}개)` : ""}`
        : `${chosen}개 선택됨 / ${total}개`;
}

function initStorePicker() {
    const modal = $("store-modal");
    const open = (ctx) => {
        pickerCtx = ctx;
        modal.hidden = false;
        renderStoreList();
    };
    const close = () => { modal.hidden = true; };
    const applyRefresh = () => {
        // 열었던 쪽의 버튼만 갱신합니다.
        if (pickerCtx === "export") refreshExportStoreButton();
        else refreshStoreButton();
    };

    $("r-store-open").addEventListener("click", () => open("request"));
    const xOpen = $("x-store-open");
    if (xOpen) xOpen.addEventListener("click", () => open("export"));

    $("store-close").addEventListener("click", close);
    $("store-apply").addEventListener("click", () => { close(); applyRefresh(); });
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    $("store-search").addEventListener("input", renderStoreList);

    $("store-all").addEventListener("click", () => {
        visibleTargets().forEach((t) => curStoreSet().add(t.name));
        renderStoreList();
    });
    $("store-none").addEventListener("click", () => {
        curStoreSet().clear();
        renderStoreList();
    });
    $("store-filtered").addEventListener("click", () => {
        filteredTargets().forEach((t) => curStoreSet().add(t.name));
        renderStoreList();
    });
}

function filteredTargets() {
    const query = ($("store-search").value || "").trim();
    const list = visibleTargets();
    return query ? list.filter((t) => t.name.includes(query)) : list;
}

const PLUGIN_SHORT = {
    easypos: "포스", baemin: "배민", imu: "아임유",
    coupangeats: "쿠팡", yogiyo: "요기요",
};

function renderStoreList() {
    const set = curStoreSet();
    const list = filteredTargets();
    const total = visibleTargets().length;
    const tail = pickerCtx === "export" ? "전체 내보내기" : "전체 수집";

    $("store-count").textContent =
        `${set.size}개 선택 · 검색결과 ${list.length}개 / 전체 ${total}개` +
        (set.size === 0 ? `  (아무것도 안 고르면 ${tail})` : "");

    $("store-list").innerHTML = list.map((t) => `
        <label>
            <input type="checkbox" value="${escape(t.name)}"
                   ${set.has(t.name) ? "checked" : ""}>
            <span>${escape(t.name)}</span>
            <span class="chan">${(t.plugins || []).map((p) => PLUGIN_SHORT[p] || p).join("·")}</span>
        </label>`).join("")
        || '<p class="hint">해당하는 매장이 없습니다. 수집 PC가 목록을 아직 안 올렸을 수 있습니다.</p>';

    $("store-list").querySelectorAll("input").forEach((el) => {
        el.addEventListener("change", () => {
            if (el.checked) set.add(el.value);
            else set.delete(el.value);
            $("store-count").textContent =
                `${set.size}개 선택 · 검색결과 ${list.length}개 / 전체 ${total}개`;
        });
    });
}

function refreshExportStoreButton() {
    const btn = $("x-store-open");
    if (!btn) return;
    const total = targets.length;
    const chosen = [...xStores].filter((name) =>
        targets.some((t) => t.name === name)).length;
    btn.textContent = chosen === 0
        ? `전체 매장${total ? ` (${total}개)` : ""}`
        : `${chosen}개 선택됨 / ${total}개`;
}

// ---- 러너 상태 --------------------------------------------------------

async function refreshRunner() {
    const el = $("runner-state");
    const { data, error } = await db
        .from("runner_status").select("last_seen_at,hostname,busy,current_note").limit(1);

    if (error || !data || !data.length) {
        el.className = "runner";
        el.textContent = "수집 PC 상태를 알 수 없음";
    } else {
        const row = data[0];
        const ageSec = (Date.now() - new Date(row.last_seen_at).getTime()) / 1000;
        if (ageSec > 150) {
            el.className = "runner off";
            el.textContent = `수집 PC 꺼짐 · 마지막 응답 ${timeAgo(ageSec)}`;
        } else if (row.busy) {
            el.className = "runner busy";
            el.textContent = `수집 PC 작업 중 · ${row.current_note || ""}`;
        } else {
            el.className = "runner on";
            el.textContent = `수집 PC 연결됨${row.hostname ? ` (${row.hostname})` : ""}`;
        }
    }
    setTimeout(refreshRunner, 30000);
}

function timeAgo(seconds) {
    if (seconds < 3600) return `${Math.round(seconds / 60)}분 전`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}시간 전`;
    return `${Math.round(seconds / 86400)}일 전`;
}

const isoDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function submitRequest() {
    const notice = $("r-notice");
    const button = $("r-submit");
    const plugins = [...document.querySelectorAll("#r-plugins input:checked")]
        .map((el) => el.value);
    const from = $("r-from").value;
    const to = $("r-to").value;

    if (!plugins.length) {
        notice.className = "notice error";
        notice.textContent = "채널을 하나 이상 고르세요.";
        return;
    }
    if (!from || !to) {
        notice.className = "notice error";
        notice.textContent = "기간을 정하세요.";
        return;
    }
    if (from > to) {
        notice.className = "notice error";
        notice.textContent = "시작일이 종료일보다 뒤입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "요청하는 중…";

    // 고른 채널에 없는 매장은 빼고 보냅니다.
    const usable = new Set(visibleTargets().map((t) => t.name));
    const stores = [...chosenStores].filter((name) => usable.has(name));

    const profiles = plugins.includes("easypos")
        ? [...document.querySelectorAll("#r-profiles input:checked")].map((el) => el.value)
        : [];

    if (plugins.includes("easypos") && !profiles.length) {
        notice.className = "notice error";
        notice.textContent = "이지포스 계정을 하나 이상 고르세요 (굿모닝 / 착한통신).";
        button.disabled = false;
        return;
    }

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("collect_requests").insert({
        requested_by: session?.user?.id,
        plugins,
        date_from: from,
        date_to: to,
        stores,
        profiles,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "요청하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "요청했습니다. 수집 PC가 가져가면 아래에 진행 상황이 보입니다.";
    refreshRequests();
}

async function refreshRequests() {
    const { data, error } = await db
        .from("collect_requests")
        .select("id,requested_at,plugins,date_from,date_to,stores,profiles," +
                "status,progress,error,finished_at,log_tail")
        .order("id", { ascending: false })
        .limit(20);

    if (error) return;
    const rows = data || [];

    // 진행 중인 것만 카드 위에 크게 보여줍니다.
    const active = rows.filter((r) => r.status === "pending" || r.status === "running");

    // 요청이 한참 '대기 중'이면 수집 PC가 꺼져 있다는 뜻입니다.
    // 이 안내가 없으면 사용자는 버튼이 고장 난 줄 압니다.
    const STALE_MS = 120000;
    const stale = active.some((r) =>
        r.status === "pending" && Date.now() - new Date(r.requested_at).getTime() > STALE_MS);

    $("r-active").innerHTML = active.map((r) => {
        const waiting = r.status === "pending"
            && Date.now() - new Date(r.requested_at).getTime() > STALE_MS;
        return `
        <div class="runrow">
            <span class="dot st-${r.status}"></span>
            <span><b>#${r.id}</b> ${escape(r.date_from)} ~ ${escape(r.date_to)}</span>
            <span class="grow">${escape(
                r.progress || (waiting ? "수집 PC를 기다리는 중" : STATUS_LABEL[r.status] || r.status)
            )}</span>
        </div>`;
    }).join("") + (stale ? `
        <p class="notice">
            2분 넘게 시작되지 않고 있습니다. 수집 담당 PC가 꺼져 있거나
            수집 프로그램(<code>START_CLOUD_AGENT.bat</code>)이 실행되지 않은 상태입니다.
            <b>요청은 사라지지 않고, PC가 켜지면 그때 자동으로 실행됩니다.</b>
        </p>` : "");

    // 요청 내역 — 로그를 펼쳐 볼 수 있어야 문제가 생겼을 때 원인을 찾습니다.
    $("r-history").innerHTML = rows.map((r) => {
        const when = new Date(r.requested_at)
            .toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
        const scope = (r.stores || []).length ? `매장 ${r.stores.length}개` : "전 매장";
        const prof = (r.profiles || []).length ? ` · ${r.profiles.join("+")}` : "";
        return `
        <div class="runrow">
            <span class="dot st-${r.status}"></span>
            <span><b>#${r.id}</b></span>
            <span class="grow">${when} · ${escape(r.date_from)}~${escape(r.date_to)}
                · ${escape((r.plugins || []).map((p) => PLUGIN_SHORT[p] || p).join("·"))}
                · ${escape(scope)}${escape(prof)}
                · ${escape(STATUS_LABEL[r.status] || r.status)}
                ${r.error ? `· <b>${escape(r.error)}</b>` : ""}</span>
            ${r.log_tail ? `<button class="linkish" data-log="${r.id}">로그</button>` : ""}
        </div>
        <pre class="logbox" id="log-${r.id}" hidden>${escape(r.log_tail || "")}</pre>`;
    }).join("") || '<p class="hint">아직 요청이 없습니다.</p>';

    $("r-history").querySelectorAll("[data-log]").forEach((button) => {
        button.addEventListener("click", () => {
            const box = $(`log-${button.dataset.log}`);
            box.hidden = !box.hidden;
            button.textContent = box.hidden ? "로그" : "로그 닫기";
            if (!box.hidden) box.scrollTop = box.scrollHeight;
        });
    });

    // 진행 중이면 자주, 아니면 느리게 확인합니다.
    clearTimeout(requestTimer);
    requestTimer = setTimeout(refreshRequests, active.length ? 5000 : 60000);

    // 방금 끝난 요청이 있으면 대시보드 숫자도 새로 읽습니다.
    const justFinished = rows.some((r) =>
        r.status === "done" && r.finished_at &&
        Date.now() - new Date(r.finished_at).getTime() < 70000);
    if (justFinished) {
        load();
        loadLastUpdated();
    }
}

function monthsBetween(min, max) {
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

function fillSelect(select, values, label) {
    select.innerHTML = "";
    for (const value of values) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = label(value);
        select.append(option);
    }
}

function currentFilters() {
    let from = Number($("f-from").value);
    let to = Number($("f-to").value);
    if (from > to) [from, to] = [to, from];
    return {
        p_ym_from: from,
        p_ym_to: to,
        p_store: $("f-store").value || null,
        p_channel: $("f-channel").value || null,
    };
}

async function load() {
    const args = currentFilters();
    document.body.classList.add("loading");
    $("app-notice").textContent = "";

    // 매장 비교표는 매장 필터와 무관하게 전 매장을 보여줍니다(비교가 목적이라).
    const storeArgs = { p_ym_from: args.p_ym_from, p_ym_to: args.p_ym_to,
                        p_channel: args.p_channel };
    const rangeArgs = { p_ym_from: args.p_ym_from, p_ym_to: args.p_ym_to };

    const calls = [
        db.rpc("api_summary", args),
        db.rpc("api_monthly", args),
        db.rpc("api_by_store", args),
        db.rpc("api_by_menu", args),
        db.rpc("api_by_hour", args),
        db.rpc("api_by_weekday", args),
        db.rpc("api_coverage_by_source", rangeArgs),
        db.rpc("api_coverage_matrix", { ...rangeArgs, p_store: args.p_store }),
        db.rpc("api_nonstandard_stores", args),
        db.rpc("api_store_metrics", storeArgs),
        db.rpc("api_menu_matrix", { p_field: "trade_area", ...args }),
        db.rpc("api_menu_matrix", { p_field: "weekday", ...args }),
        db.rpc("api_menu_matrix", { p_field: "daypart", ...args }),
        db.rpc("api_unmapped", {}),
    ];

    const results = await Promise.all(calls);
    document.body.classList.remove("loading");

    const bad = results.find((r) => r.error);
    if (bad) return fail(bad.error);

    lastData = {
        args,
        summary: (results[0].data || [])[0] || {},
        monthly: results[1].data || [],
        stores: results[2].data || [],
        menus: results[3].data || [],
        hours: results[4].data || [],
        weekdays: results[5].data || [],
        coverageBySource: results[6].data || [],
        coverage: results[7].data || [],
        nonstandard: results[8].data || [],
        storeMetrics: results[9].data || [],
        menuArea: results[10].data || [],
        menuWeekday: results[11].data || [],
        menuDaypart: results[12].data || [],
        unmapped: results[13].data || [],
    };
    draw(lastData);
}

async function loadLastUpdated() {
    const { data } = await db
        .from("upload_batches")
        .select("uploaded_at")
        .order("uploaded_at", { ascending: false })
        .limit(1);
    const row = (data || [])[0];
    if (row) {
        const when = new Date(row.uploaded_at);
        $("last-updated").textContent =
            "마지막 갱신 " + when.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
    }
}

function fail(error) {
    $("app-notice").className = "notice error";
    $("app-notice").textContent = "데이터를 불러오지 못했습니다: " + (error.message || error);
    console.error(error);
}

// ---------------------------------------------------------------- 그리기

function draw(d) {
    const c = palette();

    $("kpi-amount").textContent = won(d.summary.amount);
    $("kpi-range").textContent =
        `${ymLabel(d.args.p_ym_from)} – ${ymLabel(d.args.p_ym_to)}` +
        (d.args.p_store ? ` · ${d.args.p_store}` : "") +
        (d.args.p_channel ? ` · ${d.args.p_channel}` : "");
    $("kpi-qty").textContent = int(d.summary.qty);
    $("kpi-stores").textContent = int(d.summary.store_count);
    $("kpi-menus").textContent = int(d.summary.menu_count);

    drawMonthly(d.monthly, c);

    drawBars($("c-store"), {
        rows: d.stores.slice(0, 15).map((r) => ({ label: r.store, value: Number(r.amount) })),
        color: c.s1, horizontal: true, colors: c,
    });
    table($("t-store"), ["매장", "상권", "매출", "수량"],
        d.stores.map((r) => [r.store, r.trade_area || "—", wonFull(r.amount), int(r.qty)]));

    drawBars($("c-menu"), {
        rows: d.menus.slice(0, 15).map((r) => ({ label: r.menu, value: Number(r.amount) })),
        color: c.s1, horizontal: true, colors: c,
    });
    table($("t-menu"), ["메뉴", "분류", "매출", "수량"],
        d.menus.map((r) => [r.menu, r.category || "—", wonFull(r.amount), int(r.qty)]));

    const hours = Array.from({ length: 24 }, (_, h) => {
        const found = d.hours.find((r) => Number(r.hour) === h);
        return { label: `${h}`, value: found ? Number(found.amount) : 0 };
    });
    drawBars($("c-hour"), { rows: hours, color: c.s1, horizontal: false, colors: c, unit: "시" });
    table($("t-hour"), ["시간대", "매출", "수량"],
        d.hours.map((r) => [`${r.hour}시`, wonFull(r.amount), int(r.qty)]));

    const weekdays = WEEKDAY_ORDER.map((w) => {
        const found = d.weekdays.find((r) => r.weekday === w);
        return { label: w, value: found ? Number(found.amount) : 0 };
    });
    drawBars($("c-weekday"), { rows: weekdays, color: c.s1, horizontal: false, colors: c });
    table($("t-weekday"), ["요일", "매출", "수량"],
        WEEKDAY_ORDER.map((w) => {
            const found = d.weekdays.find((r) => r.weekday === w) || {};
            return [w, wonFull(found.amount || 0), int(found.qty || 0)];
        }));

    drawCoverage(d);
    drawNonstandard(d, c);
    drawStoreMetrics(d);
    drawMenuMatrix($("c-area"), $("t-area"), d.menuArea, "trade_area");
    drawMenuMatrix($("c-mweek"), $("t-mweek"), d.menuWeekday, "weekday", WEEKDAY_ORDER);
    drawMenuMatrix($("c-mpart"), $("t-mpart"), d.menuDaypart, "daypart",
        ["아침", "점심", "오후", "저녁"]);
    drawUnmapped(d);
}

// ---- 히트맵 ----------------------------------------------------------
//
// 크기를 색의 진하기로 보여줍니다. 파랑 한 가지만 씁니다 — 여러 색을 섞으면
// 어느 쪽이 큰지 읽을 수 없습니다.

const HEAT_STEPS_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const HEAT_STEPS_DARK = ["#184f95", "#256abf", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4"];

function heatColor(value, max) {
    if (!value || !max) return null;
    const dark = getComputedStyle(document.documentElement)
        .getPropertyValue("--surface-1").trim() === "#1a1a19";
    const steps = dark ? HEAT_STEPS_DARK : HEAT_STEPS_LIGHT;
    const index = Math.min(steps.length - 1,
        Math.floor((value / max) * steps.length));
    return steps[index];
}

// 칸 안 글씨는 배경 밝기에 따라 흰색/검정을 고릅니다. 대비를 항상 확보하려고요.
function inkOn(hex) {
    if (!hex) return "var(--text-muted)";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.55 ? "#0b0b0b" : "#ffffff";
}

function renderHeat(container, { rows, cols, get, label, rowLabel = (r) => r }) {
    const max = Math.max(1, ...rows.flatMap((r) => cols.map((cx) => get(r, cx) || 0)));
    const head = cols.map((cx) => `<th>${escape(cx)}</th>`).join("");
    const body = rows.map((r) => {
        const cells = cols.map((cx) => {
            const v = get(r, cx) || 0;
            const bg = heatColor(v, max);
            return `<td class="cell${v ? "" : " empty"}"` +
                (bg ? ` style="background:${bg};color:${inkOn(bg)}"` : "") +
                ` title="${escape(rowLabel(r))} · ${escape(cx)} · ${label(v)}">` +
                `${v ? label(v) : "—"}</td>`;
        }).join("");
        return `<tr><th>${escape(rowLabel(r))}</th>${cells}</tr>`;
    }).join("");

    container.innerHTML =
        `<div class="heat"><table><thead><tr><th></th>${head}</tr></thead>` +
        `<tbody>${body}</tbody></table></div>`;
}

// ---- 수집 커버리지 ----------------------------------------------------

function drawCoverage(d) {
    const months = [...new Set(d.coverageBySource.map((r) => r.ym))].sort((a, b) => a - b);
    const sources = [...new Set(d.coverageBySource.map((r) => r.source))].sort();
    const index = new Map(d.coverageBySource.map((r) => [`${r.source}|${r.ym}`, r]));

    renderHeat($("c-coverage"), {
        rows: sources,
        cols: months.map(ymLabel),
        rowLabel: (s) => s,
        get: (source, label) => {
            const ym = Number(label.replace(".", ""));
            return (index.get(`${source}|${ym}`) || {}).store_count || 0;
        },
        label: (v) => String(v),
    });

    // 매장별은 표로. 99개 × 20개월이라 격자로 만들면 읽히지 않습니다.
    //
    // api_coverage_matrix 는 매장마다 한 줄로 내려줍니다.
    // months 는 {"202501": 매출, ...} 모양이고, 값이 있는 달만 들어 있습니다.
    // 긴 형태로 받으면 99×20=1,980행이라 Supabase 의 1,000행 상한에 잘립니다.
    const total = months.length;
    const rows = (d.coverage || []).map((r) => {
        const filled = Number(r.months_filled) || Object.keys(r.months || {}).length;
        return {
            store: r.store,
            filled,
            missing: Math.max(0, total - filled),
            amount: Number(r.total) || 0,
            months: r.months || {},
        };
    });

    table($("t-coverage"), ["매장", "수집된 달", "누락", "빠진 달", "누적 매출"],
        rows.sort((a, b) => a.filled - b.filled).map((s) => {
            const missing = months
                .filter((ym) => !(String(ym) in s.months))
                .map(ymLabel);
            return [
                s.store,
                `${s.filled} / ${total}`,
                s.missing,
                // 어느 달을 더 모아야 하는지 바로 보이게 합니다. 백필 작업의 지도입니다.
                missing.length > 6
                    ? `${missing.slice(0, 6).join(", ")} 외 ${missing.length - 6}개`
                    : (missing.join(", ") || "—"),
                wonFull(s.amount),
            ];
        }));
}

// ---- 비정규 현황 ------------------------------------------------------

const NONSTANDARD_WARN = 0.10;   // 엑셀이 빨갛게 칠하던 기준과 동일

function drawNonstandard(d, c) {
    const rows = d.nonstandard.map((r) => ({
        store: r.store,
        ratio: Number(r.ratio) || 0,
        amount: Number(r.nonstandard_amount) || 0,
        food: Number(r.food_amount) || 0,
        menus: r.menu_count,
    }));

    drawBars($("c-nonstd"), {
        rows: rows.slice(0, 15).map((r) => ({
            label: r.store,
            value: Math.round(r.ratio * 1000) / 10,
        })),
        color: c.s1, horizontal: true, colors: c, unitSuffix: "%",
    });

    table($("t-nonstd"), ["매장", "비정규 비율", "비정규 매출", "매장 총매출", "비정규 메뉴"],
        rows.map((r) => [
            r.store + (r.ratio >= NONSTANDARD_WARN
                ? '<span class="flag">경고</span>' : ""),
            `${(r.ratio * 100).toFixed(1)}%`,
            wonFull(r.amount), wonFull(r.food), `${r.menus}종`,
        ]), { html: true });
}

// ---- 매장 비교표 ------------------------------------------------------

let storeSort = { key: 2, asc: false };

function drawStoreMetrics(d) {
    const nonstandard = new Map(
        d.nonstandard.map((r) => [r.store, Number(r.ratio) || 0]));

    const rows = d.storeMetrics.map((r) => {
        const amount = Number(r.amount) || 0;
        const delivery = Number(r.delivery_amount) || 0;
        return [
            r.store,
            r.trade_area || "미지정",
            amount,
            Number(r.qty) || 0,
            Number(r.avg_ticket) || 0,
            amount ? delivery / amount : 0,
            nonstandard.get(r.store) || 0,
            Number(r.active_months) || 0,
        ];
    });

    const headers = ["매장", "상권", "매출", "수량", "객단가", "배달 비중", "비정규 비율", "수집 개월"];
    const format = [
        (v) => v, (v) => v, wonFull, int, wonFull,
        (v) => `${(v * 100).toFixed(0)}%`,
        (v) => `${(v * 100).toFixed(1)}%`,
        (v) => `${v}개월`,
    ];

    const render = () => {
        const sorted = [...rows].sort((a, b) => {
            const [x, y] = [a[storeSort.key], b[storeSort.key]];
            const cmp = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
            return storeSort.asc ? cmp : -cmp;
        });
        table($("t-stores"), headers,
            sorted.map((r) => r.map((v, i) => format[i](v))),
            { sortable: true, sortState: storeSort });

        $("t-stores").querySelectorAll("th.sortable").forEach((th, i) => {
            th.addEventListener("click", () => {
                storeSort = storeSort.key === i
                    ? { key: i, asc: !storeSort.asc }
                    : { key: i, asc: i === 0 || i === 1 };
                render();
            });
        });
    };
    render();
}

// ---- 메뉴 × (상권 / 요일 / 시간대) ------------------------------------

function drawMenuMatrix(chartEl, tableEl, data, field, fixedOrder = null) {
    // api_menu_matrix 는 메뉴마다 한 줄로 내려줍니다.
    //   { menu, category, total, buckets: { "거주밀집": 123, ... } }
    // 긴 형태(메뉴×구간 한 줄씩)로 받으면 메뉴 801종 × 요일 7개 = 5,600행이라
    // Supabase 의 1,000행 상한에 조용히 잘립니다. 그래서 묶어서 받습니다.
    const rows = (data || []).map((r) => ({
        menu: r.menu,
        category: r.category,
        total: Number(r.total) || 0,
        buckets: r.buckets || {},
    })).sort((a, b) => b.total - a.total);

    const seen = new Set();
    for (const row of rows) Object.keys(row.buckets).forEach((b) => seen.add(b));
    const buckets = fixedOrder
        ? fixedOrder.filter((b) => seen.has(b))
        : [...seen].sort();

    renderHeat(chartEl, {
        rows: rows.slice(0, 15),
        cols: buckets,
        rowLabel: (r) => clip(r.menu, 14),
        get: (row, bucket) => Number(row.buckets[bucket]) || 0,
        label: won,
    });

    table(tableEl, ["메뉴", "분류", ...buckets, "합계"],
        rows.map((r) => [
            r.menu,
            r.category || "—",
            ...buckets.map((b) => wonFull(r.buckets[b] || 0)),
            wonFull(r.total),
        ]));
}

// ---- 미매핑 -----------------------------------------------------------

function drawUnmapped(d) {
    $("unmapped-count").textContent =
        d.unmapped.length ? `${d.unmapped.length}종` : "없음";
    table($("t-unmapped"), ["원본 품목명", "채널", "발생 건수"],
        d.unmapped.map((r) => [r.name, r.source, int(r.count)]));
}

// ---- 월별 추이 (선 그래프) --------------------------------------------

function drawMonthly(rows, c) {
    const months = [...new Set(rows.map((r) => r.ym))].sort((a, b) => a - b);
    const channels = [...new Set(rows.map((r) => r.channel))]
        .sort((a, b) => (a === "홀" ? -1 : b === "홀" ? 1 : 0));

    const series = channels.map((name) => ({
        name,
        color: c[CHANNEL_COLORS[name] || "s1"],
        values: months.map((ym) => {
            const found = rows.find((r) => r.ym === ym && r.channel === name);
            return found ? Number(found.amount) : 0;
        }),
    }));

    // 범례는 시리즈가 2개 이상일 때만. 1개면 제목이 이미 설명합니다.
    const legend = $("legend-monthly");
    legend.innerHTML = "";
    if (series.length >= 2) {
        for (const s of series) {
            const span = document.createElement("span");
            span.innerHTML = `<i style="background:${s.color}"></i>${s.name}`;
            legend.append(span);
        }
    }

    table($("t-monthly"), ["연월", ...channels, "합계"],
        months.map((ym) => {
            const cells = channels.map((ch) => {
                const found = rows.find((r) => r.ym === ym && r.channel === ch);
                return found ? Number(found.amount) : 0;
            });
            return [ymLabel(ym), ...cells.map(wonFull),
                wonFull(cells.reduce((a, b) => a + b, 0))];
        }));

    drawLine($("c-monthly"), { xLabels: months.map(ymLabel), series, colors: c });
}

function drawLine(svg, { xLabels, series, colors }) {
    const width = svg.clientWidth || 720;
    const height = 300;
    const pad = { top: 18, right: 64, bottom: 30, left: 62 };
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;

    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const ticks = niceTicks(max, 4);
    const top = ticks[ticks.length - 1];

    const x = (i) => pad.left + (xLabels.length === 1
        ? plotW / 2
        : (plotW * i) / (xLabels.length - 1));
    const y = (v) => pad.top + plotH - (plotH * v) / top;

    const parts = [];

    // 가로 눈금선 — 실선 헤어라인, 표면에서 한 단계만 진하게
    for (const t of ticks) {
        parts.push(
            `<line x1="${pad.left}" y1="${y(t)}" x2="${pad.left + plotW}" y2="${y(t)}"` +
            ` stroke="${colors.grid}" stroke-width="1"/>`,
            `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end"` +
            ` font-size="11" fill="${colors.muted}"` +
            ` style="font-variant-numeric:tabular-nums">${won(t)}</text>`
        );
    }

    // x축 라벨은 겹치지 않을 만큼만
    const step = Math.ceil(xLabels.length / Math.max(2, Math.floor(plotW / 64)));
    xLabels.forEach((label, i) => {
        if (i % step && i !== xLabels.length - 1) return;
        parts.push(
            `<text x="${x(i)}" y="${height - 8}" text-anchor="middle"` +
            ` font-size="11" fill="${colors.muted}">${escape(label)}</text>`
        );
    });

    for (const s of series) {
        const path = s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
        parts.push(
            `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"` +
            ` stroke-linejoin="round" stroke-linecap="round"/>`
        );

        // 끝점만 표시합니다. 모든 점에 숫자를 붙이면 읽히지 않습니다.
        const last = s.values.length - 1;
        parts.push(
            `<circle cx="${x(last)}" cy="${y(s.values[last])}" r="4.5"` +
            ` fill="${s.color}" stroke="${colors.surface}" stroke-width="2"/>`,
            `<text x="${x(last) + 10}" y="${y(s.values[last]) + 4}"` +
            ` font-size="11" fill="${colors.secondary}"` +
            ` style="font-variant-numeric:tabular-nums">${won(s.values[last])}</text>`
        );
    }

    // 기준선
    parts.push(
        `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}"` +
        ` y2="${pad.top + plotH}" stroke="${colors.base}" stroke-width="1"/>`
    );

    // 마우스를 올린 위치의 세로선 (기본은 숨김)
    parts.push(
        `<line class="crosshair" y1="${pad.top}" y2="${pad.top + plotH}"` +
        ` stroke="${colors.base}" stroke-width="1" opacity="0"/>`
    );
    parts.push(`<rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="transparent"/>`);

    // outerHTML 로 바꾸면 id·class 가 사라집니다. 내용만 갈아끼웁니다.
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.innerHTML = parts.join("");
    hookLineHover(svg, { xLabels, series, x, pad, plotW, plotH });
}

function hookLineHover(svg, { xLabels, series, x, pad, plotW, plotH }) {
    if (!svg) return;
    const crosshair = svg.querySelector(".crosshair");

    svg.addEventListener("mousemove", (event) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / (svg.viewBox.baseVal.width || box.width);
        const px = (event.clientX - box.left) / scale;
        if (px < pad.left - 8 || px > pad.left + plotW + 8) return hideTip();

        let best = 0, bestDist = Infinity;
        xLabels.forEach((_, i) => {
            const dist = Math.abs(x(i) - px);
            if (dist < bestDist) { bestDist = dist; best = i; }
        });

        crosshair.setAttribute("x1", x(best));
        crosshair.setAttribute("x2", x(best));
        crosshair.setAttribute("opacity", "1");

        showTip(event, `<strong>${escape(xLabels[best])}</strong>` +
            series.map((s) =>
                `<div class="row"><i style="background:${s.color}"></i>` +
                `${escape(s.name)} ${wonFull(s.values[best])}</div>`).join(""));
    });

    svg.addEventListener("mouseleave", () => {
        crosshair.setAttribute("opacity", "0");
        hideTip();
    });
}

// ---- 막대 그래프 -------------------------------------------------------

function drawBars(svg, { rows, color, horizontal, colors, unit = "",
                        unitSuffix = "" }) {
    // unitSuffix 가 있으면 값 표기를 그대로 쓰고(예: 34.0%), 없으면 원화로 줄입니다.
    const fmt = unitSuffix ? (v) => `${v}${unitSuffix}` : won;
    const width = svg.clientWidth || 480;
    const max = Math.max(1, ...rows.map((r) => r.value));

    const parts = [];
    let height;

    if (horizontal) {
        const rowH = 26;                 // 막대 24px + 간격 2px
        const pad = { top: 6, right: 74, bottom: 6, left: 118 };
        height = pad.top + pad.bottom + rows.length * rowH;
        const plotW = Math.max(10, width - pad.left - pad.right);

        rows.forEach((row, i) => {
            const top = pad.top + i * rowH;
            const barW = Math.max(2, (plotW * row.value) / max);
            parts.push(
                // 막대 끝만 둥글게, 기준선 쪽은 각지게
                `<path d="${roundedRight(pad.left, top, barW, 24, 4)}" fill="${color}"` +
                ` data-tip="${escape(row.label)}|${row.value}"/>`,
                `<text x="${pad.left - 8}" y="${top + 16}" text-anchor="end"` +
                ` font-size="12" fill="${colors.secondary}">${escape(clip(row.label, 12))}</text>`,
                `<text x="${pad.left + barW + 8}" y="${top + 16}" font-size="11"` +
                ` fill="${colors.secondary}" style="font-variant-numeric:tabular-nums">` +
                `${fmt(row.value)}</text>`
            );
        });
    } else {
        height = 240;
        const pad = { top: 20, right: 8, bottom: 28, left: 56 };
        const plotH = height - pad.top - pad.bottom;
        const plotW = Math.max(10, width - pad.left - pad.right);
        const slot = plotW / rows.length;
        const barW = Math.min(24, Math.max(3, slot - 2));   // 슬롯을 꽉 채우지 않습니다

        const ticks = niceTicks(max, 4);
        const top = ticks[ticks.length - 1];
        const y = (v) => pad.top + plotH - (plotH * v) / top;

        for (const t of ticks) {
            parts.push(
                `<line x1="${pad.left}" y1="${y(t)}" x2="${pad.left + plotW}" y2="${y(t)}"` +
                ` stroke="${colors.grid}" stroke-width="1"/>`,
                `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11"` +
                ` fill="${colors.muted}" style="font-variant-numeric:tabular-nums">${won(t)}</text>`
            );
        }

        const peak = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0] || { value: 0 });

        rows.forEach((row, i) => {
            const cx = pad.left + slot * i + slot / 2;
            const h = Math.max(2, plotH * (row.value / top));
            parts.push(
                `<path d="${roundedTop(cx - barW / 2, y(row.value), barW, h, 4)}" fill="${color}"` +
                ` data-tip="${escape(row.label + unit)}|${row.value}"/>`
            );
            if (rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) {
                parts.push(
                    `<text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="11"` +
                    ` fill="${colors.muted}">${escape(row.label)}</text>`
                );
            }
            // 최고치 하나만 직접 표시합니다.
            if (row === peak && row.value > 0) {
                parts.push(
                    `<text x="${cx}" y="${y(row.value) - 7}" text-anchor="middle" font-size="11"` +
                    ` fill="${colors.secondary}" style="font-variant-numeric:tabular-nums">` +
                    `${fmt(row.value)}</text>`
                );
            }
        });

        parts.push(
            `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}"` +
            ` y2="${pad.top + plotH}" stroke="${colors.base}" stroke-width="1"/>`
        );
    }

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.innerHTML = parts.join("");
    hookBarHover(svg);
}

function hookBarHover(svg) {
    if (!svg) return;
    svg.querySelectorAll("[data-tip]").forEach((mark) => {
        mark.style.cursor = "default";
        mark.addEventListener("mousemove", (event) => {
            const [label, value] = mark.dataset.tip.split("|");
            const shown = mark.dataset.suffix
                ? `${value}${mark.dataset.suffix}` : wonFull(value);
            showTip(event, `<strong>${label}</strong><div>${shown}</div>`);
        });
        mark.addEventListener("mouseleave", hideTip);
    });
}

// 막대의 데이터 쪽 끝만 둥글게. 기준선에 닿는 쪽은 각지게 둡니다.
function roundedRight(x, y, w, h, r) {
    const rr = Math.min(r, w, h / 2);
    return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr}` +
           ` V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

function roundedTop(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y}` +
           ` H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ---------------------------------------------------------------- 표·유틸

// options.html      셀 값을 이미 만들어진 HTML 로 넣습니다 (경고 배지 등).
//                   이 경우 값을 만드는 쪽에서 escape 책임을 집니다.
// options.sortable  헤더를 눌러 정렬할 수 있게 표시합니다.
function table(container, headers, rows, options = {}) {
    if (!rows.length) {
        container.innerHTML = '<p class="hint">데이터가 없습니다.</p>';
        return;
    }
    const cell = options.html ? (v) => String(v ?? "") : escape;
    const sort = options.sortState;

    const head = headers.map((h, i) => {
        if (!options.sortable) return `<th>${escape(h)}</th>`;
        const active = sort && sort.key === i;
        const aria = active ? ` aria-sort="${sort.asc ? "ascending" : "descending"}"` : "";
        return `<th class="sortable" tabindex="0"${aria}>${escape(h)}</th>`;
    }).join("");

    container.innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>` +
        rows.map((r) => "<tr>" + r.map((v) => `<td>${cell(v)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
}

function showTip(event, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const box = tooltip.getBoundingClientRect();
    let left = event.clientX + 14;
    let top = event.clientY + 14;
    if (left + box.width > window.innerWidth - 8) left = event.clientX - box.width - 14;
    if (top + box.height > window.innerHeight - 8) top = event.clientY - box.height - 14;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTip() { tooltip.hidden = true; }

function niceTicks(max, count) {
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const out = [];
    for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
}

const clip = (text, n) =>
    String(text).length > n ? String(text).slice(0, n - 1) + "…" : String(text);

function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g,
        (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ================================================================ 엑셀 내보내기
//
// 흐름 (담당자 결정: 월 단위 + 수집 안 된 곳은 전 채널 자동 수집)
//   1. 선택한 매장 × 월 중 '수집 안 된 칸' 을 커버리지로 확인
//   2. 있으면 → 그 매장·기간을 전 채널로 수집 요청 → 끝날 때까지 대기(진행 표시)
//              → 대시보드까지 갱신되므로 웹 분석 화면도 같이 최신이 됨
//   3. 없으면 → 바로 엑셀 생성·내려받기
//
// 클라우드 fact 는 월 단위라 기간도 월 단위입니다.

// YYYY-MM (input[type=month]) → 202601 (integer)
function ymToInt(value) {
    if (!value) return null;
    const [y, m] = value.split("-");
    if (!y || !m) return null;
    return parseInt(y, 10) * 100 + parseInt(m, 10);
}

// 202601 → "2026-01". input[type=month] 와 파일명에 쓰는 하이픈 형식.
// (화면 표시용 ymLabel 은 '2026.01' 점 형식이라 별개입니다.)
function ymDash(ymInt) {
    const s = String(ymInt);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}

function initExport() {
    const fromEl = $("x-from");
    const toEl = $("x-to");
    const submit = $("x-submit");
    if (!fromEl || !toEl || !submit) return;

    // 기본값: 데이터가 있는 최근 3개월. api_filters 가 준 범위를 씁니다.
    if (filterRange && filterRange.max) {
        toEl.value = ymDash(filterRange.max);
        const maxS = String(filterRange.max);
        let y = parseInt(maxS.slice(0, 4), 10);
        let m = parseInt(maxS.slice(4, 6), 10) - 2;
        while (m <= 0) { m += 12; y -= 1; }
        fromEl.value = `${y}-${String(m).padStart(2, "0")}`;
        if (filterRange.min && ymToInt(fromEl.value) < filterRange.min) {
            fromEl.value = ymDash(filterRange.min);
        }
    }

    submit.addEventListener("click", () => runExport());
}

async function runExport() {
    const notice = $("x-notice");
    const progress = $("x-progress");
    const submit = $("x-submit");

    const ymFrom = ymToInt($("x-from").value);
    const ymTo = ymToInt($("x-to").value);
    progress.innerHTML = "";

    if (!ymFrom || !ymTo) {
        notice.className = "notice error";
        notice.textContent = "시작 월과 종료 월을 고르세요.";
        return;
    }
    if (ymFrom > ymTo) {
        notice.className = "notice error";
        notice.textContent = "시작 월이 종료 월보다 늦습니다.";
        return;
    }

    const stores = [...xStores];               // 비어 있으면 전 매장
    const storeArg = stores.length ? stores : null;
    submit.disabled = true;

    try {
        // 1. 수집 안 된 (매장, 월) 확인
        notice.className = "notice";
        notice.textContent = "수집 현황을 확인하는 중…";
        const { data: cov, error: covErr } = await db.rpc("api_export_coverage", {
            p_ym_from: ymFrom, p_ym_to: ymTo, p_stores: storeArg,
        });
        if (covErr) throw new Error("수집 현황 조회 실패: " + covErr.message);

        const missing = (cov || []).filter((r) => !r.has_data);

        // 2. 비어 있으면 자동 수집 (담당자 결정: 전 채널)
        if (missing.length > 0) {
            const ok = await exportCollectMissing(missing, notice, progress);
            if (!ok) { submit.disabled = false; return; }
        }

        // 3. 엑셀 생성
        notice.className = "notice";
        notice.textContent = "엑셀을 만드는 중…";
        await buildAndDownloadWorkbook(ymFrom, ymTo, storeArg, stores);

        notice.className = "notice";
        notice.textContent = "엑셀을 내려받았습니다.";
    } catch (err) {
        notice.className = "notice error";
        notice.textContent = String(err.message || err);
    } finally {
        submit.disabled = false;
    }
}

// 수집 안 된 매장·월을 전 채널로 수집 요청하고, 끝날 때까지 기다립니다.
async function exportCollectMissing(missing, notice, progress) {
    // 매장·월을 모읍니다. 요청은 '기간(연-월-01 ~ 연-월-말일)' 단위라
    // 빠진 달의 최소~최대 월을 한 번에 겁니다.
    const storeSet = [...new Set(missing.map((r) => r.store))];
    const monthsMissing = [...new Set(missing.map((r) => r.ym))].sort();
    const first = monthsMissing[0];
    const last = monthsMissing[monthsMissing.length - 1];

    const from = firstDayOf(first);
    const to = lastDayOf(last);

    progress.innerHTML =
        `<p class="hint">수집이 안 된 매장 ${storeSet.length}곳 · `
        + `${monthsMissing.map(ymDash).join(", ")} 을 먼저 모읍니다. `
        + `전 채널을 수집하므로 시간이 걸립니다.</p>`
        + `<div class="logbox" id="x-log"></div>`;

    const { data: { session } } = await db.auth.getSession();
    const { data: inserted, error } = await db.from("collect_requests").insert({
        requested_by: session?.user?.id,
        plugins: ["easypos", "baemin", "imu", "coupangeats", "yogiyo"],
        date_from: from,
        date_to: to,
        stores: storeSet,     // 빠진 매장만
        profiles: [],
    }).select();
    if (error) {
        notice.className = "notice error";
        notice.textContent = "수집 요청을 넣지 못했습니다: " + error.message;
        return false;
    }

    const reqId = inserted[0].id;
    return await waitForRequest(reqId, progress);
}

// 요청 하나가 끝날 때까지 상태를 지켜봅니다. 진행 상황을 화면에 보여줍니다.
async function waitForRequest(reqId, progress) {
    const log = $("x-log");
    const started = Date.now();
    // 수집은 오래 걸릴 수 있습니다. 최대 2시간까지 기다립니다.
    const deadline = started + 2 * 60 * 60 * 1000;

    while (Date.now() < deadline) {
        await sleep(4000);
        const { data, error } = await db
            .from("collect_requests")
            .select("status,progress,error")
            .eq("id", reqId)
            .single();
        if (error) continue;

        const mins = Math.floor((Date.now() - started) / 60000);
        if (log) {
            log.textContent =
                `상태: ${data.status}\n` +
                `진행: ${data.progress || "…"}\n` +
                `경과: ${mins}분`;
        }

        if (data.status === "done") return true;
        if (data.status === "failed") {
            if (log) log.textContent += `\n\n실패: ${data.error || ""}`;
            return false;
        }
    }
    if (log) log.textContent += "\n\n시간이 너무 오래 걸립니다. 나중에 다시 시도하세요.";
    return false;
}

function firstDayOf(ymInt) {
    const s = String(ymInt);
    return `${s.slice(0, 4)}${s.slice(4, 6)}01`;
}
function lastDayOf(ymInt) {
    const s = String(ymInt);
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10);
    const last = new Date(y, m, 0).getDate();   // m월의 말일
    return `${s.slice(0, 4)}${s.slice(4, 6)}${String(last).padStart(2, "0")}`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 선택 범위의 집계를 받아 여러 시트짜리 엑셀을 만들고 내려받습니다.
async function buildAndDownloadWorkbook(ymFrom, ymTo, storeArg, storeNames) {
    const XLSX = await loadSheetJS();

    const args = { p_ym_from: ymFrom, p_ym_to: ymTo, p_stores: storeArg };
    const [summary, monthly, menu, coverage] = await Promise.all([
        db.rpc("api_export_store_summary", args),
        db.rpc("api_export_monthly", args),
        db.rpc("api_export_menu", args),
        db.rpc("api_export_coverage", args),
    ]);
    for (const r of [summary, monthly, menu, coverage]) {
        if (r.error) throw new Error("집계 조회 실패: " + r.error.message);
    }

    const wb = XLSX.utils.book_new();

    // 표지 시트: 무엇을 뽑았는지
    const cover = [
        ["미태리 매출 내보내기"],
        ["기간", `${ymDash(ymFrom)} ~ ${ymDash(ymTo)}`],
        ["대상 매장", storeNames && storeNames.length ? storeNames.join(", ") : "전체 매장"],
        ["만든 시각", new Date().toLocaleString("ko-KR")],
        ["매출 기준", "배달=할인 전 / 홀=할인 후 (프로젝트 규칙)"],
    ];
    XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet(cover), "요약정보");

    addSheet(XLSX, wb, "매장별", summary.data, [
        ["store", "매장"], ["trade_area", "상권"], ["amount", "총매출"],
        ["qty", "총수량"], ["avg_ticket", "객단가"], ["hall_amount", "홀매출"],
        ["delivery_amount", "배달매출"], ["menu_count", "메뉴수"],
        ["active_months", "활동월수"],
    ]);
    addSheet(XLSX, wb, "월별추이", monthly.data, [
        ["ym", "연월"], ["amount", "총매출"], ["qty", "총수량"],
        ["hall_amount", "홀매출"], ["delivery_amount", "배달매출"],
        ["store_count", "매장수"],
    ]);
    addSheet(XLSX, wb, "품목별", menu.data, [
        ["menu", "메뉴"], ["category", "대분류"], ["amount", "매출"],
        ["qty", "수량"], ["store_count", "판매매장수"], ["is_giveaway", "증정품"],
    ]);
    addSheet(XLSX, wb, "수집현황", coverage.data, [
        ["store", "매장"], ["ym", "연월"], ["amount", "매출"], ["has_data", "수집됨"],
    ]);

    const fname =
        `미태리_매출_${ymDash(ymFrom)}_${ymDash(ymTo)}`
        + `${storeNames && storeNames.length ? `_${storeNames.length}개매장` : "_전체"}.xlsx`;
    XLSX.writeFile(wb, fname);
}

// 행 배열 + (키,헤더) 매핑 → 시트. 헤더를 한글로 바꿔 담당자가 바로 읽게 합니다.
function addSheet(XLSX, wb, sheetName, rows, columns) {
    const header = columns.map(([, label]) => label);
    const body = (rows || []).map((r) => columns.map(([key]) => {
        const v = r[key];
        if (typeof v === "boolean") return v ? "O" : "";
        return v;
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// SheetJS 를 필요할 때만 불러옵니다. supabase-js 처럼 CDN 에서 가져옵니다.
let _sheetjs = null;
async function loadSheetJS() {
    if (_sheetjs) return _sheetjs;
    _sheetjs = await import("https://esm.sh/xlsx@0.18.5");
    return _sheetjs;
}

// api_filters 가 준 데이터 범위(최소/최대 연월). initExport 기본값에 씁니다.
let filterRange = null;

boot();
