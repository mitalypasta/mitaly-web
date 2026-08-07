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
            initAreas();
            initReport();
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

    // 기본값: **최근 한 달**(지난달~이번달). 담당자 요구(2026-07-30).
    //
    // 12개월이 기본이면 화면을 열 때마다 팩트 80만 행을 통째로 훑어 느립니다.
    // 그리고 담당자가 화면을 여는 대부분의 이유는 '요즘 어떤가' 이지
    // '작년까지 통틀어 어떤가' 가 아닙니다. 길게 볼 때는 직접 늘리면 됩니다.
    //
    // 데이터가 한 달치뿐이면 그 한 달만 잡습니다(months.length - 2 가 음수).
    $("f-from").value = String(months[Math.max(0, months.length - 2)]);
    $("f-to").value = String(info.ym_max);

    initCredentials(info.stores);
    initContacts(info.stores);

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

    // 전 품목 검색. 표만 다시 그리므로 데이터를 새로 받지 않습니다.
    $("ai-search").addEventListener("input",
        debounce(() => allItemsRender && allItemsRender(), 150));

    // 급증·급감 매장만 보기. 이미 받아 온 데이터를 다시 그리기만 합니다.
    $("alerts-only").addEventListener("change", () => lastData && drawAlerts(lastData));

    // 리뷰 필터는 서버에서 걸러야 하므로 다시 받습니다.
    for (const id of ["rv-unanswered", "rv-drafts-only", "rv-platform", "rv-rating"]) {
        $(id).addEventListener("change", load);
    }

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
    initDrafts();
    initHomeTiles();
    initNotices();
    initVisits();
    initStoreDb();
    initAccountPresence();
    initLifecycle();
    initTasks();
    initNotifications();
    initInquiries();
    initSettlement();
    initAds();
    initIngredients();
    initPosMenu();
    initComms();
    initDeliveryMap();
    loadAccountHealth();

    await load();
    loadLastUpdated();
}

// ---------------------------------------------------------------- 수집 요청

// 5개 채널 전부 동작합니다. (요기요는 2026-07-23 완성)
// 네이버는 매출이 없는 리뷰 전용 채널이라 리뷰 요청에서만 선택됩니다.
// 최초 로그인(사람)이 끝난 매장만 수집됩니다 — docs/naver-review-api.md 3절.
const PLUGIN_LIST = [
    { id: "easypos", name: "이지포스", ready: true },
    { id: "baemin", name: "배달의민족", ready: true },
    { id: "imu", name: "아임유", ready: true },
    { id: "coupangeats", name: "쿠팡이츠", ready: true },
    { id: "yogiyo", name: "요기요", ready: true },
    { id: "naver", name: "네이버(리뷰)", ready: true, reviewOnly: true },
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
        // 리뷰 전용 채널은 매출 요청에 실리면 안 되므로 처음부터 꺼 둡니다 —
        // syncKind() 가 리뷰 모드에서만 켭니다.
        label.innerHTML =
            `<input type="checkbox" value="${plugin.id}"` +
            `${plugin.reviewOnly ? ' data-review-only="1"' : ""}` +
            `${plugin.ready && !plugin.reviewOnly ? " checked" : ""}` +
            `${plugin.ready ? "" : " disabled"}>` +
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

    $("r-kind").addEventListener("change", () => syncKind(syncProfileVisibility));
    syncKind(syncProfileVisibility);

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

// 리뷰 수집기가 실제로 있는 채널. 러너의 REVIEW_PLUGINS 와 같아야 합니다.
// 네이버는 최초 로그인(사람)이 끝난 매장만 실제로 수집됩니다.
const REVIEW_PLUGINS = ["baemin", "yogiyo", "coupangeats", "naver"];

// 리뷰 요청 오류에 다음 행동을 붙입니다. 문구는 agent/mitaly_cloud_agent.py
// handle_review_request() 가 실제로 내보내는 error 문자열에 맞춰 골랐습니다 —
// 러너 메시지가 바뀌면 이 매칭도 같이 손봐야 합니다.
function reviewFailureHint(errorText) {
    const msg = errorText || "";
    if (msg.includes("리뷰 수집기가 있는 채널이 없습니다")) {
        return "쿠팡이츠는 아직 리뷰 수집기가 없습니다. 배민 또는 요기요를 선택해 다시 요청하세요.";
    }
    if (msg.includes("수집하지 못했습니다") || msg.includes("실패:")) {
        return "계정표(매장별_배달계정.xlsx)에 이 매장의 배민·요기요 계정 정보가 있는지 " +
            "먼저 확인하세요. 계정이 맞다면 자리 PC가 켜져 있고 수집 프로그램이 " +
            "정상 동작 중인지 확인하세요.";
    }
    if (msg.includes("업로드")) {
        return "자리 PC가 켜져 있고 수집 프로그램이 정상 동작 중인지 확인하세요. " +
            "이어지면 로그를 펼쳐 원인을 확인하세요.";
    }
    if (msg.includes("기간이 비어")) {
        return "조회 기간을 채워 다시 요청하세요.";
    }
    return "계정표 확인 → 선택한 채널에 리뷰 수집기가 있는지 확인 → 자리 PC가 켜져 " +
        "있는지 확인, 순서로 살펴보세요.";
}

// '매출' 과 '리뷰' 는 받는 방식이 달라 고를 수 있는 것도 다릅니다.
// 리뷰는 (a) 수집기가 있는 채널만 (b) 이지포스 계정 구분이 없고
// (c) '이미 받은 기간 다시 받기' 가 무의미합니다 — 리뷰는 늘 겹쳐 받습니다.
// 매출 모드에서 무엇을 골라 뒀는지. 리뷰로 갔다 돌아올 때 되돌립니다.
// 이게 없으면 리뷰를 한 번 보기만 해도 채널 선택이 날아갑니다.
let salesChecked = null;

function syncKind(syncProfileVisibility) {
    const reviews = $("r-kind").value === "reviews";
    const inputs = [...document.querySelectorAll("#r-plugins input")];

    if (reviews && salesChecked === null) {
        salesChecked = inputs.filter((el) => el.checked).map((el) => el.value);
    }

    for (const el of inputs) {
        // 리뷰 전용 채널(네이버)은 매출 모드에서 끕니다.
        const ok = reviews ? REVIEW_PLUGINS.includes(el.value)
            : el.dataset.reviewOnly !== "1";
        // 원래 상태(준비 안 된 채널)를 기억해 두었다가 되돌립니다.
        if (el.dataset.ready === undefined) el.dataset.ready = String(!el.disabled);
        el.disabled = !ok || el.dataset.ready === "false";

        if (reviews) {
            el.checked = ok;
        } else if (salesChecked !== null) {
            el.checked = salesChecked.includes(el.value);
        }
        // 흐림·취소선은 .checks input[disabled] + span 이 이미 해 줍니다.
    }
    if (!reviews) salesChecked = null;

    $("r-force-wrap").hidden = reviews;
    $("r-kind-note").hidden = !reviews;
    // 채널 이름은 목록에서 만들어냅니다. 손으로 적어 두면 채널을 더할 때마다
    // 문구가 낡습니다(실제로 요기요를 붙이고 한 번 어긋났습니다).
    const names = inputs
        .filter((el) => REVIEW_PLUGINS.includes(el.value))
        .map((el) => el.closest("label").textContent.trim())
        .join(" · ");
    $("r-kind-note").textContent = reviews
        ? "리뷰는 같은 기간을 겹쳐 받아도 중복이 쌓이지 않습니다. "
          + "배민 답글에는 기한(대략 30일)이 있어 수집 PC 가 하루 한 번 스스로도 받습니다. "
          + `지금 리뷰 수집기가 있는 채널: ${names}.`
        : "";

    if (reviews) $("r-profile-field").hidden = true;
    else if (syncProfileVisibility) syncProfileVisibility();
    refreshStoreButton();
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
    coupangeats: "쿠팡", yogiyo: "요기요", naver: "네이버",
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

// ---- 계정 상태 (34_account_health.sql) -------------------------------
//
// 러너가 매일 새벽 5채널 로그인만 찔러 본 마지막 결과를 보여줍니다.
// 하루 한 번 바뀌는 데이터라 화면을 열 때 한 번만 받습니다.

const HEALTH_STATUS = {
    ok:   { label: "정상", cls: "h-ok" },
    warn: { label: "주의", cls: "h-warn" },
    fail: { label: "실패", cls: "h-fail" },
};

async function loadAccountHealth() {
    const meta = $("health-meta");
    const { data, error } = await db.rpc("api_account_health");
    if (error) {
        meta.textContent = "불러오지 못했습니다";
        $("t-health").innerHTML =
            '<p class="hint">' + escape(error.message) + "</p>";
        return;
    }
    if (!data || !data.run_id) {
        meta.textContent = "점검 전";
        $("t-health").innerHTML =
            '<p class="hint">아직 점검 이력이 없습니다. 수집 PC가 매일 새벽 한 번 ' +
            "5채널 로그인을 확인해 여기 표시합니다.</p>";
        return;
    }

    const results = data.results || [];
    const count = (s) => results.filter((r) => r.status === s).length;
    const when = new Date(data.finished_at || data.started_at);
    meta.textContent =
        `마지막 점검 ${when.getMonth() + 1}/${when.getDate()} ` +
        `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}` +
        ` · 정상 ${count("ok")} · 주의 ${count("warn")} · 실패 ${count("fail")}`;

    const channelName = (id) =>
        (PLUGIN_LIST.find((p) => p.id === id) || { name: id }).name;

    table($("t-health"),
        ["채널", "계정", "상태", "내용"],
        results.map((r) => {
            const st = HEALTH_STATUS[r.status] || HEALTH_STATUS.fail;
            return [
                escape(channelName(r.channel)),
                escape(r.account || r.store || "—"),
                `<span class="tag ${st.cls}">${st.label}</span>`,
                escape(r.detail || ""),
            ];
        }),
        { html: true });
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

    const forceEl = $("r-force");
    const kind = $("r-kind").value === "reviews" ? "reviews" : "sales";
    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("collect_requests").insert({
        requested_by: session?.user?.id,
        kind,
        plugins,
        date_from: from,
        date_to: to,
        stores,
        // 리뷰에는 이지포스 계정 구분도, '다시 받기' 도 해당이 없습니다.
        profiles: kind === "reviews" ? [] : profiles,
        force: kind === "reviews" ? false
            : (forceEl ? forceEl.checked : false),
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
        .select("id,kind,requested_at,plugins,date_from,date_to,stores,profiles," +
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
            <span><b>#${r.id}</b>${r.kind === "reviews" ? " 리뷰" : ""} ${escape(r.date_from)} ~ ${escape(r.date_to)}</span>
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
        // 리뷰 요청에서 오류가 나면(전체 실패든 일부 채널 실패든) 원인 문자열만
        // 던지지 않고 사람이 바로 할 수 있는 다음 행동을 붙입니다.
        const reviewHint = r.kind === "reviews" && r.error
            ? reviewFailureHint(r.error) : null;
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
        ${reviewHint ? `<p class="hint">${escape(reviewHint)}</p>` : ""}
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

    // ⚠️ 함수 호출이 아니라 **호출을 만드는 함수**들입니다. 배열을 만드는 순간
    //    18개가 전부 날아가면 서로 밀려 8초 제한(authenticated)을 넘깁니다.
    //    2026-07-29 실측: 하나씩이면 1.5~4초인데 동시에 던지면 전부 9~10초.
    //    아래 runLimited() 가 3개씩만 돌립니다.
    const calls = [
        () => db.rpc("api_summary", args),
        () => db.rpc("api_monthly", args),
        () => db.rpc("api_by_store", args),
        () => db.rpc("api_by_menu", args),
        () => db.rpc("api_by_hour", args),
        () => db.rpc("api_by_weekday", args),
        () => db.rpc("api_coverage_by_source", rangeArgs),
        () => db.rpc("api_coverage_matrix", { ...rangeArgs, p_store: args.p_store }),
        () => db.rpc("api_nonstandard_stores", args),
        () => db.rpc("api_store_metrics", storeArgs),
        () => db.rpc("api_menu_matrix", { p_field: "trade_area", ...args }),
        () => db.rpc("api_menu_matrix", { p_field: "weekday", ...args }),
        () => db.rpc("api_menu_matrix", { p_field: "daypart", ...args }),
        () => db.rpc("api_unmapped", {}),
        () => db.rpc("api_by_category", args),
        () => db.rpc("api_all_items", args),
        // ⚠️ 요약은 reviewArgs() 를 그대로 넘기면 안 됩니다. 별점·미답변 필터는
        //    목록(api_reviews)에만 있고 요약 함수는 기간·매장·채널 4개만 받습니다.
        //    7개를 넘기면 PostgREST 가 맞는 함수를 못 찾아 화면이 통째로 안 뜹니다.
        //    요약이 '미답변 몇 건' 을 세는 지표라 미답변 필터를 걸면 뜻이 없기도 합니다.
        () => db.rpc("api_review_summary", summaryArgs()),
        // '초안만' 필터가 켜지면 더 넓게 가져옵니다 — 하루 수집이 1,000건을
        // 넘던 날(2026-07-30)엔 초안 달린 리뷰가 최신 200건 밖에 있었습니다.
        () => db.rpc("api_reviews", {
            ...reviewArgs(),
            p_limit: $("rv-drafts-only").checked ? 1000 : 200,
        }),
        // 급증·급감·기간 대비(18_alerts.sql·19_compare.sql) — 기준월은 '종료'
        // 필터(p_ym_to)입니다. 팩트가 연월 단위까지만 있어(D19) 전월·전년동월
        // 두 가지만 비교합니다. p_store 는 알림 목록·매장별 대비에만 걸리고,
        // 회사 전체·채널별 합계는 함수 안에서 항상 전 매장 기준입니다.
        () => db.rpc("api_sales_alerts", { p_ym: args.p_ym_to, p_store: args.p_store }),
        () => db.rpc("api_sales_compare", { p_ym: args.p_ym_to, p_store: args.p_store }),
    ];

    // 초안 요약은 있으면 좋고 없어도 그만입니다. 위 묶음에 넣으면
    // 14_reply_drafts.sql 적용 전에 화면이 통째로 안 뜹니다(기존 bad 검사).
    const draftSummary = db.rpc("api_draft_summary", {})
        .then((r) => (r.error ? {} : ((r.data || [])[0] || {}).summary || {}))
        .catch(() => ({}));

    // 리뷰 수집 현황도 같은 이유로 따로 뺍니다 —
    // 15_review_collect.sql 적용 전에는 화면이 안 깨지고 그냥 안 보이면 됩니다.
    const reviewSync = db.rpc("api_review_sync_status", {})
        .then((r) => (r.error ? {} : ((r.data || [])[0] || {}).status || {}))
        .catch(() => ({}));

    // 화면 맨 위 4개(요약·월별추이·매장별·매장비교)를 먼저 받아 그리고,
    // 나머지 14개는 그 뒤에 채웁니다.
    //
    // 왜: 카드가 15개인데 전부 기다렸다 한 번에 그리면 스크롤 한참 아래에 있는
    // '전 품목'(2,600종) 때문에 맨 위 총매출까지 20초 넘게 못 봅니다. 사용자는
    // 대개 위 몇 개만 보고 판단합니다. 받는 총량은 같지만 **보이기까지가 짧아집니다.**
    // 이 둘은 없어도 화면이 떠야 하는 것들이라 위 묶음에 안 넣었습니다.
    // 늦게 오면 2차 그리기에 반영됩니다.
    const pending = { draftSummary: {}, reviewSync: {} };
    draftSummary.then((v) => { pending.draftSummary = v; });
    reviewSync.then((v) => { pending.reviewSync = v; });

    // ⚠️ 필터를 연달아 바꾸면 load() 가 여러 번 겹칩니다. 2단계로 나눈 뒤로는
    //    옛 조회의 2차가 새 조회보다 늦게 끝나 **옛 결과가 화면을 덮어쓰는**
    //    일이 생겼습니다(2026-07-30: 종료를 2025.04 로 바꿨는데 보고서 기간이
    //    2026.07 로 남음). 표는 그려지므로 조용히 틀립니다.
    //    내 차례가 아니면 그리지 않습니다.
    const myTurn = ++loadSeq;
    const stillMine = () => myTurn === loadSeq;

    const FIRST = [0, 1, 2, 9];
    const results = new Array(calls.length);

    const firstError = await runInto(results, calls, FIRST, 3);
    if (!stillMine()) return;
    document.body.classList.remove("loading");
    if (firstError) return fail(firstError);

    lastData = pack(results, args, pending);
    draw(lastData);

    // 나머지. 여기서 실패해도 이미 그린 것은 지우지 않습니다 —
    // 위쪽 숫자는 멀쩡한데 화면을 통째로 비우면 더 나쁩니다.
    document.body.classList.add("loading-rest");
    const restError = await runInto(
        results, calls, calls.map((_, i) => i).filter((i) => !FIRST.includes(i)), 3);
    if (!stillMine()) return;
    document.body.classList.remove("loading-rest");
    if (restError) return fail(restError);

    lastData = pack(results, args, pending);
    draw(lastData);
}

// 받아 온 결과를 화면이 쓰는 모양으로 묶습니다.
// 아직 안 온 칸은 빈 배열입니다 — 1차 그리기 때는 대부분이 비어 있습니다.
function pack(results, args, pending) {
    const d = (i) => (results[i] || {}).data || [];
    return {
        args,
        summary: (d(0))[0] || {},
        monthly: d(1),
        stores: d(2),
        menus: d(3),
        hours: d(4),
        weekdays: d(5),
        coverageBySource: d(6),
        coverage: d(7),
        nonstandard: d(8),
        storeMetrics: d(9),
        menuArea: d(10),
        menuWeekday: d(11),
        menuDaypart: d(12),
        unmapped: d(13),
        byCategory: d(14),
        allItems: unwrapItems(d(15)),
        reviewSummary: ((d(16))[0] || {}).summary || {},
        reviews: ((d(17))[0] || {}).items || [],
        alerts: ((d(18))[0] || {}).alerts || [],
        compare: ((d(19))[0] || {}).compare || {},
        draftSummary: pending.draftSummary,
        reviewSync: pending.reviewSync,
    };
}



// api_all_items 는 11_all_items_fix.sql 이후 jsonb 배열 한 줄로 옵니다.
// 품목이 2,612종이라 줄마다 보내면 1,000행에서 조용히 잘립니다(2026-07-27 실측).
// SQL 적용 전 저장소를 보는 사람도 화면이 안 깨지게 옛 형태도 받습니다.
function unwrapItems(rows) {
    const first = (rows || [])[0];
    if (first && Object.prototype.hasOwnProperty.call(first, "items")) {
        return first.items || [];
    }
    return rows || [];
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
    drawAlerts(d);
    drawReport(d);

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
        d.menus.map((r) => [r.menu, catLabel(r.category), wonFull(r.amount), int(r.qty)]));

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
    drawCategory(d, c);
    drawAllItems(d);
    drawReviews(d, c);
    drawUnmapped(d);
    drawHome(d);
}

// ---- 홈(할 일 타일) ----------------------------------------------------
//
// 이미 위에서 받아 온 draftSummary·reviewSummary·alerts 를 다시 세기만
// 합니다 — 홈 화면 때문에 새 조회를 추가하지 않습니다.
// 답글 초안(draftSummary)만 전체 기간 기준이고, 부정 리뷰·급감 매장은
// 위 매출 필터(기간·매장)를 따릅니다 — 아래 sub 문구로 그 차이를 알립니다.

function drawHome(d) {
    $("home-range").textContent =
        `${ymLabel(d.args.p_ym_from)} – ${ymLabel(d.args.p_ym_to)}` +
        (d.args.p_store ? ` · ${d.args.p_store}` : "") + " 기준";

    const draft = Number((d.draftSummary || {}).draft) || 0;
    $("home-drafts").textContent = int(draft);

    const byRating = (d.reviewSummary || {}).by_rating || [];
    const negative = byRating
        .filter((r) => Number(r.rating) <= 3)
        .reduce((sum, r) => sum + (Number(r.count) || 0), 0);
    $("home-negative").textContent = int(negative);

    const alerts = d.alerts || [];
    const declining = new Set(
        alerts
            .filter((s) => (s.channels || []).some((c) =>
                c.mom_direction === "급감" || c.yoy_direction === "급감"))
            .map((s) => s.store),
    ).size;
    $("home-declining").textContent = int(declining);
}

// ---- 리뷰 관리 --------------------------------------------------------
//
// 기간·매장은 위 필터를 그대로 따르고, 플랫폼·별점·미답변만 여기서 고릅니다.
// 답글은 이 화면에서 달지 않습니다. 지금은 무엇이 와 있는지 보는 단계입니다.

// 요약 함수(api_review_summary)가 받는 것만 추립니다.
function summaryArgs() {
    const { p_ym_from, p_ym_to, p_store, p_platform } = reviewArgs();
    return { p_ym_from, p_ym_to, p_store, p_platform };
}

function reviewArgs() {
    const base = currentFilters();
    const rating = $("rv-rating").value;
    return {
        p_ym_from: base.p_ym_from,
        p_ym_to: base.p_ym_to,
        p_store: base.p_store,
        p_platform: $("rv-platform").value || null,
        p_unanswered_only: $("rv-unanswered").checked,
        p_min_rating: rating === "high" ? 5 : null,
        p_max_rating: rating === "low" ? 4 : null,
    };
}

function ratingStars(value) {
    const n = Math.round(Number(value) || 0);
    return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

function drawReviews(d, c) {
    const summary = d.reviewSummary || {};
    let rows = d.reviews || [];
    // 'AI 초안만' — 초안이 붙은 리뷰만 남깁니다 (검토가 목적일 때 매몰 방지)
    if ($("rv-drafts-only").checked) {
        rows = rows.filter((r) => (r.drafts || []).length);
    }

    const total = Number(summary.total) || 0;
    $("review-summary").textContent = total
        ? `${int(total)}건 · 평균 ${summary.avg_rating ?? "—"}점 · `
          + `미답변 ${int(summary.unanswered || 0)}건`
        : "이 기간에 받아온 리뷰가 없습니다";

    // 플랫폼 목록은 요약이 알려주는 대로 채웁니다(수집된 것만 보이게).
    const select = $("rv-platform");
    const chosen = select.value;
    const names = (summary.by_platform || []).map((p) => p.platform);
    if (names.join("|") !== select.dataset.names) {
        select.dataset.names = names.join("|");
        select.innerHTML = '<option value="">모든 플랫폼</option>'
            + names.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join("");
        select.value = names.includes(chosen) ? chosen : "";
    }

    // 별점 분포
    const byRating = summary.by_rating || [];
    const max = Math.max(1, ...byRating.map((r) => Number(r.count) || 0));
    $("rv-bars").innerHTML = byRating.length
        ? '<div class="rvbars">' + byRating.map((r) => {
            const n = Number(r.count) || 0;
            return `<div class="rvbar"><span class="rvbar-label">${ratingStars(r.rating)}</span>`
                + `<span class="rvbar-track"><i style="width:${(n / max) * 100}%;`
                + `background:${c.s1}"></i></span>`
                + `<span class="rvbar-count">${int(n)}</span></div>`;
        }).join("") + "</div>"
        : "";

    $("rv-shown").textContent = rows.length ? `${int(rows.length)}건 표시` : "";

    // 초안 현황. 없으면 줄 자체를 감춥니다.
    const ds = d.draftSummary || {};
    const pending = Number(ds.draft) || 0;
    const approved = Number(ds.approved) || 0;
    $("draft-note").textContent = (pending || approved)
        ? `AI 답글 초안 — 검토 대기 ${int(pending)}건 · 승인됨 ${int(approved)}건`
          + (ds.tone ? ` · 말투 '${ds.tone}'` : "")
        : "";
    $("draft-note").hidden = !(pending || approved);

    // 리뷰 수집 현황. 배민 답글 기한이 대략 30일이라, 답글 달 수 있는 리뷰가
    // 적은데 전체 리뷰는 많다면 수집이 늦었다는 신호입니다.
    const sync = d.reviewSync || {};
    const syncNote = $("review-sync-note");
    if (sync.last_any_at || sync.reviews_total) {
        const lastText = sync.last_done_at
            ? new Date(sync.last_done_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })
            : "아직 없음";
        const openable = Number(sync.reviews_openable) || 0;
        const totalReviews = Number(sync.reviews_total) || 0;
        syncNote.textContent = `마지막 수집 ${lastText} · 지금 답글 달 수 있는 리뷰 ${int(openable)}건`
            + (totalReviews ? ` (전체 ${int(totalReviews)}건)` : "");
        syncNote.className = "hint" + (totalReviews && openable === 0 ? " warn" : "");
        syncNote.hidden = false;
    } else {
        syncNote.hidden = true;
    }

    if (!rows.length) {
        $("rv-list").innerHTML = '<p class="hint">조건에 맞는 리뷰가 없습니다.</p>';
        return;
    }

    $("rv-list").innerHTML = rows.map((r) => {
        const when = r.written_at
            ? new Date(r.written_at).toLocaleDateString("ko-KR",
                { year: "2-digit", month: "2-digit", day: "2-digit" })
            : "";
        const menus = (r.menus || []).map((m) => escape(m.name || "")).filter(Boolean);
        const repeat = Number(r.order_count) || 0;
        const replies = r.replies || [];
        const low = Number(r.rating) <= 3;

        return `<article class="rvitem${low ? " low" : ""}">
            <div class="rvhead">
              <span class="rvstars">${ratingStars(r.rating)}</span>
              <span class="rvscore">${r.rating ?? "—"}</span>
              <span class="rvmeta">${escape(r.store || "")} · ${escape(r.platform || "")} · ${when}</span>
              ${repeat > 1 ? `<span class="tag">재주문 ${repeat}회</span>` : ""}
              ${replies.length ? "" : '<span class="tag warn">미답변</span>'}
            </div>
            ${r.contents ? `<p class="rvbody">${escape(r.contents)}</p>` : ""}
            ${menus.length ? `<p class="rvmenus">${menus.join(" · ")}</p>` : ""}
            ${replies.map((x) => `<div class="rvreply"><b>답글</b> ${escape(x.contents || "")}</div>`).join("")}
            ${(r.drafts || []).map(draftBox).join("")}
          </article>`;
    }).join("");
}

// ---- AI 답글 초안 ------------------------------------------------------
//
// ⚠️ 여기서 '승인' 은 배달앱에 올리는 것이 아닙니다. '올려도 좋다' 는 표시일
//    뿐이고, 실제 등록을 하는 코드는 아직 어디에도 없습니다(DECISIONS.md D9).
//    문구에서도 그렇게 읽히게 씁니다 — 눌렀는데 손님에게 갔다고 오해하면 안 됩니다.

const DRAFT_STATUS = {
    draft: "검토 대기",
    approved: "승인됨 (등록은 아직 안 합니다)",
    scheduled: "등록 예약",
    posting: "등록 중",
    posted: "등록 완료",
    failed: "등록 실패",
    rejected: "반려",
};

// 사람이 더는 못 건드리는 상태
const DRAFT_LOCKED = ["scheduled", "posting", "posted", "failed"];

function draftBox(draft) {
    const status = draft.status || "draft";
    const locked = DRAFT_LOCKED.includes(status);
    const label = DRAFT_STATUS[status] || status;

    return `<div class="rvdraft${status === "approved" ? " ok" : ""}" data-draft="${draft.id}">
        <div class="rvdraft-head">
          <span class="tag">AI 초안</span>
          <span class="rvmeta">${escape(label)}</span>
        </div>
        <textarea class="rvdraft-text" rows="3"${locked ? " readonly" : ""}
                  aria-label="답글 초안">${escape(draft.contents || "")}</textarea>
        ${locked ? "" : `<div class="rvdraft-actions">
          <button type="button" data-act="approve">승인</button>
          <button type="button" class="ghost" data-act="save">수정 저장</button>
          <button type="button" class="ghost" data-act="reject">반려</button>
          <span class="rvdraft-msg"></span>
        </div>`}
      </div>`;
}

// 버튼은 다시 그릴 때마다 새로 생깁니다. 목록에 한 번만 걸어 둡니다.
function initDrafts() {
    $("rv-list").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;

        const box = button.closest("[data-draft]");
        const id = Number(box.dataset.draft);
        const act = button.dataset.act;
        const message = box.querySelector(".rvdraft-msg");
        const buttons = [...box.querySelectorAll("button")];

        let reason = null;
        if (act === "reject") {
            reason = window.prompt("반려 사유를 적어주세요 (비워도 됩니다).\n"
                + "반려하면 이 리뷰는 다음 초안 생성 때 다시 씁니다.", "");
            if (reason === null) return;   // 취소
        }

        buttons.forEach((b) => { b.disabled = true; });
        message.className = "rvdraft-msg";
        message.textContent = "처리 중…";

        const call = act === "approve"
            ? db.rpc("approve_reply_draft", { p_draft_id: id })
            : act === "reject"
                ? db.rpc("reject_reply_draft", { p_draft_id: id, p_reason: reason })
                : db.rpc("edit_reply_draft", {
                    p_draft_id: id,
                    p_contents: box.querySelector(".rvdraft-text").value,
                });

        const { data, error } = await call;
        buttons.forEach((b) => { b.disabled = false; });

        if (error) {
            message.className = "rvdraft-msg error";
            message.textContent = error.message || "실패했습니다";
            return;
        }
        // 함수는 {ok, reason} 을 돌려줍니다. 실패해도 HTTP 는 200 입니다.
        if (data && data.ok === false) {
            message.className = "rvdraft-msg error";
            message.textContent = data.reason || "처리하지 못했습니다";
            return;
        }

        message.className = "rvdraft-msg ok";
        message.textContent = act === "approve" ? "승인했습니다"
            : act === "reject" ? "반려했습니다" : "저장했습니다";
        await load();     // 목록·요약을 다시 받습니다
    });
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
        category: catLabel(r.category),
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
            catLabel(r.category),
            ...buckets.map((b) => wonFull(r.buckets[b] || 0)),
            wonFull(r.total),
        ]));
}

// ---- 분류별 비중 ------------------------------------------------------
//
// 07_all_items.sql 이후 매출에서 빠지는 품목이 없습니다. 그래서 음료·주류·
// 비정규·미매핑이 전부 여기 잡힙니다. 비중의 분모는 표에 보이는 합계입니다.

function drawCategory(d, c) {
    const rows = (d.byCategory || []).map((r) => ({
        category: catLabel(r.category),
        amount: Number(r.amount) || 0,
        qty: Number(r.qty) || 0,
        menus: Number(r.menu_count) || 0,
    }));
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const share = (value) => (total ? value / total : 0);

    drawBars($("c-category"), {
        rows: rows.map((r) => ({
            label: catLabel(r.category),
            value: Math.round(share(r.amount) * 1000) / 10,
        })),
        color: c.s1, horizontal: true, colors: c, unitSuffix: "%",
    });

    table($("t-category"), ["분류", "매출", "비중", "수량", "품목 수"],
        rows.map((r) => [
            catLabel(r.category),
            wonFull(r.amount),
            `${(share(r.amount) * 100).toFixed(1)}%`,
            int(r.qty),
            `${r.menus}종`,
        ]));
}

// ---- 전 품목 ----------------------------------------------------------
//
// 품목이 801종이라 한 화면에 다 보여주는 대신 검색과 정렬을 답니다.
// 매출 0 · 수량만 있는 품목(리뷰이벤트 증정품 등)은 매출 정렬에서 맨 아래로
// 밀리므로 '증정품' 표시를 달아 검색으로 찾을 수 있게 합니다.

let allItemsSort = { key: 2, asc: false };
let allItemsRender = null;

function drawAllItems(d) {
    const rows = (d.allItems || []).map((r) => [
        r.menu,
        catLabel(r.category),
        Number(r.amount) || 0,
        Number(r.qty) || 0,
        Number(r.store_count) || 0,
        r.is_giveaway === true,
    ]);

    $("allitems-count").textContent = rows.length ? `${int(rows.length)}종` : "없음";

    const headers = ["품목", "분류", "매출", "수량", "판매 매장", "비고"];
    const format = [
        escape, escape, wonFull, int,
        (v) => `${v}곳`,
        (v) => (v ? '<span class="tag">증정품</span>' : ""),
    ];

    const render = () => {
        const query = ($("ai-search").value || "").trim().toLowerCase();
        const kept = query
            ? rows.filter((r) => String(r[0]).toLowerCase().includes(query)
                              || String(r[1]).toLowerCase().includes(query))
            : rows;

        $("allitems-shown").textContent =
            query ? `${int(kept.length)}종 표시 중` : "";

        const sorted = [...kept].sort((a, b) => {
            const [x, y] = [a[allItemsSort.key], b[allItemsSort.key]];
            const cmp = typeof x === "string"
                ? x.localeCompare(y)
                : Number(x) - Number(y);
            return allItemsSort.asc ? cmp : -cmp;
        });

        // html:true 라 셀을 자동으로 이스케이프하지 않습니다. 품목명·분류는
        // format 에서 escape 를 거칩니다(원본 품목명에 <> 가 섞여 들어옵니다).
        table($("t-allitems"), headers,
            sorted.map((r) => r.map((v, i) => format[i](v))),
            { sortable: true, sortState: allItemsSort, html: true });

        $("t-allitems").querySelectorAll("th.sortable").forEach((th, i) => {
            th.addEventListener("click", () => {
                allItemsSort = allItemsSort.key === i
                    ? { key: i, asc: !allItemsSort.asc }
                    : { key: i, asc: i === 0 || i === 1 };
                render();
            });
        });
    };

    allItemsRender = render;
    render();
}

// ---- 급증·급감 · 기간 대비 ---------------------------------------------
//
// 18_alerts.sql(api_sales_alerts) + 19_compare.sql(api_sales_compare).
// 임계값·판정 문구는 서버가 이미 계산해서 보내므로 여기선 그대로 표시만
// 합니다(기준 숫자를 화면에 다시 박지 않습니다 — CLAUDE.md).

function pctText(v) {
    if (v == null) return "—";
    return `${v > 0 ? "+" : ""}${v}%`;
}

function pctClass(v) {
    if (v == null) return "";
    return v > 0 ? "pct-up" : v < 0 ? "pct-down" : "";
}

function directionTag(direction) {
    if (direction === "급증") return '<span class="tag up">급증</span>';
    if (direction === "급감") return '<span class="tag down">급감</span>';
    if (direction === "정상") return '<span class="tag">정상</span>';
    return '<span class="meta">비교 대상 없음</span>';
}

function compareTile(label, block) {
    const b = block || {};
    return `<div class="tile">
        <div class="label">${escape(label)}</div>
        <div class="value">${won(b.amount)}</div>
        <div class="sub">
            전월 <span class="${pctClass(b.mom_pct_change)}">${pctText(b.mom_pct_change)}</span>
            · 전년동월 <span class="${pctClass(b.yoy_pct_change)}">${pctText(b.yoy_pct_change)}</span>
        </div>
    </div>`;
}

function drawAlerts(d) {
    const alerts = d.alerts || [];
    const compare = d.compare || {};

    $("alerts-summary").textContent = compare.ym
        ? `${ymLabel(compare.ym)} 기준 · 전월 ${ymLabel(compare.prev_mom_ym)}` +
          ` · 전년동월 ${ymLabel(compare.prev_yoy_ym)}`
        : "";

    $("compare-kpis").innerHTML =
        compareTile("회사 전체", compare.company) +
        (compare.by_channel || []).map((ch) => compareTile(ch.channel, ch)).join("");

    const flagged = alerts.filter((s) => s.has_alert);
    $("alerts-shown").textContent =
        `급증·급감 ${flagged.length} / 전체 ${alerts.length}개 매장`;

    const shown = $("alerts-only").checked ? flagged : alerts;
    const rows = shown.flatMap((s) => (s.channels || []).map((c) => [
        s.store, s.trade_area || "—", c.channel,
        wonFull(c.amount),
        `<span class="${pctClass(c.mom_pct_change)}">${pctText(c.mom_pct_change)}</span>`,
        directionTag(c.mom_direction),
        `<span class="${pctClass(c.yoy_pct_change)}">${pctText(c.yoy_pct_change)}</span>`,
        directionTag(c.yoy_direction),
    ]));

    table($("t-alerts"),
        ["매장", "상권", "채널", "매출", "전월 대비", "전월 판정", "전년동월 대비", "전년동월 판정"],
        rows, { html: true });
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

function catLabel(value) {
    if (!value) return "미분류";
    return CATEGORY_LABELS[value] || value;
}

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

// 동시에 도는 요청 수를 묶습니다.
//
// 왜 필요한가: Supabase 의 authenticated 역할은 쿼리 하나당 8초 제한이 있습니다.
// 팩트가 80만 행이라 집계 하나에 1.5~4초가 걸리는데, 18개를 한꺼번에 던지면
// 같은 CPU 를 나눠 쓰느라 전부 9~10초가 되어 **한 개도 못 받고 통째로 실패**합니다.
// (2026-07-29 실측: 11개 동시 → 10개가 제한 초과)
//
// 순서는 그대로 유지합니다 — 호출하는 쪽이 results[3] 처럼 자리로 꺼내 씁니다.
// thunks 중 idxs 자리만 골라 results 에 채웁니다. 오류가 있으면 그 오류를 돌려줍니다.
async function runInto(results, thunks, idxs, limit) {
    let next = 0;
    let error = null;
    async function worker() {
        while (next < idxs.length) {
            const i = idxs[next++];
            const r = await thunks[i]();
            results[i] = r;
            if (r && r.error && !error) error = r.error;
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, idxs.length) }, worker));
    return error;
}

async function runLimited(thunks, limit) {
    const results = new Array(thunks.length);
    let next = 0;
    async function worker() {
        while (next < thunks.length) {
            const i = next++;
            results[i] = await thunks[i]();
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, worker));
    return results;
}

// 선택 범위의 집계를 받아 여러 시트짜리 엑셀을 만들고 내려받습니다.
async function buildAndDownloadWorkbook(ymFrom, ymTo, storeArg, storeNames) {
    const XLSX = await loadSheetJS();

    const args = { p_ym_from: ymFrom, p_ym_to: ymTo, p_stores: storeArg };
    // 대시보드 시트(16_export_dashboard.sql)는 jsonb 한 줄로 옵니다 — 품목이
    // 2,600종을 넘어 행으로 받으면 PostgREST 1,000행에서 조용히 잘립니다(D10).
    const [summary, monthly, menu, coverage,
           mArea, mWeek, mDay, byHour, nonstd, detail, unmapped] =
        await Promise.all([
            db.rpc("api_export_store_summary", args),
            db.rpc("api_export_monthly", args),
            db.rpc("api_export_menu", args),
            db.rpc("api_export_coverage", args),
            db.rpc("api_export_menu_matrix", { p_field: "trade_area", ...args }),
            db.rpc("api_export_menu_matrix", { p_field: "weekday", ...args }),
            db.rpc("api_export_menu_matrix", { p_field: "daypart", ...args }),
            db.rpc("api_export_by_hour", args),
            db.rpc("api_export_nonstandard", args),
            db.rpc("api_export_store_detail", args),
            db.rpc("api_export_unmapped",
                   { p_ym_from: ymFrom, p_ym_to: ymTo }),
        ]);
    for (const r of [summary, monthly, menu, coverage, mArea, mWeek, mDay,
                     byHour, nonstd, detail, unmapped]) {
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
    addSheet(XLSX, wb, "매장별상세", oneRow(detail), [
        ["store", "매장"], ["trade_area", "상권"], ["amount", "총매출"],
        ["qty", "총수량"], ["avg_ticket", "객단가"], ["hall_amount", "홀매출"],
        ["delivery_amount", "배달매출"], ["delivery_ratio", "배달비중(%)"],
        ["menu_count", "메뉴수"], ["active_months", "활동월수"],
        ["source_count", "출처수"],
    ]);

    // 메뉴 × 축 3종. buckets 가 축마다 열이 달라져 시트를 그때그때 만듭니다.
    addMatrixSheet(XLSX, wb, "상권별_메뉴", oneRow(mArea));
    addMatrixSheet(XLSX, wb, "요일별_메뉴", oneRow(mWeek),
                   ["월", "화", "수", "목", "금", "토", "일"]);
    addMatrixSheet(XLSX, wb, "시간대별_메뉴", oneRow(mDay),
                   ["아침", "점심", "오후", "저녁"]);

    addSheet(XLSX, wb, "시간대", oneRow(byHour), [
        ["hour", "시"], ["amount", "매출"], ["qty", "수량"],
        ["hall_amount", "홀매출"], ["delivery_amount", "배달매출"],
    ]);
    // 비정규는 제외 대상이 아니라 감시 대상입니다(CLAUDE.md).
    addSheet(XLSX, wb, "비정규현황", oneRow(nonstd), [
        ["store", "매장"], ["trade_area", "상권"], ["total", "총매출"],
        ["nonstandard", "비정규매출"], ["ratio", "비정규비율(%)"],
        ["nonstandard_menus", "비정규품목수"],
    ]);
    // 미매핑은 보이기만 합니다. 담당자가 매핑표(엑셀)에서 직접 고칩니다.
    addSheet(XLSX, wb, "미매핑", oneRow(unmapped), [
        ["name", "품목명"], ["first_ym", "처음본달"], ["last_ym", "마지막달"],
        ["seen", "나온횟수"], ["sources", "출처"],
    ]);

    addSheet(XLSX, wb, "수집현황", coverage.data, [
        ["store", "매장"], ["ym", "연월"], ["amount", "매출"], ["has_data", "수집됨"],
    ]);

    const fname =
        `미태리_매출_${ymDash(ymFrom)}_${ymDash(ymTo)}`
        + `${storeNames && storeNames.length ? `_${storeNames.length}개매장` : "_전체"}.xlsx`;
    XLSX.writeFile(wb, fname);
}

// jsonb 한 줄로 오는 응답의 껍데기를 벗깁니다.
function oneRow(result) {
    const first = (result.data || [])[0];
    return (first && first.items) || [];
}

// 메뉴 × 축 시트. 축 값(상권·요일·시간대)이 데이터마다 달라 열을 먼저 모읍니다.
// order 를 주면 그 순서로 고정합니다 — 요일이 '금목수월…' 로 섞이면 못 읽습니다.
function addMatrixSheet(XLSX, wb, sheetName, rows, order) {
    const keys = new Set();
    for (const r of rows) for (const k of Object.keys(r.buckets || {})) keys.add(k);
    const cols = order
        ? order.filter((k) => keys.has(k)).concat([...keys].filter((k) => !order.includes(k)))
        : [...keys].sort();

    const header = ["메뉴", "대분류", "합계", ...cols];
    const body = rows.map((r) => [
        r.menu, catLabel(r.category), r.total,
        ...cols.map((k) => (r.buckets || {})[k] ?? 0),
    ]);
    XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([header, ...body]), sheetName);
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

// ================================================================ 위반 기록 (7번 영역)
//
// violation_events(23_notice_determination.sql)에 아무도 기록을 넣지 않으면
// api_notice_stage_status() 는 항상 빈 배열입니다 — 이 화면이 그 첫 입력
// 지점입니다. 날짜 필터(기간·매장)와 무관해 load() 묶음에 넣지 않고
// initRequests·initExport처럼 한 번만 받습니다.
//
// ⚠️ 여기서 계산하는 '단계'는 참고용입니다. 실제 내용증명 문서 생성·발송은
//    어디에도 없습니다 — 큐 #8 설계 그대로, 이 화면도 그 선을 넘지 않습니다.

let noticeRules = [];   // api_notice_stage_rules() 결과. 위반유형 select와 힌트 문구에 씁니다.

function ruleHasKind(rule, kind) {
    return !!rule && [rule.stage1, rule.stage2, rule.stage3].some((s) => s && s.kind === kind);
}

async function initNotices() {
    const storeSelect = $("v-store");
    const { data: stores, error: storeErr } = await db.from("stores")
        .select("id,name").order("name");
    if (!storeErr) {
        for (const s of stores || []) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.name;
            storeSelect.append(opt);
        }
    }

    const { data: rulesData, error: rulesErr } = await db.rpc("api_notice_stage_rules");
    noticeRules = rulesErr ? [] : (((rulesData || [])[0] || {}).rules || []);
    const typeSelect = $("v-type");
    for (const r of noticeRules) {
        const opt = document.createElement("option");
        opt.value = r.violation_type;
        opt.textContent = r.violation_type;
        typeSelect.append(opt);
    }

    $("v-occurred").value = new Date().toISOString().slice(0, 10);

    typeSelect.addEventListener("change", updateViolationFormFields);
    $("v-submit").addEventListener("click", submitViolation);
    initViolationResolve();
    initViolationReopen();

    await Promise.all([refreshViolations(), refreshResolvedViolations()]);
}

// 목록은 매번 새로 그려지므로(refreshViolations), 버튼 클릭은 컨테이너에
// 한 번만 위임해 둡니다(초안 승인/반려와 같은 패턴, initDrafts 참고).
function initViolationResolve() {
    $("t-violations").addEventListener("click", async (event) => {
        // 발송 승인 요청 (39_notice_tasks) — 판정 단계는 서버가 다시 세므로
        // 여기서는 위반 번호만 보냅니다.
        const noticeButton = event.target.closest("button[data-act='notice-task']");
        if (noticeButton) {
            noticeButton.disabled = true;
            noticeButton.textContent = "요청 중…";
            const { data, error } = await db.rpc("create_notice_send_task",
                { p_event_id: Number(noticeButton.dataset.eventId) });
            if (error || (data && data.ok === false)) {
                window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
                noticeButton.disabled = false;
                noticeButton.textContent = "발송 승인 요청";
                // 이미 흐름에 있다는 거절이면 배지가 그려지도록 다시 받습니다.
                if (!error && data.task_id) await refreshViolations();
                return;
            }
            // 업무 화면 쪽 숫자(승인 대기 타일·목록)도 같이 새로 그립니다.
            await Promise.all([refreshViolations(), refreshTasksSummary(), refreshTaskList()]);
            return;
        }
        const goButton = event.target.closest("button[data-act='notice-task-go']");
        if (goButton) {
            showArea("tasks");
            $("tk-filter-status").value = "waiting_approval";
            $("tk-filter-status").dispatchEvent(new Event("change"));
            return;
        }

        const button = event.target.closest("button[data-act='resolve']");
        if (!button) return;

        const eventId = Number(button.dataset.eventId);
        const today = new Date().toISOString().slice(0, 10);
        const resolvedOn = window.prompt(
            "종료일을 입력하세요 (YYYY-MM-DD). 잘못 눌러도 아래 표에서 다시 열 수 있습니다.", today);
        if (resolvedOn === null) return;   // 취소
        if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedOn.trim())) {
            window.alert("날짜 형식이 올바르지 않습니다 (예: 2026-07-29).");
            return;
        }

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("resolve_violation_event", {
            p_event_id: eventId,
            p_resolved_on: resolvedOn.trim(),
        });

        if (error) {
            window.alert("종료 처리하지 못했습니다: " + error.message);
            button.disabled = false;
            button.textContent = "종료 처리";
            return;
        }
        // 함수는 {ok, reason} 을 돌려줍니다. 실패해도 HTTP 는 200 입니다.
        if (data && data.ok === false) {
            window.alert(data.reason || "종료 처리하지 못했습니다");
            button.disabled = false;
            button.textContent = "종료 처리";
            return;
        }

        await Promise.all([refreshViolations(), refreshResolvedViolations()]);
    });
}

// 26_violation_reopen.sql — resolve_violation_event 와 대칭. 되돌린 건은
// '진행 중인 위반' 표로 다시 옮겨가므로 두 표를 같이 갱신합니다.
function initViolationReopen() {
    $("t-violations-resolved").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='reopen']");
        if (!button) return;

        const eventId = Number(button.dataset.eventId);
        const ok = window.confirm(
            "이 위반을 다시 진행 중 상태로 되돌릴까요? 위 '진행 중인 위반' 표에 다시 나타납니다.");
        if (!ok) return;

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("reopen_violation_event", { p_event_id: eventId });

        if (error) {
            window.alert("다시 열지 못했습니다: " + error.message);
            button.disabled = false;
            button.textContent = "다시 열기";
            return;
        }
        if (data && data.ok === false) {
            window.alert(data.reason || "다시 열지 못했습니다");
            button.disabled = false;
            button.textContent = "다시 열기";
            return;
        }

        await Promise.all([refreshViolations(), refreshResolvedViolations()]);
    });
}

// api_violation_events_resolved 도 api_notice_stage_status 와 같은 반환
// 형태입니다(returns jsonb 스칼라, 배열을 그대로 돌려줌, D10).
async function refreshResolvedViolations() {
    const { data, error } = await db.rpc("api_violation_events_resolved", { p_store: null, p_limit: 20 });
    if (error) {
        $("t-violations-resolved").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];

    if (!list.length) {
        $("t-violations-resolved").innerHTML =
            '<p class="hint">종료 처리된 위반 기록이 없습니다.</p>';
        return;
    }

    table($("t-violations-resolved"),
        ["매장", "위반유형", "발생일", "종료일", "메모", "처리"],
        list.map((v) => [
            v.store_name,
            v.violation_type,
            v.occurred_on,
            v.resolved_on,
            v.note ? escape(v.note) : "—",
            `<button type="button" class="ghost" data-act="reopen" data-event-id="${v.event_id}">다시 열기</button>`,
        ]),
        { html: true });
}

// 위반유형에 따라 '몇 차 지적'(sequential)·'로고 품목 여부'(자점매입 전용)
// 입력칸을 보이거나 숨깁니다. hq-standards.md 예외 3(자점매입)은 여기서
// 화면으로, 예외 1(무단 휴업 특약)은 rule.note 힌트로만 보여줍니다 — 실제
// 판정은 서버(api_notice_stage_status)가 합니다.
function updateViolationFormFields() {
    const type = $("v-type").value;
    const rule = noticeRules.find((r) => r.violation_type === type);

    $("v-seq-field").hidden = !ruleHasKind(rule, "sequential");
    $("v-logo-field").hidden = type !== "자점매입";

    const note = $("v-type-note");
    if (rule && rule.note) {
        note.textContent = rule.note;
        note.hidden = false;
    } else {
        note.hidden = true;
    }
}

async function submitViolation() {
    const notice = $("v-notice");
    const button = $("v-submit");
    const storeId = $("v-store").value;
    const violationType = $("v-type").value;
    const occurred = $("v-occurred").value;
    const resolved = $("v-resolved").value || null;
    const seqField = $("v-seq");
    const logoField = $("v-logo");

    if (!storeId || !violationType || !occurred) {
        notice.className = "notice error";
        notice.textContent = "매장·위반유형·발생일은 필수입니다.";
        return;
    }
    if (resolved && resolved < occurred) {
        notice.className = "notice error";
        notice.textContent = "종료일이 발생일보다 앞설 수 없습니다.";
        return;
    }

    const rule = noticeRules.find((r) => r.violation_type === violationType);
    const isSequential = ruleHasKind(rule, "sequential");

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("violation_events").insert({
        store_id: Number(storeId),
        violation_type: violationType,
        occurred_on: occurred,
        resolved_on: resolved,
        sequence_no: (isSequential && seqField.value) ? Number(seqField.value) : null,
        applies_logo_required_item: (violationType === "자점매입" && logoField.value)
            ? logoField.value === "true" : null,
        note: $("v-note").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "저장했습니다.";
    $("v-note").value = "";
    $("v-resolved").value = "";
    seqField.value = "";
    logoField.value = "";
    await Promise.all([refreshViolations(), refreshResolvedViolations()]);
}

// api_notice_stage_status 는 `returns jsonb`(스칼라)라 다른 조회 함수들과
// 달리 [{alerts:[...]}] 로 한 번 더 감싸지 않습니다 — data 자체가 배열입니다
// (14_reply_drafts.sql 의 approve_reply_draft 등과 같은 모양, D10 조회 규칙은
// 그대로 지키되 반환 형태만 다름).
async function refreshViolations() {
    // 승인 흐름 배지(39_notice_tasks)를 같이 받습니다 — 이미 요청된 건에
    // 또 요청 버튼을 보여주면 중복 요청을 함수가 거절하는 것으로 끝나지만,
    // 애초에 버튼이 안 보이는 편이 낫습니다.
    const [{ data, error }, { data: sendTasks }] = await Promise.all([
        db.rpc("api_notice_stage_status", { p_store: null }),
        db.rpc("api_notice_send_tasks"),
    ]);
    if (error) {
        $("t-violations").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    // 위반+단계 → 살아 있는 승인 업무. 반려된 것은 다시 요청할 수 있어야
    // 하므로 배지로 치지 않습니다(39 설계 판단 [3]과 같은 규칙).
    const liveTask = new Map();
    for (const t of (Array.isArray(sendTasks) ? sendTasks : [])) {
        if (t.task_status === "rejected") continue;
        liveTask.set(`${t.violation_id}|${t.stage}`, t);
    }
    $("violation-summary").textContent = list.length ? `${int(list.length)}건 진행 중` : "";

    if (!list.length) {
        $("t-violations").innerHTML =
            '<p class="hint">진행 중인 위반 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-violations"),
        ["매장", "위반유형", "발생일", "경과일", "단계", "확인 필요", "메모", "처리"],
        list.map((v) => [
            v.store_name,
            v.violation_type,
            v.occurred_on,
            int(v.days_elapsed),
            stageTag(v.stage, v.stage_label, v.requires_legal_review),
            v.needs_manual_review
                ? `<span class="flag" title="${escape(v.manual_review_reason || "")}">담당자 확인</span>`
                : "—",
            v.note ? escape(v.note) : "—",
            noticeActions(v, liveTask.get(`${v.event_id}|${v.stage}`)),
        ]),
        { html: true });
}

// 처리 칸: 종료 처리 + (단계 도달 시) 발송 승인 요청 또는 진행 중 배지.
function noticeActions(v, live) {
    const resolve = `<button type="button" class="ghost" data-act="resolve"`
        + ` data-event-id="${v.event_id}">종료 처리</button>`;
    if (!v.stage) return resolve;

    if (live) {
        const label = live.task_status === "done"
            ? "발송 승인됨" : TASK_STATUS_LABEL[live.task_status] || live.task_status;
        return `<span class="tag${live.task_status === "done" ? " up" : " h-warn"}">`
            + `${escape(label)}</span> `
            + `<button type="button" class="ghost" data-act="notice-task-go">업무 보기</button> `
            + resolve;
    }
    return `<button type="button" data-act="notice-task"`
        + ` data-event-id="${v.event_id}">발송 승인 요청</button> ` + resolve;
}

function stageTag(stage, label, requiresLegal) {
    if (!stage) return '<span class="tag">해당 없음(제재 대상 아님)</span>';
    const tag = `<span class="tag${stage >= 3 ? " down" : ""}">` +
        `${escape(String(stage))}단계 · ${escape(label || "")}</span>`;
    return tag + (requiresLegal ? ' <span class="flag">법무 검토</span>' : "");
}

// ================================================================ 방문·점검 (9번 영역)
//
// store_visits(25_store_visits.sql)에 아무도 기록을 넣지 않으면 목록은
// 항상 빈 표입니다 — 이 화면이 그 첫 입력 지점입니다. 위반 기록(initNotices)
// 과 같은 이유로 날짜 필터(기간·매장)와 무관해 load() 묶음에 넣지 않고
// 한 번만 받습니다.
//
// "재방문 시 이전 이력 자동 조회"는 새 조회를 만들지 않고, 매장 select 를
// 바꿀 때마다 같은 api_store_visits 를 p_store 만 바꿔 다시 부르는 것으로
// 풉니다 — 서버가 이미 최신순으로 정렬해 주므로 맨 위가 직전 방문입니다.

// "내 담당 매장" 필터 재료 (PLAN 2주차 9번 'SV 배정 축').
// 배정은 가맹점DB 반입분(store_profiles.sv_name)이 원천입니다 — 화면은
// 읽기만 하고, 배정을 고치는 곳은 반입 도구/추후 매장 정보 화면입니다.
let visitAllStores = [];              // 전 매장 [{id, name}] — SV 로 거를 때 원본
let visitSvByStore = new Map();       // 매장 이름 → SV 이름
let visitStoresBySv = new Map();      // SV 이름 → 매장 이름 Set
let visitRowsCache = new Map();       // visit_id → 행 원본 — '보고 복사' 재료

async function initVisits() {
    const storeSelect = $("vs-store");
    const { data: stores, error: storeErr } = await db.from("stores")
        .select("id,name").order("name");
    if (!storeErr) visitAllStores = stores || [];
    rebuildVisitStoreOptions();

    // SV 배정 (없으면 필터 자체를 안 보여줍니다 — 빈 select 는 소음입니다)
    const { data: profiles, error: profErr } = await db.rpc("api_store_profiles");
    if (!profErr && Array.isArray(profiles)) {
        for (const p of profiles) {
            if (!p.sv_name) continue;
            visitSvByStore.set(p.store_name, p.sv_name);
            if (!visitStoresBySv.has(p.sv_name)) visitStoresBySv.set(p.sv_name, new Set());
            visitStoresBySv.get(p.sv_name).add(p.store_name);
        }
    }
    if (visitStoresBySv.size) {
        const svSelect = $("vs-sv");
        for (const sv of [...visitStoresBySv.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
            const opt = document.createElement("option");
            opt.value = sv;
            opt.textContent = `${sv} (${visitStoresBySv.get(sv).size}곳)`;
            svSelect.append(opt);
        }
        $("vs-sv-field").hidden = false;
        svSelect.addEventListener("change", async () => {
            rebuildVisitStoreOptions();
            await refreshVisits();
            await refreshVisitStoreMetrics();
        });
    }

    $("vs-visited-on").value = new Date().toISOString().slice(0, 10);

    storeSelect.addEventListener("change", refreshVisits);
    storeSelect.addEventListener("change", refreshVisitStoreMetrics);
    $("vs-submit").addEventListener("click", submitVisit);

    // '보고 복사' — 기록을 실물 양식 텍스트로 만들어 클립보드에 담습니다.
    // 버튼 글씨로 결과를 알립니다(복사됨 ✓ / 복사 실패) — 별도 알림창 없음.
    $("t-visits").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='visit-report']");
        if (!button) return;
        const row = visitRowsCache.get(button.dataset.visitId);
        if (!row) return;
        const ok = await copyTextToClipboard(buildVisitReport(row));
        button.textContent = ok ? "복사됨 ✓" : "복사 실패";
        setTimeout(() => { button.textContent = "보고 복사"; }, 1500);
    });

    await refreshVisits();
    await refreshVisitStoreMetrics();
}

// 매장 select 를 SV 선택에 맞춰 다시 채웁니다. 고른 매장이 그 SV 담당이면
// 선택을 살리고, 아니면 초기화합니다(다른 SV 매장에 기록이 남는 실수 방지).
function rebuildVisitStoreOptions() {
    const storeSelect = $("vs-store");
    const sv = $("vs-sv") ? $("vs-sv").value : "";
    const mine = sv ? visitStoresBySv.get(sv) : null;
    const keep = storeSelect.selectedOptions[0]?.textContent;

    storeSelect.innerHTML = '<option value="">매장을 고르세요</option>';
    for (const s of visitAllStores) {
        if (mine && !mine.has(s.name)) continue;
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        if (s.name === keep) opt.selected = true;
        storeSelect.append(opt);
    }
}

async function submitVisit() {
    const notice = $("vs-notice");
    const button = $("vs-submit");
    const storeId = $("vs-store").value;
    const visitedOn = $("vs-visited-on").value;

    if (!storeId || !visitedOn) {
        notice.className = "notice error";
        notice.textContent = "매장·방문일은 필수입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("store_visits").insert({
        store_id: Number(storeId),
        visited_on: visitedOn,
        visited_by: $("vs-visited-by").value.trim() || null,
        hygiene_note: $("vs-hygiene").value.trim() || null,
        self_purchase_note: $("vs-self-purchase").value.trim() || null,
        cooking_note: $("vs-cooking").value.trim() || null,
        owner_meeting_note: $("vs-owner-meeting").value.trim() || null,
        special_note: $("vs-special").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "저장했습니다.";
    for (const id of ["vs-visited-by", "vs-hygiene", "vs-self-purchase",
                       "vs-cooking", "vs-owner-meeting", "vs-special"]) {
        $(id).value = "";
    }
    await refreshVisits();
}

// vs-store 를 고르면 그 매장만, 비워 두면 전 매장 최근 방문을 보여줍니다
// (재방문 시 이전 이력 자동 조회 요구사항 — 새 조회가 아니라 p_store 필터).
async function refreshVisits() {
    const storeId = $("vs-store").value;
    const storeName = storeId
        ? ($("vs-store").selectedOptions[0]?.textContent || null)
        : null;

    const { data, error } = await db.rpc("api_store_visits", { p_store: storeName });
    if (error) {
        $("t-visits").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    let list = Array.isArray(data) ? data : [];

    // SV 를 골랐고 매장은 안 골랐으면 그 SV 담당 매장의 방문만 보여줍니다.
    // api_store_visits 는 매장 하나만 거를 줄 알아서(p_store), SV 묶음은
    // 여기서 거릅니다 — 방문 기록은 화면 한 장 분량이라 충분합니다.
    const sv = $("vs-sv") ? $("vs-sv").value : "";
    if (sv && !storeName) {
        const mine = visitStoresBySv.get(sv) || new Set();
        list = list.filter((v) => mine.has(v.store_name));
    }

    $("visit-summary").textContent = storeName
        ? `${escape(storeName)} · ${int(list.length)}건`
        : (sv
            ? `${escape(sv)} 담당 ${int((visitStoresBySv.get(sv) || new Set()).size)}곳 · 방문 ${int(list.length)}건`
            : `전 매장 최근 ${int(list.length)}건`);

    if (!list.length) {
        $("t-visits").innerHTML =
            '<p class="hint">방문 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    // '보고 복사' 버튼이 원본 행(줄바꿈 포함)을 되찾을 수 있게 담아 둡니다.
    visitRowsCache = new Map(list.map((v) => [String(v.visit_id), v]));

    // 절 안의 항목("- …" / "ㄴ …")이 여러 줄이라 줄바꿈을 살려 그립니다.
    const multiline = (t) => (t ? escape(t).replaceAll("\n", "<br>") : "—");
    table($("t-visits"),
        ["매장", "방문일", "방문자", "위생점검", "자점매입", "조리점검", "점주미팅", "특이사항", "공유"],
        list.map((v) => [
            escape(v.store_name),
            escape(v.visited_on),
            v.visited_by ? escape(v.visited_by) : "—",
            multiline(v.hygiene_note),
            multiline(v.self_purchase_note),
            multiline(v.cooking_note),
            multiline(v.owner_meeting_note),
            multiline(v.special_note),
            `<button type="button" class="ghost" data-act="visit-report" data-visit-id="${v.visit_id}">보고 복사</button>`,
        ]),
        { html: true });
}

// 점검 보고 텍스트 — 운영지원팀 실물 양식(광주신안점 예시, 답변서 11번)
// 그대로. 공유 채널이 아직 카카오톡 단톡방이라(9번 답변 "카카오톡으로 공유")
// '복사 → 단톡방 붙여넣기' 가 발송을 대신합니다(QUEUE #63). 절이 비면
// 실물 양식의 관례대로 "- 특이사항 없음" 으로 채웁니다.
function buildVisitReport(v) {
    const section = (title, text) =>
        `${title}\n${(text || "").trim() || "- 특이사항 없음"}`;
    return [
        `미태리 ${v.store_name} 점검 보고`,
        `점검일자: ${String(v.visited_on).replaceAll("-", ".")}`
            + (v.visited_by ? ` · 방문 ${v.visited_by}` : ""),
        "",
        section("1. 위생점검", v.hygiene_note),
        "",
        section("2. 자점매입", v.self_purchase_note),
        "",
        section("3. 조리점검", v.cooking_note),
        "",
        section("4. 점주미팅 내용", v.owner_meeting_note),
        "",
        section("5. 특이사항", v.special_note),
    ].join("\n");
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // 클립보드 API 가 막히는 환경(http 로컬 확인·데모 file://)의 예비 경로.
        const holder = document.createElement("textarea");
        holder.value = text;
        holder.style.position = "fixed";
        holder.style.opacity = "0";
        document.body.append(holder);
        holder.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { /* 아래 false */ }
        holder.remove();
        return ok;
    }
}

// 방문 예정 매장의 매출 사전 집계 — 새 조회를 만들지 않고 기존
// api_store_metrics(04_analysis.sql, 전 매장 비교표)를 그대로 불러서
// 이 매장 행만 골라 보여줍니다. 그 함수엔 매장 필터 인자가 없어(전 매장
// 비교가 목적) 서버가 아니라 여기서 이름으로 골라냅니다.
async function refreshVisitStoreMetrics() {
    const storeSelect = $("vs-store");
    const storeName = storeSelect.value
        ? (storeSelect.selectedOptions[0]?.textContent || null)
        : null;
    const kpis = $("visit-store-kpis");
    const hint = $("vsm-hint");

    if (!storeName) {
        kpis.hidden = true;
        hint.hidden = false;
        hint.textContent = "매장을 고르면 방문 전 참고용으로 최근 매출을 보여줍니다.";
        return;
    }

    const ymTo = filterRange?.max;
    if (!ymTo) {
        kpis.hidden = true;
        hint.hidden = false;
        hint.textContent = "매출 데이터를 아직 불러오지 못했습니다.";
        return;
    }
    const ymFrom = shiftYm(ymTo, -2); // 최근 3개월(당월 포함)

    const { data, error } = await db.rpc("api_store_metrics",
        { p_ym_from: ymFrom, p_ym_to: ymTo, p_channel: null });
    if (error) {
        kpis.hidden = true;
        hint.hidden = false;
        hint.textContent = "매출을 불러오지 못했습니다: " + error.message;
        return;
    }

    const row = (Array.isArray(data) ? data : []).find((r) => r.store === storeName);
    if (!row) {
        kpis.hidden = true;
        hint.hidden = false;
        hint.textContent = `${storeName}의 최근 매출 데이터가 없습니다(수집 전이거나 신규 매장).`;
        return;
    }

    hint.hidden = true;
    kpis.hidden = false;
    $("vsm-amount").textContent = won(row.amount);
    $("vsm-range").textContent = `${ymLabel(ymFrom)} ~ ${ymLabel(ymTo)}`;
    $("vsm-qty").textContent = int(row.qty);
    $("vsm-hall").textContent = won(row.hall_amount);
    $("vsm-delivery").textContent = won(row.delivery_amount);
}

// ym(YYYYMM 정수)를 개월 수만큼 이동합니다. offset 은 음수 가능.
function shiftYm(ym, offset) {
    let year = Math.floor(ym / 100);
    let month = (ym % 100) + offset;
    while (month < 1) { month += 12; year -= 1; }
    while (month > 12) { month -= 12; year += 1; }
    return year * 100 + month;
}

// ================================================================ 가맹점 DB (9번 기반)
//
// docs/store-db-design.md 4절 조립. 표는 api_store_profiles(35)를 그대로
// 쓰되, stores 에는 있는데 프로필이 없는 매장(반입 때 못 찾음·업로더가 새로
// 만든 매장)도 빈 행으로 끼워 보여줍니다 — 그래야 이 화면 하나로 빠진
// 프로필을 채울 수 있습니다(save_store_profile 이 upsert 라 저장이 곧 생성).
//
// 수정은 행 단위 인라인입니다. RLS update 를 열지 않고 전용 함수
// (save_store_profile, 44 — updated_by 기록)로만 저장합니다.

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

async function initStoreDb() {
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

// ================================================================ 계정 관리 (기반)
//
// 채널별 계정 '유무만' 그립니다 — api_account_presence(44)는 아이디·비밀번호를
// 읽지도 않는 함수입니다. 게이트 뒤 상세(실계정·연락처)는 담당자 확인 3건이
// 남아 있어 카드 아래 안내 한 줄이 그 자리를 대신합니다(index.html 주석).

let apData = null;   // { channels: [...], stores: [{store_name, has: {...}}], totals: {...} }

async function initAccountPresence() {
    const { data, error } = await db.rpc("api_account_presence");
    if (error) {
        $("ap-table").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    apData = data || { channels: [], stores: [], totals: {} };

    const channelSelect = $("ap-channel");
    for (const ch of apData.channels) {
        const opt = document.createElement("option");
        opt.value = ch;
        opt.textContent = ch;
        channelSelect.append(opt);
    }
    channelSelect.addEventListener("change", drawAccountPresence);
    $("ap-state").addEventListener("change", drawAccountPresence);
    drawAccountPresence();
}

function drawAccountPresence() {
    const channel = $("ap-channel").value;
    const state = $("ap-state").value;

    const withAny = apData.stores.filter((s) => Object.keys(s.has).length).length;
    $("ap-summary").textContent =
        apData.channels.map((ch) => `${ch} ${int(apData.totals[ch] || 0)}`).join(" · ")
        + ` · 계정 있는 매장 ${int(withAny)}/${int(apData.stores.length)}곳`;

    let list = apData.stores;
    if (channel) {
        if (state === "has") list = list.filter((s) => s.has[channel]);
        else if (state === "none") list = list.filter((s) => !s.has[channel]);
    } else if (state === "has") {
        list = list.filter((s) => Object.keys(s.has).length);
    } else if (state === "none") {
        list = list.filter((s) => !Object.keys(s.has).length);
    }

    if (!list.length) {
        $("ap-table").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }

    const columns = channel ? [channel] : apData.channels;
    table($("ap-table"),
        ["매장", ...columns],
        list.map((s) => [
            s.store_name,
            ...columns.map((ch) => (s.has[ch] ? "✓" : "")),
        ]));
}

// ================================================================ 오픈·폐점 (8번 영역)
//
// 27_store_lifecycle.sql. 방문·점검(initVisits)과 같은 이유로 날짜 필터
// (기간·매장)와 무관해 load() 묶음에 넣지 않고 한 번만 받습니다. 매장을
// 고르면 이력 표만 그 매장으로 좁힙니다(store_visits 와 같은 방식).

async function initLifecycle() {
    const storeSelect = $("la-store");
    const { data: stores, error: storeErr } = await db.from("stores")
        .select("id,name").order("name");
    if (!storeErr) {
        for (const s of stores || []) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.name;
            storeSelect.append(opt);
        }
    }

    $("la-date").value = new Date().toISOString().slice(0, 10);

    storeSelect.addEventListener("change", refreshLifecycleHistory);
    $("la-submit").addEventListener("click", submitLifecycleEvent);

    await Promise.all([
        refreshLifecycleSummary(),
        refreshLifecycleStatus(),
        refreshLifecycleHistory(),
    ]);
}

async function submitLifecycleEvent() {
    const notice = $("la-notice");
    const button = $("la-submit");
    const storeId = $("la-store").value;
    const eventDate = $("la-date").value;

    if (!storeId || !eventDate) {
        notice.className = "notice error";
        notice.textContent = "매장·일자는 필수입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("store_lifecycle_events").insert({
        store_id: Number(storeId),
        event_type: $("la-type").value,
        event_date: eventDate,
        note: $("la-note").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "저장했습니다.";
    $("la-note").value = "";
    await Promise.all([
        refreshLifecycleSummary(),
        refreshLifecycleStatus(),
        refreshLifecycleHistory(),
    ]);
}

async function refreshLifecycleSummary() {
    const { data, error } = await db.rpc("api_store_lifecycle_summary");
    if (error) {
        $("lifecycle-summary-year").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    $("lifecycle-summary-year").textContent = `${data.year}년`;
    $("ls-opens").textContent = int(data.opens);
    $("ls-opens-baseline").textContent = `참고: 연 평균 ${int(data.opens_baseline)}건`;
    $("ls-closes").textContent = int(data.closes);
    $("ls-closes-baseline").textContent = `참고: 연 평균 ${int(data.closes_baseline)}건`;
}

async function refreshLifecycleStatus() {
    const { data, error } = await db.rpc("api_store_lifecycle_status");
    if (error) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    $("lifecycle-status-summary").textContent = `기록 있는 매장 ${int(list.length)}곳`;

    if (!list.length) {
        $("t-lifecycle-status").innerHTML =
            '<p class="hint">아직 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-lifecycle-status"),
        ["매장", "상태", "최근 이벤트일", "경과일"],
        list.map((v) => [
            v.store_name,
            v.status === "open"
                ? '<span class="tag">오픈</span>'
                : '<span class="tag down">폐점</span>',
            v.since,
            `${int(v.days_since)}일`,
        ]),
        { html: true });
}

// la-store 를 고르면 그 매장만, 비워 두면 전 매장 최근 기록을 보여줍니다.
async function refreshLifecycleHistory() {
    const storeId = $("la-store").value;
    const storeName = storeId
        ? ($("la-store").selectedOptions[0]?.textContent || null)
        : null;

    const { data, error } = await db.rpc("api_store_lifecycle", { p_store: storeName });
    if (error) {
        $("t-lifecycle").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    $("lifecycle-history-summary").textContent = storeName
        ? `${escape(storeName)} · ${int(list.length)}건`
        : `전 매장 최근 ${int(list.length)}건`;

    if (!list.length) {
        $("t-lifecycle").innerHTML =
            '<p class="hint">이력이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-lifecycle"),
        ["매장", "구분", "일자", "메모"],
        list.map((v) => [
            v.store_name,
            v.event_type === "open" ? "오픈" : "폐점",
            v.event_date,
            v.note || "—",
        ]));
}

// ================================================================ 업무 (11번 영역)
//
// 30_tasks.sql 위의 화면입니다. 매출 축과 그레인이 달라(접수 건 단위) 위쪽
// 기간·매장 필터를 따르지 않습니다 — initVisits·initLifecycle 과 같은 이유로
// load() 묶음에 넣지 않고 한 번만 받은 뒤, 무언가를 바꿨을 때만 다시 받습니다.
//
// [상태를 왜 함수로만 옮기는가]
//   advance_task() 가 유일한 통로입니다(30_tasks 설계 판단 [3]). 화면에서
//   tasks 를 직접 update 하면 이력 없이 상태만 바뀐 행이 생깁니다 — 이 축의
//   존재 이유가 이력이라 그 구멍을 만들지 않습니다.
//
// [승인 강제(D18)를 화면이 흉내내지 않습니다]
//   '완료' 를 눌러 거절당하면 그 사유를 그대로 보여줍니다. 화면이 미리 막으면
//   규칙이 두 군데(SQL·JS)에 생기고, 본사가 task_kinds 를 고쳐도 화면은
//   옛 규칙으로 막습니다. 판정은 한 곳에서만 합니다.

const TASK_STATUS_LABEL = {
    received: "접수",
    in_progress: "처리 중",
    waiting_approval: "승인 대기",
    escalated: "이관",
    done: "완료",
    rejected: "반려",
};

const TASK_SOURCE_LABEL = {
    web: "웹", kakao: "카카오", phone: "전화", sms: "문자", auto: "자동",
};

let taskKinds = [];        // task_kinds 표. 종류 select 와 승인 필요 여부에 씁니다.
let taskPreauths = [];     // task_preauthorizations 표(철회된 것 포함 — 표에 같이 보입니다).
let taskRows = [];         // 마지막으로 받은 목록. 필터는 이것만 다시 그립니다.

// 어느 버튼을 보여줄지. '승인 요청' 은 승인이 필요한 종류에서만 뜻이 있습니다.
function taskActions(status, needsApproval) {
    switch (status) {
        case "received":
            return [["in_progress", "처리 시작"], ["escalated", "이관"], ["rejected", "반려"]];
        case "in_progress":
            return [
                ...(needsApproval ? [["waiting_approval", "승인 요청"]] : []),
                ["done", "완료"], ["escalated", "이관"], ["rejected", "반려"]];
        case "waiting_approval":
            return [["done", "승인·완료"], ["rejected", "반려"]];
        case "escalated":
            return [["in_progress", "처리 시작"], ["done", "완료"], ["rejected", "반려"]];
        default:
            return [];   // done · rejected 는 끝난 업무입니다
    }
}

function taskNeedsApproval(kind) {
    return !!taskKinds.find((k) => k.kind === kind)?.needs_approval;
}

// 이 업무에 댈 수 있는 살아 있는 고지. 종류를 콕 집은 고지를 먼저 봅니다
// (종류 무관 고지보다 좁아서 근거로 더 정확합니다).
function applicablePreauth(kind) {
    const alive = taskPreauths.filter((p) => !p.revoked_at);
    return alive.find((p) => p.kind === kind) || alive.find((p) => !p.kind) || null;
}

async function initTasks() {
    const { data: kinds } = await db.from("task_kinds").select("kind,name,needs_approval,enabled");
    taskKinds = (kinds || []).filter((k) => k.enabled !== false);
    for (const k of taskKinds) {
        const opt = document.createElement("option");
        opt.value = k.kind;
        opt.textContent = k.needs_approval ? `${k.name} (승인 필요)` : k.name;
        $("tk-kind").append(opt);

        const paOpt = document.createElement("option");
        paOpt.value = k.kind;
        paOpt.textContent = k.name;
        $("pa-kind").append(paOpt);
    }

    const { data: stores } = await db.from("stores").select("id,name").order("name");
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        $("tk-store").append(opt);

        const filterOpt = document.createElement("option");
        filterOpt.value = s.name;      // api_tasks 의 p_store 는 매장 이름입니다
        filterOpt.textContent = s.name;
        $("tk-filter-store").append(filterOpt);
    }

    $("tk-submit").addEventListener("click", submitTask);
    $("pa-submit").addEventListener("click", submitPreauth);
    // 상태·매장은 서버에서 걸러야 하고(200건 상한 안쪽으로 좁히려고),
    // '미처리만' 은 이미 받아 둔 것을 다시 그리기만 합니다.
    $("tk-filter-status").addEventListener("change", refreshTaskList);
    $("tk-filter-store").addEventListener("change", refreshTaskList);
    $("tk-filter-overdue").addEventListener("change", drawTaskList);
    initTaskActions();
    initPreauthActions();

    await Promise.all([refreshTasksSummary(), refreshTaskList(), refreshPreauths()]);
}

async function refreshTasksSummary() {
    const { data, error } = await db.rpc("api_tasks_summary");
    if (error) {
        $("tasks-summary-meta").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    const by = data.by_status || {};
    $("tk-overdue").textContent = int(data.overdue);
    $("tk-overdue-sub").textContent = `접수 후 ${int(data.overdue_days)}일이 지나도록 끝나지 않은 건`;
    $("tk-received").textContent = int(by.received);
    $("tk-in-progress").textContent = int(by.in_progress);
    $("tk-waiting").textContent = int(by.waiting_approval);
    $("tk-escalated").textContent = int(by.escalated);
    $("tasks-summary-meta").textContent =
        `미처리 기준 ${int(data.overdue_days)}일 — 본사가 정합니다`;

    // 홈 '오늘 할 일' 타일. 같은 숫자를 두 번 묻지 않으려고 여기서 같이 채웁니다.
    const homeTasks = $("home-tasks");
    if (homeTasks) {
        homeTasks.textContent = int(data.overdue);
        $("home-tasks-sub").textContent =
            `접수 후 ${int(data.overdue_days)}일이 지난 건 (전체 기간)`;
    }
}

async function refreshTaskList() {
    const status = $("tk-filter-status").value;
    const store = $("tk-filter-store").value;
    const { data, error } = await db.rpc("api_tasks", {
        // 'open'(진행 중)은 한 상태가 아니라 묶음이라 서버에 넘기지 않고
        // 아래에서 걸러냅니다. api_tasks 는 상태 하나만 받습니다.
        p_status: status && status !== "open" ? status : null,
        p_store: store || null,
        p_limit: 200,
    });
    if (error) {
        taskRows = [];
        $("t-tasks").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    taskRows = Array.isArray(data) ? data : [];
    drawTaskList();
}

function drawTaskList() {
    const openOnly = $("tk-filter-status").value === "open";
    const overdueOnly = $("tk-filter-overdue").checked;
    const rows = taskRows.filter((t) =>
        (!openOnly || !["done", "rejected"].includes(t.status)) &&
        (!overdueOnly || t.overdue));

    $("task-list-summary").textContent = `${int(rows.length)}건`;
    $("tk-shown").textContent = rows.length === taskRows.length
        ? "" : `전체 ${int(taskRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("t-tasks").innerHTML =
            '<p class="hint">해당하는 업무가 없습니다. 위 폼에서 접수하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-tasks"),
        ["상태", "종류", "제목", "매장", "담당자", "접수", "경과", "처리"],
        rows.map((t) => [
            taskStatusTag(t.status),
            escape(t.kind_name || t.kind),
            escape(t.title) + (t.body ? `<div class="meta">${escape(clip(t.body, 60))}</div>` : ""),
            escape(t.store_name || "—"),
            escape(t.assigned_to || "—"),
            `${escape(String(t.created_at).slice(0, 10))}`
                + `<div class="meta">${escape(TASK_SOURCE_LABEL[t.source] || t.source)}</div>`,
            t.overdue
                ? `<span class="tag warn">미처리 ${int(t.age_days)}일</span>`
                : `${int(t.age_days)}일`,
            taskActionButtons(t),
        ]),
        { html: true });
}

function taskStatusTag(status) {
    const label = escape(TASK_STATUS_LABEL[status] || status);
    if (status === "done") return `<span class="tag up">${label}</span>`;
    if (status === "waiting_approval" || status === "escalated") {
        return `<span class="tag h-warn">${label}</span>`;
    }
    return `<span class="tag">${label}</span>`;
}

function taskActionButtons(t) {
    const needsApproval = taskNeedsApproval(t.kind);
    const buttons = taskActions(t.status, needsApproval).map(([to, label]) =>
        `<button class="ghost" data-act="task-advance" data-task-id="${t.task_id}"`
        + ` data-to="${to}">${escape(label)}</button>`);

    // D35 — 승인이 필요한 건을 살아 있는 고지로 바로 완료. 승인 대기 상태는
    // 이미 '승인·완료' 가 있으므로 그때는 붙이지 않습니다.
    if (needsApproval && !["done", "rejected", "waiting_approval"].includes(t.status)) {
        const preauth = applicablePreauth(t.kind);
        if (preauth) {
            buttons.push(
                `<button class="ghost" data-act="task-advance" data-task-id="${t.task_id}"`
                + ` data-to="done" data-preauth-id="${preauth.id}">고지로 완료</button>`);
        }
    }

    buttons.push(`<button class="ghost" data-act="task-events" data-task-id="${t.task_id}"`
        + ` data-task-title="${escape(t.title)}">이력</button>`);
    return buttons.join(" ");
}

// 목록은 매번 새로 그려지므로 컨테이너에 한 번만 위임합니다
// (initViolationResolve·initDrafts 와 같은 패턴).
function initTaskActions() {
    $("t-tasks").addEventListener("click", async (event) => {
        const historyButton = event.target.closest("button[data-act='task-events']");
        if (historyButton) {
            await showTaskEvents(Number(historyButton.dataset.taskId),
                historyButton.dataset.taskTitle);
            return;
        }

        const button = event.target.closest("button[data-act='task-advance']");
        if (!button) return;

        const taskId = Number(button.dataset.taskId);
        const to = button.dataset.to;
        const preauthId = button.dataset.preauthId ? Number(button.dataset.preauthId) : null;
        // 전이 뒤 어느 화면을 같이 갱신할지 판단하려고 종류를 기억해 둡니다.
        const moved = taskRows.find((t) => t.task_id === taskId);

        // 이관·반려는 사유가 곧 다음 사람이 읽을 내용이라 받아 둡니다.
        let note = null;
        if (to === "escalated") {
            note = window.prompt("누구에게 왜 넘기는지 적어 주세요. 이력에 남습니다.", "");
            if (note === null) return;
        } else if (to === "rejected") {
            note = window.prompt("반려 사유를 적어 주세요. 이력에 남습니다.", "");
            if (note === null) return;
        }

        if (preauthId) {
            const preauth = taskPreauths.find((p) => p.id === preauthId);
            const ok = window.confirm(
                `사전 고지 「${preauth?.scope || preauthId}」를 근거로 완료 처리합니다.`);
            if (!ok) return;
        }

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("advance_task", {
            p_task_id: taskId,
            p_to_status: to,
            p_note: note && note.trim() ? note.trim() : null,
            p_preauth_id: preauthId,
        });

        if (error || (data && data.ok === false)) {
            // 승인 강제(D18)에 걸린 경우도 여기로 옵니다 — 함수가 준 사유를
            // 그대로 보여줍니다. 무엇을 해야 하는지가 사유 안에 있습니다.
            window.alert(error ? error.message : (data.reason || "옮기지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }

        await Promise.all([refreshTasksSummary(), refreshTaskList()]);
        // 발송 승인 건은 위반·공문 화면의 배지가 이 업무의 상태를 비추므로
        // 같이 새로 그립니다 — 영역 전환은 다시 조회하지 않아(위 showArea
        // 원칙) 여기서 안 하면 옛 배지가 남습니다.
        if (moved?.kind === "notice_send") await refreshViolations();
        // POS 메뉴 화면도 이 업무의 상태를 비춥니다. 승인하면 실행 칸이
        // '실행 대기' 로 바뀌어야 하는데, 여기서 안 그리면 옛 상태가 남습니다.
        if (moved?.kind === "pos_soldout" || moved?.kind === "pos_menu_change") {
            await Promise.all([refreshPosMenu(), refreshPosMenuRequests(),
                               refreshPosMenuSummary()]);
        }
        // 공지 목록도 승인 상태를 비춥니다 (12번, 같은 원칙).
        if (moved?.kind === "announcement_send") await refreshAnnouncements();
        if (!$("task-events-panel").hidden
            && Number($("task-events-panel").dataset.taskId) === taskId) {
            await showTaskEvents(taskId, $("task-events-panel").dataset.taskTitle);
        }
    });
}

async function showTaskEvents(taskId, title) {
    const panel = $("task-events-panel");
    panel.hidden = false;
    panel.dataset.taskId = String(taskId);
    panel.dataset.taskTitle = title || "";
    $("task-events-title").textContent = `이력 — ${title || `#${taskId}`}`;

    const { data, error } = await db.rpc("api_task_events", { p_task_id: taskId });
    if (error) {
        $("t-task-events").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    if (!list.length) {
        $("t-task-events").innerHTML =
            '<p class="hint">접수 이후 아직 상태가 바뀌지 않았습니다.</p>';
        return;
    }

    table($("t-task-events"),
        ["시각", "전이", "승인 근거", "메모"],
        list.map((e) => [
            String(e.created_at).slice(0, 16).replace("T", " "),
            `${TASK_STATUS_LABEL[e.from] || e.from} → ${TASK_STATUS_LABEL[e.to] || e.to}`,
            e.approval_kind === "preauthorized"
                ? `사전 고지: ${e.preauth_scope || `#${e.preauth_id}`}`
                : (e.approval_kind === "manual" ? "승인 대기를 거침" : "—"),
            e.note || "—",
        ]));
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submitTask() {
    const notice = $("tk-notice");
    const button = $("tk-submit");
    const title = $("tk-title").value.trim();

    if (!title) {
        notice.className = "notice error";
        notice.textContent = "제목은 필수입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "접수하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const storeId = $("tk-store").value;
    const { error } = await db.from("tasks").insert({
        kind: $("tk-kind").value,
        title,
        body: $("tk-body").value.trim() || null,
        store_id: storeId ? Number(storeId) : null,
        source: $("tk-source").value,
        assigned_to: $("tk-assigned").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "접수하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "접수했습니다.";
    $("tk-title").value = "";
    $("tk-body").value = "";
    await Promise.all([refreshTasksSummary(), refreshTaskList()]);
}

// 고지는 건수가 적어(담당자가 직접 남기는 문장) jsonb 조회 함수를 따로 두지
// 않고 표를 그대로 읽습니다. RLS 는 읽기 허용, 철회는 함수로만입니다.
async function refreshPreauths() {
    const { data, error } = await db.from("task_preauthorizations")
        .select("id,kind,scope,note,created_at,revoked_at").order("id").limit(50);
    if (error) {
        $("t-preauths").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    taskPreauths = (Array.isArray(data) ? data : [])
        .slice().sort((a, b) => b.id - a.id);

    const alive = taskPreauths.filter((p) => !p.revoked_at).length;
    $("preauth-summary").textContent = `사용 중 ${int(alive)}건 · 전체 ${int(taskPreauths.length)}건`;

    if (!taskPreauths.length) {
        $("t-preauths").innerHTML =
            '<p class="hint">등록된 고지가 없습니다. 지금은 승인이 필요한 업무가 모두 승인 대기를 거칩니다.</p>';
        return;
    }

    const kindName = (kind) =>
        kind ? (taskKinds.find((k) => k.kind === kind)?.name || kind) : "종류 무관";

    table($("t-preauths"),
        ["범위", "적용 종류", "고지 원문", "등록", "상태"],
        taskPreauths.map((p) => [
            escape(p.scope),
            escape(kindName(p.kind)),
            escape(p.note || "—"),
            escape(String(p.created_at).slice(0, 10)),
            p.revoked_at
                ? `<span class="tag">철회됨 ${escape(String(p.revoked_at).slice(0, 10))}</span>`
                : '<span class="tag up">사용 중</span> '
                  + `<button class="ghost" data-act="revoke-preauth" data-preauth-id="${p.id}">철회</button>`,
        ]),
        { html: true });
}

function initPreauthActions() {
    $("t-preauths").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='revoke-preauth']");
        if (!button) return;

        const preauthId = Number(button.dataset.preauthId);
        const ok = window.confirm(
            "이 고지를 철회하면 해당 업무는 다시 승인 대기를 거칩니다. 철회할까요?");
        if (!ok) return;

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("revoke_task_preauthorization",
            { p_preauth_id: preauthId });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "철회하지 못했습니다"));
            button.disabled = false;
            button.textContent = "철회";
            return;
        }

        // 철회하면 '고지로 완료' 버튼이 사라져야 하므로 목록도 다시 그립니다.
        await refreshPreauths();
        drawTaskList();
    });
}

async function submitPreauth() {
    const notice = $("pa-notice");
    const button = $("pa-submit");
    const scope = $("pa-scope").value.trim();

    if (!scope) {
        notice.className = "notice error";
        notice.textContent = "승인 범위는 필수입니다 — 무엇이 승인됐는지 한 줄로 적어 주세요.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "등록하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("task_preauthorizations").insert({
        kind: $("pa-kind").value || null,
        scope,
        note: $("pa-note").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "등록하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "등록했습니다.";
    $("pa-scope").value = "";
    $("pa-note").value = "";
    await refreshPreauths();
    drawTaskList();
}

// ================================================================ AI 1차 응대 (1번 영역)
//
// 38_inquiry_answers.sql · tools/answer_inquiry.py 가 짝입니다.
//
// [왜 이관된 건도 보여주는가]
//   이관은 "아무 일도 안 일어난 것" 이 아니라 AI 가 내린 판정입니다. 어느 규칙이
//   왜 넘겼는지를 사람이 봐야 규칙을 고칠 수 있습니다. 다만 매일 볼 것은
//   아니라 기본값은 숨김입니다.
//
// [왜 근거를 같이 보여주는가]
//   답이 틀렸을 때 매뉴얼이 틀린 건지 모델이 지어낸 건지 갈라야 합니다.
//   cs-manual.md 는 PPTX 에서 뽑아 제목이 '슬라이드 6' 이라 뜻이 없어서
//   생성기가 발췌(excerpt)를 같이 남깁니다.

let inquiryRows = [];

async function initInquiries() {
    $("iq-filter").addEventListener("change", refreshInquiries);
    $("iq-hide-escalated").addEventListener("change", drawInquiries);
    initInquiryActions();
    await refreshInquiries();
}

async function refreshInquiries() {
    const status = $("iq-filter").value;
    const { data, error } = await db.rpc("api_inquiry_answers", {
        p_status: status || null,
        p_routing: null,
        p_limit: 100,
    });
    if (error) {
        inquiryRows = [];
        $("iq-list").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    inquiryRows = Array.isArray(data) ? data : [];
    drawInquiries();
    refreshInquirySummary();
}

async function refreshInquirySummary() {
    const { data, error } = await db.rpc("api_inquiry_answer_summary");
    if (error) return;
    const rate = data.answer_rate;
    $("inquiry-summary").textContent =
        `검토 대기 ${int(data.pending)}건 · 이관 ${int(data.escalated)}건`
        + (rate == null ? "" : ` · 자동 응대율 ${rate}%`);

    // 홈 '오늘 할 일' 타일. 같은 숫자를 두 번 묻지 않으려고 여기서 채웁니다
    // (미처리 업무 타일이 refreshTasksSummary 에서 채워지는 것과 같은 방식).
    const homeInquiry = $("home-inquiry");
    if (homeInquiry) homeInquiry.textContent = int(data.pending);
}

function drawInquiries() {
    const hideEscalated = $("iq-hide-escalated").checked;
    const rows = inquiryRows.filter((r) => !hideEscalated || r.routing !== "escalate");

    $("iq-shown").textContent = rows.length === inquiryRows.length
        ? `${int(rows.length)}건`
        : `전체 ${int(inquiryRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("iq-list").innerHTML =
            '<p class="hint">해당하는 1차 응대가 없습니다. 문의가 접수되면 '
            + '<code>tools/answer_inquiry.py</code> 가 초안을 만듭니다.</p>';
        return;
    }

    $("iq-list").innerHTML = rows.map(inquiryBlock).join("");
}

const INQUIRY_STATUS_LABEL = {
    draft: "검토 대기", approved: "승인됨", rejected: "반려", sent: "발송됨",
};

function inquiryBlock(r) {
    const escalated = r.routing === "escalate";
    const tag = escalated
        ? '<span class="tag h-warn">이관</span>'
        : `<span class="tag${r.status === "approved" || r.status === "sent" ? " up" : ""}">`
          + `${escape(INQUIRY_STATUS_LABEL[r.status] || r.status)}</span>`;

    const head = `<div class="iq-head">${tag}`
        + `<b>${escape(r.task_title)}</b>`
        + `<span class="meta">${escape(r.store_name || "매장 무관")} · `
        + `${escape(TASK_SOURCE_LABEL[r.source] || r.source)} · `
        + `${escape(String(r.received_at).slice(0, 10))}</span></div>`;

    const body = r.task_body
        ? `<p class="iq-quote">${escape(r.task_body)}</p>` : "";

    if (escalated) {
        return `<article class="iq" data-answer-id="${r.answer_id}">${head}${body}`
            + `<p class="hint">규칙 「${escape(r.rule_category || "판단 불가")}」에 걸려 `
            + `답변을 만들지 않았습니다. 넘길 곳: `
            + `<b>${escape(r.escalate_to || "담당 SV")}</b></p></article>`;
    }

    const sources = (r.sources || []).map((s) =>
        `<li><b>${escape(s.doc)}</b> · ${escape(s.heading)}`
        + (s.excerpt ? `<br><span class="meta">${escape(s.excerpt)}</span>` : "")
        + `</li>`).join("");

    const editable = r.status === "draft" || r.status === "approved";
    const buttons = r.status === "draft"
        ? `<button data-act="iq-approve" data-answer-id="${r.answer_id}">승인</button>`
          + ` <button class="ghost" data-act="iq-save" data-answer-id="${r.answer_id}">고친 내용 저장</button>`
          + ` <button class="ghost" data-act="iq-reject" data-answer-id="${r.answer_id}">반려</button>`
        : (r.status === "approved"
            ? `<button class="ghost" data-act="iq-save" data-answer-id="${r.answer_id}">고친 내용 저장</button>`
              + ` <button class="ghost" data-act="iq-reject" data-answer-id="${r.answer_id}">반려</button>`
            : "");

    return `<article class="iq" data-answer-id="${r.answer_id}">`
        + head + body
        + `<textarea class="iq-text" data-answer-id="${r.answer_id}" rows="5"`
        + `${editable ? "" : " readonly"}>${escape(r.contents || "")}</textarea>`
        + (sources ? `<details class="iq-sources"><summary>근거 ${(r.sources || []).length}건</summary>`
                     + `<ul>${sources}</ul></details>` : "")
        + (r.reject_reason
            ? `<p class="hint">반려 사유: ${escape(r.reject_reason)}</p>` : "")
        + `<div class="iq-actions">${buttons}<span class="meta">`
        + `${escape(r.model || "")}</span></div></article>`;
}

function initInquiryActions() {
    $("iq-list").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-answer-id]");
        if (!button) return;

        const answerId = Number(button.dataset.answerId);
        const act = button.dataset.act;
        const label = button.textContent;

        let call, payload;
        if (act === "iq-approve") {
            call = "approve_inquiry_answer";
            payload = { p_answer_id: answerId };
        } else if (act === "iq-reject") {
            const reason = window.prompt("반려 사유를 적어 주세요.", "");
            if (reason === null) return;
            call = "reject_inquiry_answer";
            payload = { p_answer_id: answerId, p_reason: reason };
        } else if (act === "iq-save") {
            const box = document.querySelector(`textarea.iq-text[data-answer-id="${answerId}"]`);
            call = "edit_inquiry_answer";
            payload = { p_answer_id: answerId, p_contents: box ? box.value : "" };
        } else {
            return;
        }

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc(call, payload);
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "처리하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }
        await refreshInquiries();
    });
}

// ---- 정산 · 로열티 (3번 영역, 41_settlement.sql) --------------------------
//
// 청구는 매출(agg_month)로 계산한 예상치(source=computed)이고, 본사 청구·입금
// 원자료가 반입되면 그 값(source=hq)이 우선합니다. 판정·검증 규칙은 전부
// 서버 함수에 있고 화면은 받은 값을 그리기만 합니다(조회는 jsonb 한 줄, D10).
// 이 화면의 월 선택은 위 공통 필터(기간·매장)와 별개입니다 — 정산은 언제나
// '한 달' 단위라 기간(부터~까지) 필터가 뜻이 없습니다.

// 청구 출처(computed/hq)와 입금 출처(web/hq)를 같이 씁니다.
const SETTLE_SOURCE_LABEL = { computed: "매출 계산", hq: "본사 자료", web: "웹 입력" };

let stRows = [];   // api_royalty_month 의 stores. 입금 내역 패널이 다시 씁니다.

function initSettlement() {
    const sel = $("st-ym");
    const months = filterRange ? monthsBetween(filterRange.min, filterRange.max) : [];
    for (const ym of [...months].reverse()) {
        const option = document.createElement("option");
        option.value = String(ym);
        option.textContent = ymLabel(ym);
        sel.append(option);
    }
    if (months.length) sel.value = String(months[months.length - 1]);

    $("pay-date").value = new Date().toISOString().slice(0, 10);

    sel.addEventListener("change", refreshSettlementMonth);
    $("st-generate").addEventListener("click", generateInvoices);
    $("pay-submit").addEventListener("click", submitPayment);
    initSettlementActions();

    Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

function settleYm() { return Number($("st-ym").value) || null; }

function settleStatusTag(status) {
    const label = escape(status);
    if (status === "미수") return `<span class="tag warn">${label}</span>`;
    if (status === "완납") return `<span class="tag up">${label}</span>`;
    if (status === "미청구") return `<span class="tag h-warn">${label}</span>`;
    return `<span class="tag">${label}</span>`;
}

async function refreshSettlementMonth() {
    $("settlement-payments-panel").hidden = true;
    const ym = settleYm();
    if (!ym) return;

    const { data, error } = await db.rpc("api_royalty_month", { p_ym: ym });
    if (error) {
        stRows = [];
        $("t-settlement").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    stRows = d.stores || [];
    const t = d.totals || {};

    $("st-month-meta").textContent =
        `요율 ${d.rate_pct}% · 납기 ${d.due_date || "—"} — 본사가 정합니다`;
    $("st-outstanding").textContent = won(t.outstanding) + "원";
    $("st-outstanding-sub").textContent = `미수 매장 ${int(t.overdue_stores)}곳`;
    $("st-billed").textContent = won(t.billed) + "원";
    $("st-billed-sub").textContent = `청구 ${int(t.billed_stores)}곳`;
    $("st-paid").textContent = won(t.paid) + "원";
    $("st-unbilled").textContent = int(t.unbilled_stores);

    // 입금 폼의 매장 목록 = 이 달 청구가 있는 매장. 선택은 유지합니다.
    const paySelect = $("pay-invoice");
    const keep = paySelect.value;
    paySelect.innerHTML = "";
    for (const s of stRows.filter((r) => r.invoice_id != null)) {
        const option = document.createElement("option");
        option.value = String(s.invoice_id);
        option.textContent = `${s.store} · ${ymLabel(ym)}`;
        paySelect.append(option);
    }
    if (keep && [...paySelect.options].some((o) => o.value === keep)) {
        paySelect.value = keep;
    }

    if (!stRows.length) {
        $("t-settlement").innerHTML =
            '<p class="hint">이 달에는 매출도 청구도 없습니다. 다른 달을 골라 보세요.</p>';
        return;
    }

    table($("t-settlement"),
        ["상태", "매장", "매출액", "청구액", "출처", "입금", "미수", "납기", "처리"],
        stRows.map((s) => [
            settleStatusTag(s.status),
            escape(s.store)
                + (s.trade_area ? `<div class="meta">${escape(s.trade_area)}</div>` : ""),
            s.sales_amount != null ? wonFull(s.sales_amount) : "—",
            s.invoice_id != null
                ? wonFull(s.billed_amount)
                    + `<div class="meta">요율 ${escape(String(s.rate_pct))}%</div>`
                // 생성 전 미리보기 — 서버와 같은 규칙(round(매출×요율/100))입니다.
                : `<span class="meta">예상 ${wonFull(Math.round((s.sales_amount || 0) * (d.rate_pct || 0) / 100))}</span>`,
            s.source ? escape(SETTLE_SOURCE_LABEL[s.source] || s.source) : "—",
            wonFull(s.paid_amount)
                + (s.payments && s.payments.length
                    ? `<div class="meta">${int(s.payments.length)}건</div>` : ""),
            s.outstanding == null ? "—"
                : s.outstanding < 0
                    ? `${wonFull(s.outstanding)} <span class="tag h-warn">과입금</span>`
                    : wonFull(s.outstanding)
                        + (s.overdue_days > 0 && s.outstanding > 0
                            ? `<div class="meta">연체 ${int(s.overdue_days)}일</div>` : ""),
            s.due_date ? escape(s.due_date) : "—",
            s.invoice_id != null
                ? `<button class="ghost" data-act="pay-prefill" data-invoice-id="${s.invoice_id}">입금</button>`
                    + (s.payments && s.payments.length
                        ? ` <button class="ghost" data-act="pay-history" data-invoice-id="${s.invoice_id}">내역</button>`
                        : "")
                : "—",
        ]),
        { html: true });
}

async function generateInvoices() {
    const ym = settleYm();
    if (!ym) return;
    const button = $("st-generate");
    const msg = $("st-generate-msg");
    button.disabled = true;
    msg.textContent = "계산 중…";

    const { data, error } = await db.rpc("generate_royalty_invoices", { p_ym: ym });

    button.disabled = false;
    if (error || (data && data.ok === false)) {
        msg.textContent = error ? error.message : (data.reason || "생성하지 못했습니다");
        return;
    }
    msg.textContent = `매장 ${int(data.stores)}곳 · ${int(data.written)}건 반영`
        + (data.hq_kept ? ` · 본사 자료 ${int(data.hq_kept)}건 유지` : "");
    await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

async function submitPayment() {
    const notice = $("pay-notice");
    const button = $("pay-submit");
    const invoiceId = Number($("pay-invoice").value);
    const amount = Number($("pay-amount").value);

    if (!invoiceId) {
        notice.className = "notice error";
        notice.textContent = "매장을 고르세요. 청구가 없는 달이면 먼저 '청구 생성·갱신'을 누르세요.";
        return;
    }
    if (!$("pay-date").value) {
        notice.className = "notice error";
        notice.textContent = "입금일을 입력하세요.";
        return;
    }
    if (!amount || amount <= 0) {
        notice.className = "notice error";
        notice.textContent = "금액은 0보다 커야 합니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "기록하는 중…";

    const { data, error } = await db.rpc("record_royalty_payment", {
        p_invoice_id: invoiceId,
        p_paid_on: $("pay-date").value,
        p_amount: amount,
        p_note: $("pay-note").value.trim() || null,
    });

    button.disabled = false;
    if (error || (data && data.ok === false)) {
        notice.className = "notice error";
        notice.textContent = error ? error.message : (data.reason || "기록하지 못했습니다");
        return;
    }

    notice.className = "notice";
    notice.textContent = data.outstanding > 0
        ? `기록했습니다. 남은 미수 ${wonFull(data.outstanding)}.`
        : data.outstanding < 0
            ? `기록했습니다. ${wonFull(-data.outstanding)} 과입금 상태입니다.`
            : "기록했습니다. 완납됐습니다.";
    $("pay-amount").value = "";
    $("pay-note").value = "";
    await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

function showSettlementPayments(invoiceId) {
    const row = stRows.find((s) => s.invoice_id === invoiceId);
    if (!row) return;
    const panel = $("settlement-payments-panel");
    panel.hidden = false;
    panel.dataset.invoiceId = String(invoiceId);
    $("settlement-payments-title").textContent =
        `입금 내역 — ${row.store} · ${ymLabel(settleYm())}`;

    const list = row.payments || [];
    if (!list.length) {
        $("t-settlement-payments").innerHTML =
            '<p class="hint">아직 입금 기록이 없습니다.</p>';
        return;
    }
    table($("t-settlement-payments"),
        ["입금일", "금액", "메모", "출처", "상태"],
        list.map((p) => [
            escape(p.paid_on),
            wonFull(p.amount),
            escape(p.note || "—"),
            escape(SETTLE_SOURCE_LABEL[p.source] || p.source || "—"),
            p.canceled
                ? '<span class="tag">취소됨</span>'
                : `<button class="ghost" data-act="cancel-payment" data-payment-id="${p.payment_id}">취소</button>`,
        ]),
        { html: true });
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function initSettlementActions() {
    $("t-settlement").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;
        const invoiceId = Number(button.dataset.invoiceId);
        if (button.dataset.act === "pay-prefill") {
            $("pay-invoice").value = String(invoiceId);
            $("pay-amount").focus();
            $("settlement-payment-card").scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (button.dataset.act === "pay-history") {
            showSettlementPayments(invoiceId);
        }
    });

    $("t-settlement-payments").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='cancel-payment']");
        if (!button) return;
        const ok = window.confirm("이 입금 기록을 취소할까요? 기록은 취소 표시로 남습니다.");
        if (!ok) return;

        button.disabled = true;
        const { data, error } = await db.rpc("cancel_royalty_payment",
            { p_payment_id: Number(button.dataset.paymentId) });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "취소하지 못했습니다"));
            button.disabled = false;
            return;
        }
        const invoiceId = Number($("settlement-payments-panel").dataset.invoiceId);
        await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
        showSettlementPayments(invoiceId);
    });

    $("t-receivables").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='request-notice']");
        if (!button) return;
        const ok = window.confirm(
            `${button.dataset.store} · ${ymLabel(Number(button.dataset.ym))}분 미수 `
            + `${wonFull(Number(button.dataset.outstanding))}의 안내 발송을 승인 대기로 올립니다.`);
        if (!ok) return;

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("request_receivable_notice",
            { p_invoice_id: Number(button.dataset.invoiceId) });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }
        // 업무 영역의 승인 대기 숫자가 이 요청을 비추므로 같이 새로 그립니다
        // (advance_task 뒤 refreshViolations 를 부르는 것과 같은 이유).
        await Promise.all([refreshReceivables(), refreshTasksSummary(), refreshTaskList()]);
    });
}

async function refreshReceivables() {
    const { data, error } = await db.rpc("api_royalty_receivables");
    if (error) {
        $("t-receivables").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    const items = d.items || [];
    const totals = d.totals || {};

    $("st-recv-meta").textContent = items.length
        ? `${int(totals.count)}건 · ${wonFull(totals.outstanding)}`
        : "";

    if (!items.length) {
        $("t-receivables").innerHTML = '<p class="hint">미수가 없습니다.</p>';
        return;
    }

    table($("t-receivables"),
        ["매장", "연월", "청구액", "입금", "미수", "납기", "연체", "지연이자(참고)", "발송 승인"],
        items.map((r) => [
            escape(r.store),
            ymLabel(r.ym),
            wonFull(r.amount),
            wonFull(r.paid_amount),
            wonFull(r.outstanding),
            escape(r.due_date),
            `<span class="tag warn">${int(r.overdue_days)}일</span>`,
            r.late_interest_est == null ? "—"
                : wonFull(r.late_interest_est)
                    + `<div class="meta">연 ${escape(String(d.late_interest_pct_year))}%</div>`,
            r.notice_task_id
                ? taskStatusTag(r.notice_task_status)
                    + `<div class="meta">업무 #${int(r.notice_task_id)}</div>`
                : `<button class="ghost" data-act="request-notice"`
                    + ` data-invoice-id="${r.invoice_id}" data-store="${escape(r.store)}"`
                    + ` data-ym="${r.ym}" data-outstanding="${r.outstanding}">발송 승인 요청</button>`,
        ]),
        { html: true });
}

// api_filters 가 준 데이터 범위(최소/최대 연월). initExport 기본값에 씁니다.
let filterRange = null;

boot();


// ---- 업무 영역 전환 -----------------------------------------------------
//
// 카드를 계속 아래로 붙이면 화면 하나가 끝없이 길어집니다. 앞으로 업무 영역이
// 11개로 늘어나므로 왼쪽 메뉴로 갈라 놓습니다.
//
// 데이터는 이미 다 받아 둔 것을 쓰고 보이기만 바꿉니다 — 영역을 옮길 때마다
// 다시 조회하면 지금도 느린 화면이 더 느려집니다.
// 필터(기간·매장)는 매출 영역에서만 뜻이 있어 다른 영역에서는 숨깁니다.

const AREA_KEY = "mitaly.area";

// 매출 안의 두 번째 단. 같은 방식으로 보이기만 바꿉니다.
let salesSub = "요약";

// load() 차례표. 늦게 끝난 옛 조회를 버리는 데 씁니다.
let loadSeq = 0;

function showSalesSub(sub) {
    salesSub = sub;
    for (const el of document.querySelectorAll('[data-area="sales"][data-sub]')) {
        el.hidden = el.dataset.sub !== sub;
    }
    for (const b of document.querySelectorAll(".subitem")) {
        b.classList.toggle("is-on", b.dataset.subGo === sub);
        b.setAttribute("aria-current", b.dataset.subGo === sub ? "true" : "false");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
}

function showArea(area) {
    // 매장 정보에서 나가면 암호를 버립니다(위 credLock 주석 참조).
    if (area !== "stores" && typeof credPass !== "undefined" && credPass) credLock();
    if (area !== "stores" && typeof ctPass !== "undefined" && ctPass) ctLock();

    for (const el of document.querySelectorAll("[data-area]")) {
        el.hidden = el.dataset.area !== area;
    }
    for (const b of document.querySelectorAll(".navitem")) {
        b.classList.toggle("is-on", b.dataset.go === area);
        b.setAttribute("aria-current", b.dataset.go === area ? "page" : "false");
    }
    if (area === "sales") showSalesSub(salesSub);

    const salesOnly = area === "sales";
    // 홈 화면의 타일도 위 필터(기간·매장)를 따르므로 필터 줄은 같이 보여줍니다.
    // 리뷰 카드(api_review_summary)도 같은 f-from/f-to/f-store 를 그대로 쓰므로
    // 리뷰 영역에서도 필터 줄이 필요합니다.
    // 맨 위 매출 4칸(총매출 등)은 매출 화면에서만 뜻이 있어 그대로 숨깁니다.
    const filters = document.querySelector(".filters");
    const tiles = $("sales-kpis");
    if (filters) filters.hidden = !(salesOnly || area === "home" || area === "reviews");
    if (tiles) tiles.hidden = !salesOnly;
    try { localStorage.setItem(AREA_KEY, area); } catch (e) { /* 사생활 모드 */ }
    window.scrollTo({ top: 0, behavior: "instant" });
}

function initAreas() {
    for (const b of document.querySelectorAll(".subitem")) {
        b.addEventListener("click", () => showSalesSub(b.dataset.subGo));
    }
    for (const b of document.querySelectorAll(".navitem")) {
        b.addEventListener("click", () => showArea(b.dataset.go));
    }
    let saved = "home";
    try { saved = localStorage.getItem(AREA_KEY) || "home"; } catch (e) { /* 무시 */ }
    // 저장된 값이 지금 없는 영역일 수 있습니다(영역 이름이 바뀐 뒤).
    if (!document.querySelector(`.navitem[data-go="${saved}"]`)) saved = "home";
    showArea(saved);
}

// 홈 화면의 할 일 타일 → 관련 카드로 이동. 답글·부정 리뷰 타일은 리뷰
// 영역(review-card), 급감 매장 타일은 매출 영역(alerts-card)을 가리킵니다
// — 어느 영역으로 이동할지는 각 타일의 data-go-target(index.html)이 정합니다.
// 필터를 바꿀 때는 그 필터가 이미 쓰고 있는 이벤트를 그대로 흉내 냅니다
// (rv-rating 은 change 시 서버에 다시 묻고, alerts-only 는 이미 받아 둔
// 데이터를 다시 그리기만 합니다) — 홈 화면이 그 규칙을 새로 만들지 않습니다.
function initHomeTiles() {
    const targets = {
        "home-tile-tasks": "task-list-card",
        "home-tile-inquiry": "inquiry-card",
        "home-tile-drafts": "review-card",
        "home-tile-negative": "review-card",
        "home-tile-declining": "alerts-card",
    };
    for (const [tileId, cardId] of Object.entries(targets)) {
        const tile = document.getElementById(tileId);
        if (!tile) continue;
        tile.addEventListener("click", () => {
            showArea(tile.dataset.goTarget || "sales");
            if (tileId === "home-tile-negative") {
                $("rv-rating").value = "low";
                $("rv-rating").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-declining") {
                $("alerts-only").checked = true;
                $("alerts-only").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-tasks") {
                $("tk-filter-overdue").checked = true;
                $("tk-filter-overdue").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-inquiry") {
                $("iq-filter").value = "draft";
                $("iq-filter").dispatchEvent(new Event("change"));
            }
            requestAnimationFrame(() => {
                document.getElementById(cardId)?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }
}


// ---- 배달 지도 (6번 영역, QUEUE #55 · docs/dong-map-design.md) -------------
//
// 동 단위 주문 분포를 카카오맵 위에 색으로 얹는 화면입니다. 데이터 축(수집
// 확장 — 주문 상세의 동 추출)이 아직 없어, 지금은
//   · 데모 모드: 샘플 동 폴리곤이 그려지는지 확인
//   · 실모드: '수집 전' 안내
// 까지입니다. SDK 는 화면에 처음 들어올 때 한 번만 로드합니다 — 숨겨진
// 컨테이너에 지도를 만들면 크기를 못 잡기 때문에(카카오맵 특성) 게으르게 합니다.

let dmapStarted = false;

function initDeliveryMap() {
    for (const b of document.querySelectorAll('.navitem[data-go="map"]')) {
        b.addEventListener("click", () => setTimeout(loadDeliveryMap, 80));
    }
}

async function loadDeliveryMap() {
    if (dmapStarted) return;
    const key = (window.MITALY_CONFIG || {}).kakaoMapKey || "";
    const notice = $("dmap-notice");
    if (!key) {
        notice.textContent = "카카오맵 JS 키가 아직 없습니다 — config.js 의 "
            + "kakaoMapKey 가 채워지면 이 자리에 지도가 뜹니다.";
        return;
    }
    dmapStarted = true;
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey="
                + encodeURIComponent(key) + "&autoload=false";
            script.onload = resolve;
            script.onerror = () => reject(new Error(
                "SDK 를 불러오지 못했습니다 — 카카오 개발자 콘솔의 JS 키 도메인 "
                + "등록(현재 주소 포함)을 확인하세요"));
            document.head.append(script);
        });
        await new Promise((resolve) => kakao.maps.load(resolve));
    } catch (exc) {
        dmapStarted = false;           // 도메인 등록 뒤 다시 들어오면 재시도
        notice.textContent = String(exc.message || exc);
        return;
    }

    const map = new kakao.maps.Map($("dmap-container"), {
        center: new kakao.maps.LatLng(37.5665, 126.978),   // 서울 시청
        level: 8,
    });
    drawDongOverlays(map);
}

function drawDongOverlays(map) {
    // 실데이터 API 는 수집 확장(동단위 세션, SQL 54) 뒤에 붙습니다.
    // 그전까지는 데모 픽스처(window.DEMO_DONG_MAP)만 그립니다.
    const rows = window.DEMO_DONG_MAP || [];
    if (!rows.length) {
        $("dmap-notice").textContent =
            "아직 동 단위 데이터가 없습니다 — 주문 상세의 동 추출(수집 확장)이 "
            + "끝나면 이 지도가 채워집니다.";
        return;
    }
    const top = Math.max(...rows.map((r) => r.orders));
    const bounds = new kakao.maps.LatLngBounds();
    for (const r of rows) {
        const path = r.path.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
        for (const point of path) bounds.extend(point);
        const polygon = new kakao.maps.Polygon({
            path,
            strokeWeight: 1.5, strokeColor: "#686cff", strokeOpacity: 0.85,
            fillColor: "#686cff", fillOpacity: 0.12 + 0.5 * (r.orders / top),
        });
        polygon.setMap(map);
        kakao.maps.event.addListener(polygon, "click", () => {
            $("dmap-meta").textContent =
                `${r.name} · 주문 ${int(r.orders)}건 · 배달비 평균 ${int(r.delivery_fee)}원`;
        });
    }
    map.setBounds(bounds);
    $("dmap-meta").textContent =
        `데모 ${int(rows.length)}개 동 — 동을 눌러 보세요 (실데이터는 수집 확장 후)`;
}


// ---- 공지 (12번 영역, 53_announcements.sql) --------------------------------
//
// 자리는 카카오 채널이고(docs/area12-comms.md) 웹은 작성·승인·이력만 봅니다.
// 발송은 수집 PC 도구(tools/send_announcements.py)의 일 — 발송 이력 카드와
// 같은 역할 분담입니다. 대상 미리 세기는 가맹점DB(api_store_profiles)의
// 지역·SV 를 씁니다.

let anStores = [];     // {id, name}
let anProfiles = [];   // {store_id, region, sv_name, ...}

async function initComms() {
    const { data: stores } = await db.from("stores").select("id,name").order("name");
    anStores = stores || [];
    for (const s of anStores) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        $("an-stores").append(opt);
    }
    const { data: profiles } = await db.rpc("api_store_profiles");
    anProfiles = Array.isArray(profiles) ? profiles : [];

    $("an-audience").addEventListener("change", onAnnouncementAudienceChange);
    $("an-value").addEventListener("change", drawAnnouncementTargetCount);
    $("an-stores").addEventListener("change", drawAnnouncementTargetCount);
    $("an-submit").addEventListener("click", submitAnnouncement);
    onAnnouncementAudienceChange();
    await refreshAnnouncements();
}

function onAnnouncementAudienceChange() {
    const kind = $("an-audience").value;
    $("an-value-field").hidden = kind !== "region" && kind !== "sv";
    $("an-stores-field").hidden = kind !== "stores";
    if (kind === "region" || kind === "sv") {
        const key = kind === "region" ? "region" : "sv_name";
        const values = [...new Set(anProfiles.map((p) => p[key]).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        $("an-value-label").textContent = kind === "region" ? "지역" : "담당 SV";
        $("an-value").innerHTML = "";
        for (const v of values) {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            $("an-value").append(opt);
        }
    }
    drawAnnouncementTargetCount();
}

// 미리 세는 숫자는 안내용입니다 — 확정은 서버(create_announcement)가 그
// 시점 스냅샷으로 다시 셉니다(53 설계 판단 [2]).
function drawAnnouncementTargetCount() {
    const kind = $("an-audience").value;
    let count = 0;
    if (kind === "all") count = anStores.length;
    else if (kind === "stores") count = $("an-stores").selectedOptions.length;
    else {
        const key = kind === "region" ? "region" : "sv_name";
        const value = $("an-value").value;
        count = anProfiles.filter((p) => p[key] === value).length;
    }
    $("an-target-count").textContent = count ? `대상 약 ${count}곳` : "대상 없음";
}

async function submitAnnouncement() {
    const kind = $("an-audience").value;
    const storeIds = [...$("an-stores").selectedOptions].map((o) => Number(o.value));
    const notice = $("an-notice");
    notice.textContent = "";

    const { data, error } = await db.rpc("create_announcement", {
        p_title: $("an-title").value,
        p_body: $("an-body").value,
        p_audience_kind: kind,
        p_audience_value: kind === "region" || kind === "sv" ? $("an-value").value : null,
        p_store_ids: kind === "stores" ? storeIds : null,
    });
    if (error) {
        notice.textContent = "접수하지 못했습니다: " + error.message;
        return;
    }
    if (!data?.ok) {
        notice.textContent = data?.reason || "접수하지 못했습니다.";
        return;
    }
    notice.textContent = `접수했습니다 — 대상 ${data.target_count}곳, `
        + `승인 대기 업무 #${data.task_id} 가 만들어졌습니다.`;
    $("an-title").value = "";
    $("an-body").value = "";
    await Promise.all([refreshAnnouncements(),
                       typeof refreshTaskList === "function" ? refreshTaskList() : null,
                       typeof refreshTasksSummary === "function" ? refreshTasksSummary() : null]);
}

const AN_AUDIENCE_LABEL = { all: "전체", region: "지역", sv: "담당 SV", stores: "선택 매장" };

async function refreshAnnouncements() {
    const { data, error } = await db.rpc("api_announcements", { p_limit: 100 });
    if (error) {
        $("t-announcements").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    $("comms-summary").textContent = rows.length ? `${int(rows.length)}건` : "";
    if (!rows.length) {
        $("t-announcements").innerHTML =
            '<p class="hint">아직 공지가 없습니다. 위 폼에서 접수하면 여기 나타납니다.</p>';
        return;
    }
    table($("t-announcements"),
        ["상태", "제목", "대상", "발송", "열람", "작성"],
        rows.map((a) => {
            const audience = AN_AUDIENCE_LABEL[a.audience_kind] || a.audience_kind;
            const sent = a.sent
                ? `발송 ${int(a.sent)}`
                : (a.dry_run ? `dry-run ${int(a.dry_run)}` : "—");
            return [
                taskStatusTag(a.task_status),
                escape(a.title)
                    + `<div class="meta">${escape(clip(a.body, 80))}</div>`,
                escape(audience + (a.audience_value ? ` ${a.audience_value}` : ""))
                    + `<div class="meta">${int(a.target_count)}곳</div>`,
                sent + (a.failed ? `<div class="meta">실패 ${int(a.failed)}</div>` : ""),
                a.reads ? int(a.reads) + "곳" : "—",
                escape(String(a.created_at).slice(0, 10))
                    + `<div class="meta">업무 #${int(a.task_id)}</div>`,
            ];
        }),
        { html: true });
}


// ---- 발송 이력 (31_notifications + 43_notify_dispatch) --------------------
//
// 발송 자체는 수집 PC 도구의 일이고(tools/alert_negative_reviews.py 등),
// 웹은 이력(api_notifications)만 봅니다 — notify.py 머리 주석의 역할 분담.
// 그래서 이 카드에는 버튼이 '업무 이력' 하나뿐입니다.

const NOTIFY_KIND_LABEL = {
    review_alert: "부정 리뷰",
    notice: "공문",
    store_close: "폐점 계정",
    announcement: "공지",
    report: "보고서",
    test: "시험",
};
const NOTIFY_CHANNEL_LABEL = {
    mail: "메일", alimtalk: "알림톡", sms: "문자", cafe24: "카페24", webhook: "웹훅",
};
const NOTIFY_STATUS_TAG = {
    sent: '<span class="tag up">발송됨</span>',
    dry_run: '<span class="tag">dry-run</span>',
    failed: '<span class="tag warn">실패</span>',
};

let notifyRows = [];

async function refreshNotifications() {
    const { data, error } = await db.rpc("api_notifications", { p_limit: 200 });
    if (error) {
        $("t-notifications").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    notifyRows = Array.isArray(data) ? data : [];
    drawNotifications();
}

function drawNotifications() {
    const kind = $("nf-filter-kind").value;
    const rows = notifyRows.filter((n) => !kind || n.kind === kind);

    $("nf-summary").textContent = `${int(notifyRows.length)}건`;
    $("nf-shown").textContent = rows.length === notifyRows.length
        ? "" : `전체 ${int(notifyRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("t-notifications").innerHTML =
            '<p class="hint">발송 이력이 없습니다. 수집 PC 도구가 보내면 여기 쌓입니다.</p>';
        return;
    }

    table($("t-notifications"),
        ["시각", "종류", "채널", "받는 곳", "제목", "상태", "업무"],
        rows.map((n) => [
            escape(String(n.created_at).replace("T", " ").slice(0, 16)),
            escape(NOTIFY_KIND_LABEL[n.kind] || n.kind || "—"),
            escape(NOTIFY_CHANNEL_LABEL[n.channel] || n.channel),
            escape(n.recipient),
            escape(clip(n.subject || "(제목 없음)", 40))
                + (n.error && n.status === "failed"
                    ? `<div class="meta">${escape(clip(n.error, 60))}</div>` : ""),
            NOTIFY_STATUS_TAG[n.status] || escape(n.status),
            n.task_id
                ? `<button class="ghost" data-act="task-events" data-task-id="${n.task_id}"`
                  + ` data-task-title="업무 #${n.task_id}">이력</button>`
                : "—",
        ]),
        { html: true });
}

function initNotifications() {
    $("nf-filter-kind").addEventListener("change", drawNotifications);
    // '업무' 열의 이력 버튼 — 업무 목록 카드의 이력 패널(showTaskEvents)을
    // 그대로 씁니다. 위임 대상 컨테이너가 달라 여기서 한 번 더 겁니다.
    $("t-notifications").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act='task-events']");
        if (button) {
            showTaskEvents(Number(button.dataset.taskId), button.dataset.taskTitle);
        }
    });
    refreshNotifications();
}


// ---- 매장 정보 · 배달앱 계정 ---------------------------------------------
//
// 29_store_credentials.sql 이 짝입니다. 이 화면만 2차 암호를 받습니다.
//
// [암호를 어디에 두는가]
//   화면이 살아 있는 동안 **메모리에만** 둡니다. localStorage 에 넣지 않습니다 —
//   그러면 브라우저를 닫아도 남아서 '자리 비울 때 잠긴다' 는 목적이 무너집니다.
//   탭을 옮기거나 새로 고치면 다시 받습니다.
//
// [비밀번호를 왜 가리는가]
//   담당자 요구(2026-07-30). 열람 기록은 남기지 않기로 했으므로, 최소한
//   화면에 그냥 떠 있지는 않게 합니다. 누르면 그 줄만 펼칩니다.

let credPass = null;          // 메모리 전용. 절대 저장하지 않습니다.
let credRows = [];

function credFail(message) {
    const box = $("cred-error");
    box.textContent = message;
    box.hidden = false;
}

async function credOpen() {
    const pass = $("cred-pass").value;
    if (!pass) return credFail("암호를 입력해 주세요.");
    $("cred-error").hidden = true;
    $("cred-open").disabled = true;
    try {
        let data, error;
        try {
            // 암호가 틀리면 함수가 예외를 던집니다. 그것이 { error } 로 오기도 하고
            // (Supabase) 그대로 throw 되기도 해서(데모·네트워크 오류) 둘 다 받습니다.
            // 이유를 안 보여 주면 사용자는 왜 안 열리는지 모릅니다.
            ({ data, error } = await db.rpc("api_store_credentials", { p_passcode: pass }));
        } catch (thrown) {
            return credFail(thrown.message || "열지 못했습니다.");
        }
        if (error) return credFail(error.message || "열지 못했습니다.");
        credPass = pass;
        credRows = ((data || [])[0] || {}).items || [];
        $("cred-pass").value = "";
        $("cred-gate").hidden = true;
        $("cred-body").hidden = false;
        $("cred-hint").textContent = `계정 ${credRows.length}건`;
        drawCredentials();
        await loadCredChanges();
    } finally {
        $("cred-open").disabled = false;
    }
}

function credLock() {
    credPass = null;
    credRows = [];
    $("cred-body").hidden = true;
    $("cred-gate").hidden = false;
    $("cred-hint").textContent = "";
    $("cred-table").innerHTML = "";
    $("cred-changes").innerHTML = "";
}

function drawCredentials() {
    const only = $("cred-store").value;
    const rows = only ? credRows.filter((r) => r.store === only) : credRows;
    if (!rows.length) {
        $("cred-table").innerHTML =
            '<p class="note">등록된 계정이 없습니다. 아래에서 추가하세요.</p>';
        return;
    }
    const body = rows.map((r, i) => `<tr>
        <td>${escape(r.store)}</td>
        <td>${escape(r.channel)}</td>
        <td>${escape(r.login_id)}</td>
        <td><button class="linkish cred-peek" data-i="${i}"
                    type="button">●●●●●● 보기</button>
            <span class="cred-pw" data-i="${i}" hidden>${escape(r.password || "(없음)")}</span></td>
        <td>${escape(r.note || "")}</td>
        <td>${escape((r.updated_at || "").slice(0, 10))} ${escape(r.updated_by || "")}</td>
    </tr>`).join("");
    $("cred-table").innerHTML = `<table><thead><tr>
        <th>매장</th><th>채널</th><th>아이디</th><th>비밀번호</th><th>메모</th><th>마지막 수정</th>
        </tr></thead><tbody>${body}</tbody></table>`;

    for (const b of $("cred-table").querySelectorAll(".cred-peek")) {
        b.addEventListener("click", () => {
            const span = $("cred-table")
                .querySelector(`.cred-pw[data-i="${b.dataset.i}"]`);
            span.hidden = !span.hidden;
            b.hidden = !span.hidden;
        });
    }
}

async function credSave() {
    if (!credPass) return;
    const msg = $("cred-save-msg");
    msg.hidden = true;
    const args = {
        p_passcode: credPass,
        p_store: $("cred-f-store").value,
        p_channel: $("cred-f-channel").value,
        p_login_id: $("cred-f-id").value.trim(),
        // 빈 칸이면 null 로 보냅니다 — 함수가 기존 비밀번호를 지우지 않습니다.
        p_password: $("cred-f-pw").value || null,
        p_note: $("cred-f-note").value.trim() || null,
    };
    if (!args.p_login_id) {
        msg.textContent = "아이디를 입력해 주세요.";
        msg.hidden = false;
        return;
    }
    $("cred-save").disabled = true;
    try {
        const { data, error } = await db.rpc("api_save_store_credential", args);
        msg.textContent = error
            ? (error.message || "저장하지 못했습니다.")
            : `저장했습니다 · ${args.p_store} ${args.p_channel}`;
        msg.hidden = false;
        if (!error) {
            $("cred-f-pw").value = "";
            // 저장한 값이 실제로 들어갔는지 다시 읽어 확인합니다.
            const re = await db.rpc("api_store_credentials", { p_passcode: credPass });
            credRows = ((re.data || [])[0] || {}).items || [];
            drawCredentials();
            await loadCredChanges();
        }
    } finally {
        $("cred-save").disabled = false;
    }
}

async function loadCredChanges() {
    const { data } = await db.from("store_credential_changes")
        .select("channel,changed_at,changed_by,what")
        .order("changed_at", { ascending: false }).limit(30);
    const rows = data || [];
    $("cred-changes").innerHTML = rows.length
        ? `<table><thead><tr><th>언제</th><th>채널</th><th>무엇</th><th>누가</th></tr></thead>
           <tbody>${rows.map((r) => `<tr>
             <td>${escape((r.changed_at || "").slice(0, 16).replace("T", " "))}</td>
             <td>${escape(r.channel)}</td><td>${escape(r.what)}</td>
             <td>${escape(r.changed_by || "")}</td></tr>`).join("")}</tbody></table>`
        : '<p class="note">아직 수정 이력이 없습니다.</p>';
}

function initCredentials(storeNames) {
    fillStoreSelect($("cred-store"), storeNames, "전체 매장");
    fillStoreSelect($("cred-f-store"), storeNames, null);
    $("cred-open").addEventListener("click", credOpen);
    $("cred-pass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") credOpen();
    });
    $("cred-lock").addEventListener("click", credLock);
    $("cred-store").addEventListener("change", drawCredentials);
    $("cred-save").addEventListener("click", credSave);
}

function fillStoreSelect(select, names, allLabel) {
    select.innerHTML = "";
    if (allLabel) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = allLabel;
        select.appendChild(o);
    }
    for (const name of names || []) {
        const o = document.createElement("option");
        o.value = name; o.textContent = name;
        select.appendChild(o);
    }
}

// ---- 점주 연락처·계약 (44_store_contacts, QUEUE #56) --------------------
//
// 배달앱 계정(credentials)과 같은 2차 암호 게이트를 씁니다. 암호는 메모리에만
// 두고, 매장 정보 영역을 떠나면 잠급니다(showArea 참조). 대량 반입은 수집 PC
// 도구(import_store_db --contacts)가 하고 이 화면은 열람 + 한 매장씩 수정.

let ctPass = null;            // 메모리 전용. 절대 저장하지 않습니다.
let ctRows = [];

function ctFail(message) {
    const box = $("ct-error");
    box.textContent = message;
    box.hidden = false;
}

async function ctSummary() {
    const { data } = await db.rpc("api_store_contacts_summary", {});
    if (data && typeof data.stores_with_contacts === "number") {
        $("ct-summary").textContent = data.stores_with_contacts
            ? `${int(data.stores_with_contacts)}개 매장 등록 · 마지막 반입 `
              + (String(data.last_imported_at || "").slice(0, 10) || "—")
            : "등록된 연락처 없음";
    }
}

async function ctOpen() {
    const pass = $("ct-pass").value;
    if (!pass) return ctFail("암호를 입력해 주세요.");
    $("ct-error").hidden = true;
    $("ct-open").disabled = true;
    try {
        let data, error;
        try {
            ({ data, error } = await db.rpc("api_store_contacts", { p_passcode: pass }));
        } catch (thrown) {
            return ctFail(thrown.message || "열지 못했습니다.");
        }
        if (error) return ctFail(error.message || "열지 못했습니다.");
        if (!data || data.ok === false) {
            return ctFail((data && data.error) || "열지 못했습니다.");
        }
        ctPass = pass;
        ctRows = Array.isArray(data.contacts) ? data.contacts : [];
        $("ct-pass").value = "";
        $("ct-gate").hidden = true;
        $("ct-body").hidden = false;
        drawContacts();
    } finally {
        $("ct-open").disabled = false;
    }
}

function ctLock() {
    ctPass = null;
    ctRows = [];
    if (!$("ct-body")) return;
    $("ct-body").hidden = true;
    $("ct-gate").hidden = false;
    $("ct-table").innerHTML = "";
    $("ct-save-msg").hidden = true;
}

function drawContacts() {
    const only = $("ct-store").value;
    const rows = only ? ctRows.filter((r) => r.store_name === only) : ctRows;
    if (!rows.length) {
        $("ct-table").innerHTML =
            '<p class="hint">등록된 연락처가 없습니다. 반입 도구가 들여오면 여기 나타납니다.</p>';
        return;
    }
    table($("ct-table"),
        ["매장", "가맹주", "점주 전화", "실운영자", "실운영자 연락처", "매장 전화",
         "이메일", "주소", "사업자번호", "계약기간", "양도양수", ""],
        rows.map((r, i) => [
            escape(r.store_name),
            escape(r.owner_name || "—"),
            escape(r.owner_phone || "—"),
            escape(r.operator_name || "—"),
            escape(r.operator_phone || "—"),
            escape(r.store_phone || "—"),
            escape(r.email || "—"),
            escape(r.address || "—"),
            escape(r.business_number || "—"),
            escape(r.contract_period || "—"),
            escape(r.transfer_note || "—"),
            `<button class="ghost ct-edit" data-i="${i}" type="button">수정</button>`,
        ]),
        { html: true });
    for (const b of $("ct-table").querySelectorAll(".ct-edit")) {
        b.addEventListener("click", () => ctFillForm(rows[Number(b.dataset.i)]));
    }
}

function ctFillForm(r) {
    $("ct-f-store").value = r.store_name;
    $("ct-f-owner").value = r.owner_name || "";
    $("ct-f-owner-phone").value = r.owner_phone || "";
    $("ct-f-operator").value = r.operator_name || "";
    $("ct-f-operator-phone").value = r.operator_phone || "";
    $("ct-f-store-phone").value = r.store_phone || "";
    $("ct-f-email").value = r.email || "";
    $("ct-f-address").value = r.address || "";
    $("ct-f-bizno").value = r.business_number || "";
    $("ct-f-contract").value = r.contract_period || "";
    $("ct-f-transfer").value = r.transfer_note || "";
    $("ct-f-owner").focus();
}

async function ctSave() {
    if (!ctPass) return;
    const msg = $("ct-save-msg");
    msg.hidden = true;
    const val = (id) => $(id).value.trim() || null;
    const args = {
        p_passcode: ctPass,
        p_store: $("ct-f-store").value,
        p_owner_name: val("ct-f-owner"),
        p_owner_phone: val("ct-f-owner-phone"),
        p_operator_name: val("ct-f-operator"),
        p_operator_phone: val("ct-f-operator-phone"),
        p_store_phone: val("ct-f-store-phone"),
        p_email: val("ct-f-email"),
        p_address: val("ct-f-address"),
        p_business_number: val("ct-f-bizno"),
        p_contract_period: val("ct-f-contract"),
        p_transfer_note: val("ct-f-transfer"),
    };
    $("ct-save").disabled = true;
    try {
        const { data, error } = await db.rpc("save_store_contact", args);
        const failed = error || !data || data.ok === false;
        msg.textContent = failed
            ? ((error && error.message) || (data && data.error) || "저장하지 못했습니다.")
            : `저장했습니다 · ${args.p_store}`;
        msg.hidden = false;
        if (!failed) {
            // 저장한 값이 실제로 들어갔는지 다시 읽어 확인합니다(cred 와 같은 규칙).
            const re = await db.rpc("api_store_contacts", { p_passcode: ctPass });
            if (re.data && re.data.ok !== false) {
                ctRows = re.data.contacts || [];
            }
            drawContacts();
            ctSummary();
        }
    } finally {
        $("ct-save").disabled = false;
    }
}

function initContacts(storeNames) {
    if (!$("contacts-card")) return;
    fillStoreSelect($("ct-store"), storeNames, "전체");
    fillStoreSelect($("ct-f-store"), storeNames, null);
    $("ct-open").addEventListener("click", ctOpen);
    $("ct-pass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") ctOpen();
    });
    $("ct-lock").addEventListener("click", ctLock);
    $("ct-store").addEventListener("change", drawContacts);
    $("ct-save").addEventListener("click", ctSave);
    ctSummary();
}


// ---- 월간 보고서 --------------------------------------------------------
//
// 본사가 형식을 PDF, 받는 사람을 SV 로 확정했습니다(hq-standards.md 2번).
// SV 가 받아 점주에게 전달하거나 상부 보고에 씁니다.
//
// 화면에 이미 있는 lastData 만 씁니다 — 보고서 때문에 조회를 또 하지 않습니다.
// 급증·급감 기준은 본사 값(±10%)이고 설정 테이블에 있습니다. 여기서 다시
// 판정하지 않고 api_sales_alerts 가 준 판정을 그대로 씁니다.

function drawReport(d) {
    const sheet = $("report-sheet");
    if (!sheet || !d) return;

    const s = d.summary || {};
    const stores = d.args && d.args.p_store ? d.args.p_store : "전체 매장";
    const span = `${ymDash(d.args.p_ym_from)} ~ ${ymDash(d.args.p_ym_to)}`;

    // ⚠️ api_summary 에는 홀·배달·객단가가 없습니다(amount·qty·store_count·menu_count 뿐).
    //    api_monthly 는 **채널별로 한 줄**입니다(ym·channel·amount·qty).
    //    없는 열을 읽어 0 이 찍히고 월이 두 줄씩 나오던 것을 고쳤습니다(2026-07-30).
    //    화면 카드들과 같은 원본을 쓰되, 여기서 연월로 접습니다.
    const byMonth = new Map();
    for (const r of d.monthly || []) {
        const m = byMonth.get(r.ym)
            || { ym: r.ym, amount: 0, qty: 0, hall: 0, delivery: 0 };
        m.amount += Number(r.amount) || 0;
        m.qty += Number(r.qty) || 0;
        if (r.channel === "홀") m.hall += Number(r.amount) || 0;
        else m.delivery += Number(r.amount) || 0;
        byMonth.set(r.ym, m);
    }
    const months = [...byMonth.values()].sort((a, b) => a.ym - b.ym);
    const hall = months.reduce((a, m) => a + m.hall, 0);
    const delivery = months.reduce((a, m) => a + m.delivery, 0);
    const qty = Number(s.qty) || 0;
    const avgTicket = qty ? Math.round((Number(s.amount) || 0) / qty) : 0;

    // 판정이 붙은 채널만 싣습니다. 전부 실으면 SV 가 읽지 않습니다.
    const alertRows = (d.alerts || []).flatMap((a) =>
        (a.channels || [])
            .filter((c) => c.mom_direction || c.yoy_direction)
            .map((c) => ({ store: a.store, ...c })));

    const top = (d.menus || []).slice(0, 10);

    sheet.innerHTML = `
      <div class="report">
        <div class="report-head">
          <h1>미태리 매출 보고</h1>
          <div class="report-meta">
            <div>기간 <b>${escape(span)}</b></div>
            <div>대상 <b>${escape(stores)}</b></div>
            <div>작성 ${escape(new Date().toLocaleString("ko-KR",
                  { dateStyle: "long", timeStyle: "short" }))}</div>
          </div>
        </div>

        <h2>1. 요약</h2>
        <table class="report-kpi"><tbody>
          <tr><th>총매출</th><td>${wonFull(s.amount)}</td>
              <th>총수량</th><td>${int(qty)}</td></tr>
          <tr><th>홀</th><td>${wonFull(hall)}</td>
              <th>배달</th><td>${wonFull(delivery)}</td></tr>
          <tr><th>객단가</th><td>${wonFull(avgTicket)}</td>
              <th>매장 수</th><td>${int(s.store_count)}곳</td></tr>
        </tbody></table>

        <h2>2. 급증·급감 매장 <span class="report-sub">${escape(ymDash(d.args.p_ym_to))} 기준</span></h2>
        ${alertRows.length ? `<table class="report-table"><thead><tr>
            <th>매장</th><th>채널</th><th>매출</th><th>전월 대비</th><th>전년 대비</th>
          </tr></thead><tbody>${alertRows.map((c) => `<tr>
                <td>${escape(c.store)}</td><td>${escape(c.channel)}</td>
                <td>${wonFull(c.amount)}</td>
                <td>${escape(c.mom_direction || "—")} ${pct(c.mom_pct_change)}</td>
                <td>${escape(c.yoy_direction || "—")} ${pct(c.yoy_pct_change)}</td>
              </tr>`).join("")}</tbody></table>`
          : "<p>기준(±10%)을 넘은 매장이 없습니다.</p>"}
        <p class="report-note">
          기간의 마지막 달 실적을 전월·전년 동월과 비교합니다.
          그 달에 매출이 없는 매장은 비교 대상이 아닙니다.
        </p>

        <h2>3. 월별 추이</h2>
        ${months.length ? `<table class="report-table"><thead><tr>
            <th>연월</th><th>총매출</th><th>홀</th><th>배달</th><th>수량</th>
          </tr></thead><tbody>${months.map((m) => `<tr>
            <td>${escape(ymDash(m.ym))}</td><td>${wonFull(m.amount)}</td>
            <td>${wonFull(m.hall)}</td><td>${wonFull(m.delivery)}</td>
            <td>${int(m.qty)}</td></tr>`).join("")}</tbody></table>`
          : "<p>자료가 없습니다.</p>"}

        <h2>4. 상위 품목 10</h2>
        ${top.length ? `<table class="report-table"><thead><tr>
            <th>품목</th><th>분류</th><th>매출</th><th>수량</th>
          </tr></thead><tbody>${top.map((m) => `<tr>
            <td>${escape(m.menu)}</td><td>${escape(catLabel(m.category))}</td>
            <td>${wonFull(m.amount)}</td><td>${int(m.qty)}</td></tr>`).join("")}
          </tbody></table>` : "<p>자료가 없습니다.</p>"}

        <p class="report-foot">
          배달은 할인 전, 홀은 할인 후 금액입니다. 급증·급감 기준 ±10%.
        </p>
      </div>`;
}

// 비율은 소수 한 자리로 통일합니다. 없으면 줄표.
function pct(rate) {
    if (rate === null || rate === undefined) return "—";
    const n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function initReport() {
    const button = $("report-print");
    if (button) button.addEventListener("click", () => window.print());
}

// ================================================================ 광고 (6번 영역)
//
// 48_ad_spend.sql 위의 읽기 화면입니다. 자료(마케팅팀 광고 집행 대장)가 반입
// 되기 전에는 빈 표가 정상이라, 그때는 타일·표를 숨기고 안내 한 줄만 남깁니다.
// 위쪽 기간·매장 필터를 따르지 않는 이유는 방문·점검과 같습니다 — 자료가
// 쌓여 한 화면을 넘기 시작하면 그때 기간 선택을 붙입니다.

async function initAds() {
    const { data, error } = await db.rpc("api_ad_spend", {});
    const meta = $("ads-meta");
    if (error) {
        meta.textContent = "";
        $("t-ads").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) {
        meta.textContent = "자료 반입 전";
        $("ads-kpis").hidden = true;
        $("t-ads-channel").innerHTML = "";
        $("t-ads").innerHTML =
            '<p class="hint">아직 반입된 광고 자료가 없습니다.</p>';
        return;
    }

    const summary = data.summary || {};
    const yms = rows.map((r) => r.ym);
    meta.textContent = `${int(rows.length)}행`;
    $("ads-kpis").hidden = false;
    $("ads-cost").textContent = won(summary.cost);
    $("ads-range").textContent =
        `${ymLabel(Math.min(...yms))} ~ ${ymLabel(Math.max(...yms))}`;
    $("ads-impressions").textContent = int(summary.impressions);
    $("ads-clicks").textContent = int(summary.clicks);
    $("ads-orders").textContent = int(summary.orders);

    const byChannel = Array.isArray(data.by_channel) ? data.by_channel : [];
    table($("t-ads-channel"), ["채널", "광고비", "노출", "클릭", "광고 경유 주문"],
        byChannel.map((c) => [c.channel, wonFull(c.cost), int(c.impressions),
                              int(c.clicks), int(c.orders)]));
    table($("t-ads"), ["월", "매장", "채널", "캠페인", "광고비", "노출", "클릭", "주문"],
        rows.map((r) => [ymLabel(r.ym), r.store, r.channel, r.campaign || "—",
                         wonFull(r.cost),
                         r.impressions == null ? "—" : int(r.impressions),
                         r.clicks == null ? "—" : int(r.clicks),
                         r.orders == null ? "—" : int(r.orders)]));
}

// ================================================================ 식자재·발주 (10번 영역)
//
// 레시피(32_recipes.sql, 원가분석 파일 반입분) + 이론 사용량(49_ingredient_usage.sql
// = 판매량 × 레시피). 계산의 뒤 절반인 '발주량과 대조'(과조리·저발주·자점매입
// 의심)는 발주 자료가 연동돼야 가능합니다 — 그때 이 화면에 대조 열이 붙습니다.
// 이론 사용량 카드가 자체 기간·매장 칸을 갖는 이유: 위쪽 필터 줄은 매출
// 영역에서만 보이기 때문입니다(showArea 참조).

let recipeRows = [];       // api_recipes 전체(278행 수준) — select 와 표가 같이 씀
let iuRangeReady = false;  // 기간 select 는 첫 응답의 ym_min~ym_max 로 한 번만 채움

async function initIngredients() {
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

// ================================================================ POS 메뉴 (5번 영역)
//
// 50_pos_menu.sql 위의 화면입니다. 위쪽 기간·매장 필터는 매출 영역에서만
// 보이므로(showArea 참조) 이 카드는 자체 고르개를 갖습니다.
//
// 변경은 요청 → 승인(30_tasks) → 실행 순서이고, **승인이 곧 실행이 아닙니다.**
// 실제 POS 쓰기는 담당자 입회 아래 첫 건을 넣기 전까지 dry-run 만 쌓입니다
// (docs/pos-write-plan.md). 그래서 표에 승인 상태와 실행 상태를 따로 둡니다 —
// 하나로 합치면 "승인했는데 왜 POS 가 그대로냐" 를 화면이 못 답합니다.

let pmRows = [];
let pmSummary = {};

async function initPosMenu() {
    // 계정을 바꾸면 분류·매장 목록이 통째로 달라집니다 — 굿모닝(HI5)과
    // 착한통신(INY)은 서로 다른 본부라 같은 분류 코드의 뜻이 다릅니다.
    $("pm-account").addEventListener("change", onPosAccountChange);
    $("pm-store").addEventListener("change", refreshPosMenu);
    $("pm-large").addEventListener("change", refreshPosMenu);
    $("pm-only-unavailable").addEventListener("change", refreshPosMenu);
    // 검색은 서버로 보냅니다 — 3,000종이 넘어 화면에 다 받아 두지 않습니다.
    $("pm-q").addEventListener("input", debounce(refreshPosMenu, 250));
    initPosMenuActions();

    await refreshPosMenuSummary();
    await Promise.all([refreshPosMenu(), refreshPosMenuRequests(), refreshOilday()]);
}

// 오일데이 원복 점검 (QUEUE #62, 56_oilday_check.sql). 반값은 정상 상품의
// 가격 변경이 아니라 별도 '(이벤트)' 상품을 켜고 끄는 운영이라(2026-08-06
// 실측 — 정상 가격을 반값으로 고친 사례 0건), 행사날이 아닌데 켜져 있는
// 오일메뉴 이벤트 상품을 목록으로 보여줍니다.
async function refreshOilday() {
    const meta = $("od-meta");
    const view = $("t-oilday");
    const { data, error } = await db.rpc("api_oilday_check");
    if (error) {
        view.innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(error.message) + "</p>";
        return;
    }
    const check = data || {};
    const items = check.items || [];

    if (!check.snapshot_at) {
        meta.textContent = "";
        view.innerHTML = '<p class="hint">POS 메뉴 반입이 아직 없습니다 — '
            + "반입되면 자동으로 판정합니다.</p>";
        return;
    }

    const snapDate = String(check.snapshot_at).slice(0, 10);
    meta.textContent = `기준 스냅샷 ${snapDate} · 행사일 매월 ${check.event_day}일`;

    // 행사날 스냅샷이면 켜져 있는 것이 정상입니다 — 판정하지 않습니다(설계 판단 [3]).
    if (check.is_event_day) {
        view.innerHTML = '<p class="hint">기준 스냅샷이 행사일(' + int(check.event_day)
            + "일)에 반입된 것이라 이벤트 상품이 켜져 있는 것이 정상입니다. "
            + "행사 다음 날 반입분으로 다시 판정합니다.</p>";
        return;
    }

    if (!items.length) {
        view.innerHTML = '<p class="hint">켜진 채 남은 오일메뉴 이벤트 상품이 '
            + "없습니다 — 전 매장 원복 완료.</p>";
        return;
    }

    table(view,
        ["계정", "매장(분류)", "상품", "가격", "상태"],
        items.map((it) => [
            it.account,
            it.store_name || it.medium_name || "—",
            it.item_name,
            won(it.price),
            it.soldout_name || it.soldout_code || "—",
        ]));
}

async function onPosAccountChange() {
    // 고른 계정에 없는 분류·매장이 남아 있으면 빈 표가 나옵니다. 비우고 다시 채웁니다.
    $("pm-large").value = "";
    $("pm-store").value = "";
    fillPosLargeSelect();
    await fillPosStoreSelect();
    await refreshPosMenu();
}

// 분류 고르개. 계정을 고르면 그 계정 것만, 아니면 계정 이름을 붙여 보여줍니다
// (004 처럼 코드가 같고 뜻이 다른 분류가 있어 이름만으로는 구분이 안 됩니다).
function fillPosLargeSelect() {
    const account = $("pm-account").value;
    const select = $("pm-large");
    select.length = 1;
    for (const g of (pmSummary.by_large || [])) {
        if (account && g.account !== account) continue;
        const opt = document.createElement("option");
        opt.value = g.code;
        opt.textContent = (account ? "" : `[${g.account}] `)
            + `${g.name || g.code} (${int(g.items)})`;
        select.append(opt);
    }
}

async function fillPosStoreSelect() {
    const select = $("pm-store");
    select.length = 1;
    const { data } = await db.rpc("api_pos_menu_stores",
        { p_account: $("pm-account").value || null });
    for (const s of Array.isArray(data) ? data : []) {
        const opt = document.createElement("option");
        opt.value = s.store;
        // 매장 대장에 없는 표기(폐점·이름 차이)도 고를 수 있어야 합니다 —
        // 빼면 그 매장 메뉴는 화면에서 영영 못 봅니다.
        opt.textContent = s.matched
            ? `${s.store} (${int(s.items)})`
            : `${s.store} (${int(s.items)}) — 대장에 없음`;
        select.append(opt);
    }
}

// 매장 칸 밑에 붙는 한 줄. 계정을 안 좁혔으면 어느 본부 것인지 밝힙니다 —
// 두 계정이 섞이면 같은 매장 이름이 양쪽에 다 나올 수 있습니다.
function pmStoreNote(row) {
    const parts = [];
    if (row.store_scope === "common") parts.push("본사 메뉴");
    if (!$("pm-account").value) parts.push(escape(row.account));
    return parts.length ? `<div class="meta">${parts.join(" · ")}</div>` : "";
}

function pmSoldoutTag(row) {
    const label = escape(row.soldout_name || row.soldout_code || "—");
    return row.unavailable
        ? `<span class="tag warn">${label}</span>`
        : `<span class="tag">${label}</span>`;
}

async function refreshPosMenuSummary() {
    const { data, error } = await db.rpc("api_pos_menu_summary");
    if (error) {
        $("pm-meta").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    pmSummary = data || {};
    const d = pmSummary;
    const has = Number(d.items) > 0;
    $("pm-kpis").hidden = !has;
    if (!has) {
        $("pm-meta").textContent = "아직 반입 전입니다";
        return;
    }
    $("pm-items").textContent = int(d.items);
    $("pm-unavailable").textContent = int(d.unavailable);
    // 이 값은 메뉴 수가 아니라 **매장 수**입니다 (count(distinct store_id)).
    // 옆 타일 둘이 상품 종수라 라벨을 '메뉴가 붙은 매장' 으로 못박아 뒀습니다.
    $("pm-stores").textContent = int(d.stores) + "곳";
    $("pm-open").textContent = int(d.open_requests);
    $("pm-collected").textContent = d.collected_at
        ? String(d.collected_at).slice(0, 10) + " 기준" : "";
    // 못 맞춘 매장 표기는 숨기지 않습니다 — 보여야 고칩니다(미매핑 품목과 같은 태도).
    $("pm-unmatched").textContent = Number(d.unmatched)
        ? `매장 못 맞춘 표기 ${int(d.unmatched)}개` : "";
    // 머리말은 계정별로 씁니다. 계정마다 본부가 달라 합계만 보면 뜻이 흐려집니다.
    $("pm-meta").textContent = (d.by_account || [])
        .map((a) => `${a.account}(${a.hq_code || "?"}) ${int(a.items)}종`).join(" · ");

    const accountSelect = $("pm-account");
    if (accountSelect.options.length <= 1) {
        for (const a of d.by_account || []) {
            const opt = document.createElement("option");
            opt.value = a.account;
            opt.textContent = `${a.account} (${int(a.items)})`;
            accountSelect.append(opt);
        }
    }
    fillPosLargeSelect();
    if ($("pm-store").options.length <= 1) await fillPosStoreSelect();
}

async function refreshPosMenu() {
    const args = { p_limit: 300 };
    if ($("pm-account").value) args.p_account = $("pm-account").value;
    if ($("pm-store").value) args.p_store = $("pm-store").value;
    if ($("pm-large").value) args.p_large = $("pm-large").value;
    if ($("pm-q").value.trim()) args.p_q = $("pm-q").value.trim();
    if ($("pm-only-unavailable").checked) args.p_only_unavailable = true;

    const { data, error } = await db.rpc("api_pos_menus", args);
    if (error) {
        pmRows = [];
        $("t-posmenu").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    pmRows = d.items || [];
    $("pm-shown").textContent = Number(d.total) > Number(d.shown)
        ? `${int(d.total)}건 중 ${int(d.shown)}건 표시` : `${int(d.shown)}건`;

    if (!pmRows.length) {
        $("t-posmenu").innerHTML = '<p class="hint">조건에 맞는 메뉴가 없습니다.</p>';
        return;
    }

    table($("t-posmenu"),
        ["상태", "매장", "분류", "메뉴", "상품코드", "판매가", "처리"],
        pmRows.map((r) => [
            pmSoldoutTag(r),
            escape(r.store) + pmStoreNote(r),
            escape(r.category || "—"),
            escape(r.item_name),
            escape(r.item_code),
            r.price == null ? "—" : wonFull(r.price),
            r.change_task_id
                ? taskStatusTag(r.change_task_status)
                    + `<div class="meta">업무 #${int(r.change_task_id)}</div>`
                : `<button class="ghost" data-act="pm-request"`
                    + ` data-menu-item-id="${r.menu_item_id}"`
                    + ` data-to="${r.unavailable ? "0" : "1"}"`
                    + ` data-item="${escape(r.item_name)}"`
                    + ` data-store="${escape(r.store)}"`
                    + ` data-scope="${escape(r.store_scope)}">`
                    + `${r.unavailable ? "판매 재개 요청" : "품절 요청"}</button>`,
        ]),
        { html: true });
}

// 실행 칸. '승인됨' 과 'POS 에 반영됨' 은 다른 것이라 따로 보여줍니다.
function pmExecutionTag(row) {
    if (row.applied) return '<span class="tag up">반영됨</span>';
    if (row.last_mode === "live" && row.last_ok === false) {
        return '<span class="tag down">실패</span>';
    }
    if (row.last_mode === "dry_run") {
        return '<span class="tag">dry-run</span>'
            + '<div class="meta">POS 는 그대로입니다</div>';
    }
    if (row.task_status === "done") return '<span class="tag h-warn">실행 대기</span>';
    return "—";
}

async function refreshPosMenuRequests() {
    const { data, error } = await db.rpc("api_pos_menu_requests", { p_limit: 100 });
    if (error) {
        $("t-posmenu-requests").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    $("pm-req-meta").textContent = rows.length ? `${int(rows.length)}건` : "";
    // 목록을 다시 그리면 열려 있던 이력 패널은 옛 요청 것이라 닫습니다.
    $("posmenu-exec-panel").hidden = true;
    if (!rows.length) {
        $("t-posmenu-requests").innerHTML =
            '<p class="hint">아직 변경 요청이 없습니다.</p>';
        return;
    }
    table($("t-posmenu-requests"),
        ["승인", "실행", "매장", "메뉴", "바꿀 내용", "요청 사유", "요청일", "이력"],
        rows.map((r) => [
            taskStatusTag(r.task_status)
                + `<div class="meta">업무 #${int(r.task_id)}</div>`,
            pmExecutionTag(r),
            escape(r.store || "—"),
            escape(r.item_name) + `<div class="meta">${escape(r.item_code)}</div>`,
            escape(r.field) + " "
                + escape(r.before_label || r.before_value || "(없음)")
                + " → " + escape(r.after_label || r.after_value),
            escape(r.reason || "—"),
            escape(String(r.created_at).slice(0, 10)),
            Number(r.executions)
                ? `<button class="ghost" data-act="pm-executions"`
                    + ` data-request-id="${r.request_id}"`
                    + ` data-item="${escape(r.item_name)}">${int(r.executions)}건</button>`
                : "—",
        ]),
        { html: true });
}

// 한 요청의 실행 이력. dry-run 이 몇 번 돌았는지, 실제로 나간 건 언제인지가
// 여기 있습니다 — 목록의 배지 한 칸으로는 그 경위를 못 보여줍니다.
async function showPosMenuExecutions(requestId, itemName) {
    const panel = $("posmenu-exec-panel");
    panel.hidden = false;
    $("posmenu-exec-title").textContent = `${itemName} — 실행 이력`;
    $("t-posmenu-executions").innerHTML = '<p class="hint">불러오는 중…</p>';

    const { data, error } = await db.rpc("api_pos_menu_executions",
        { p_request_id: requestId });
    if (error) {
        $("t-posmenu-executions").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
        $("t-posmenu-executions").innerHTML = '<p class="hint">실행 이력이 없습니다.</p>';
        return;
    }
    table($("t-posmenu-executions"),
        ["언제", "방식", "결과", "POS 응답", "다시 읽은 값", "메모"],
        rows.map((e) => [
            escape(String(e.executed_at).replace("T", " ").slice(0, 16)),
            e.mode === "live"
                ? '<span class="tag warn">실제 전송</span>'
                : '<span class="tag">dry-run</span>',
            e.ok ? '<span class="tag up">성공</span>'
                 : '<span class="tag down">실패</span>',
            escape(e.response_code || "—")
                + (e.response_msg ? `<div class="meta">${escape(e.response_msg)}</div>` : ""),
            escape(e.verified_value || "—"),
            escape(e.note || "—"),
        ]),
        { html: true });
}

function initPosMenuActions() {
    $("t-posmenu-requests").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act='pm-executions']");
        if (!button) return;
        showPosMenuExecutions(Number(button.dataset.requestId), button.dataset.item);
    });

    // 목록은 매번 새로 그려지므로 컨테이너에 한 번만 위임합니다.
    $("t-posmenu").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='pm-request']");
        if (!button) return;

        const to = button.dataset.to;
        const what = to === "0" ? "판매 재개" : "품절 처리";
        let message = `${button.dataset.store} · ${button.dataset.item}\n`
            + `${what} 를 승인 대기로 올립니다.`;
        if (button.dataset.scope === "common") {
            // 본사 마스터 상품이라 전 매장에 걸릴 수 있습니다 — 누르기 전에
            // 알려야 합니다. 매장 단위 여부는 아직 확인 전입니다(입회 시험 항목).
            message += "\n\n이 메뉴는 본사 메뉴입니다."
                + " 한 매장이 아니라 전 매장에 걸릴 수 있습니다.";
        }
        if (!window.confirm(message)) return;

        const reason = window.prompt("요청 사유를 적어 주세요. 이력에 남습니다.", "");
        if (reason === null) return;

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("request_pos_menu_change", {
            p_menu_item_id: Number(button.dataset.menuItemId),
            p_change_type: "soldout",
            p_after_value: to,
            p_reason: reason.trim() ? reason.trim() : null,
        });

        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }

        // 업무 영역의 승인 대기 숫자가 이 요청을 비추므로 같이 새로 그립니다 —
        // 영역 전환은 다시 조회하지 않아(showArea 원칙) 여기서 안 하면 옛 숫자가 남습니다.
        await Promise.all([
            refreshPosMenu(), refreshPosMenuRequests(), refreshPosMenuSummary(),
            refreshTasksSummary(), refreshTaskList(),
        ]);
    });
}
