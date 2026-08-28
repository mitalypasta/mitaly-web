// 미태리 매출 대시보드 — 프론트엔드
//
// 데이터베이스에서 이미 합계를 내서 내려주므로(api_* 함수), 이 파일은
// 받은 숫자를 그리기만 합니다. 59만 행을 브라우저로 가져오지 않습니다.
//
// 차트는 라이브러리 없이 SVG로 직접 그립니다. 막대 두께·모서리·간격 같은
// 규격을 정확히 지키기 위해서입니다.
//
// 순수 헬퍼·표·차트는 별도 모듈로 빠졌습니다 — docs/web-split-plan.md.
import { won, wonFull, int, ymLabel, catLabel, ymDash } from "./format.js";
import { escape, clip, debounce, niceTicks, monthsBetween } from "./util.js";
import { S } from "./state.js";
import { table, $, monthPicker, searchify, loadSheetJS, showTip, hideTip } from "./dom.js";
import { palette, renderHeat, drawLine, drawBars } from "./charts.js";

// Supabase 클라이언트(데모 분기·설정 게이트)는 client.js 로 빠졌습니다 —
// docs/web-split-plan.md 3단계. db 를 쓰는 화면 모듈이 같은 인스턴스를 씁니다.
import { db, CONFIG, fetchStores } from "./client.js";
// 영역 모듈들 — 각자 db + foundation 만 import 하는 독립 화면입니다
// (docs/web-split-plan.md 3·4단계). 대시보드가 init* 를 부릅니다.
import { initAds } from "./ads.js";
import { initAccountPresence } from "./account.js";
import { initLifecycle } from "./lifecycle.js";
import { initKakaoStats } from "./kakao_stats.js";
import { initOurhome } from "./ourhome.js";
import { initIngStore } from "./ing_store.js";
import { initStoreDb } from "./store_db.js";
import { initIngredients } from "./ingredients.js";
import { initCredentials } from "./credentials.js";
import { initContacts } from "./contacts.js";
import { initAreas, initHomeTiles } from "./nav.js";
import { initNotices } from "./notices.js";
import { initTasks } from "./tasks.js";
import { initComms } from "./comms.js";
import { initPosMenu } from "./pos.js";
import { initInquiries } from "./inquiries.js";
import { initSettlement } from "./settlement.js";
import { initDeliveryMap, dmapFilterChanged } from "./map.js";
import { initNotifications } from "./notifications.js";
import { initRecipients } from "./recipients.js";
import { initConsents } from "./consents.js";
import { initReport, drawReport } from "./report.js";
import { initKpiSettings } from "./kpi.js";
import { initStoreDash } from "./store_dash.js";
import { initDiagnosis } from "./diagnosis.js";
import { initAllStores } from "./allstores.js";
import { initSettings } from "./settings.js";

// 폼 밖 비밀번호 칸(매장 정보 탭 암호 게이트·계정 편집)을 제 폼에 가둔 대신,
// 그 폼은 제출(새로고침)하지 않습니다 — Enter 는 각 모듈의 keydown 이 처리.
// 왜 폼에 가두나: 크롬은 폼 없는 입력을 한 묶음으로 보고 비밀번호 칸이 섞이면
// 같은 묶음의 글자 칸(매장 콤보)에 저장 계정을 띄웁니다(2026-08-21 실측).
document.addEventListener("submit", (e) => {
    if (e.target && e.target.matches && e.target.matches("form[data-noop]")) e.preventDefault();
});

const gate = $("gate");
const app = $("app");

// (tooltip 요소·cssVar·palette 는 dom.js/charts.js 로 이동 — 위 import)

const CHANNEL_COLORS = { "홀": "s1", "배달": "s2" };
const WEEKDAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

// (숫자 표기 함수 won·wonFull·int·ymLabel 은 format.js 로 이동 — 위 import)

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
               "비밀번호로 로그인하거나 1시간 뒤 다시 해 보세요.";
    }
    if (/invalid login credentials/i.test(text)) {
        return "이메일이나 비밀번호가 맞지 않습니다.";
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
    if (S.lastData) draw(S.lastData);
});

// ---------------------------------------------------------------- 대시보드


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
    // 시작·종료월은 select 가 아니라 브라우저 달력(input[type=month])입니다
    // (3라운드 0-1). 고를 수 있는 범위 = 데이터가 실존하는 범위.
    monthPicker("f-from", { min: info.ym_min, max: info.ym_max });
    monthPicker("f-to", { min: info.ym_min, max: info.ym_max });

    // 매장 select 는 전부 검색 가능한 콤보로 바꿉니다(3라운드 0-2). select 는
    // 숨은 값의 원본으로 남으므로 각 영역 파일의 채우기·읽기 코드는 그대로
    // 동작합니다. 옵션이 나중에 채워지는 select 도 콤보가 알아서 따라갑니다.
    for (const id of ["f-store", "dmap-store", "oh-store", "iu-store",
                      "cred-f-store", "ct-store", "ct-f-store",
                      "v-store", "vs-store", "la-store", "pm-store",
                      "dm-store", "tk-store", "tk-filter-store", "pay-invoice",
                      "rv-store"]) {
        searchify(id);
    }

    // 기본값: **최근 한 달**(지난달~이번달). 담당자 요구(2026-07-30).
    //
    // 12개월이 기본이면 화면을 열 때마다 팩트 80만 행을 통째로 훑어 느립니다.
    // 그리고 담당자가 화면을 여는 대부분의 이유는 '요즘 어떤가' 이지
    // '작년까지 통틀어 어떤가' 가 아닙니다. 길게 볼 때는 직접 늘리면 됩니다.
    //
    // 데이터가 한 달치뿐이면 그 한 달만 잡습니다(toIdx - 1 이 음수).
    //
    // 종료월은 '마지막 완성 월' 입니다(H3, _agent/SALES-DIAGNOSIS.md).
    // 오늘이 속한 달은 수집이 진행 중이라(예: 8월 중순에 2곳만 들어옴) 그 달을
    // 기본 기준으로 잡으면 급증·급감·기간대비·보고서가 전 매장 급감으로
    // 오탐합니다. 진행 중인 달이 올라와 있으면 기본을 전월로 물리고,
    // 그 달을 보려면 종료월을 직접 올리면 됩니다(고르개에는 그대로 있음).
    const t = new Date();
    const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
    const toIdx = (info.ym_max >= nowYm && months.length >= 2)
        ? months.length - 2 : months.length - 1;
    const defTo = months[toIdx];
    const defFrom = months[Math.max(0, toIdx - 1)];
    $("f-from").value = String(defFrom);
    $("f-to").value = String(defTo);

    initCredentials(info.stores);
    initContacts(info.stores);

    const storeSelect = $("f-store");
    for (const name of info.stores || []) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        storeSelect.append(option);
    }

    // 리뷰 탭 '매장 리뷰 보기' 콤보(카드 #132) — f-store 의 거울입니다.
    // 리뷰 목록·요약이 이미 f-store 로 좁혀지므로 새 조회 축을 만들지 않고,
    // 여기서 고르면 f-store 를 그 매장으로 바꿔 기존 load() 하나가 목록과
    // 매장 보기 카드를 같이 채웁니다(같은 매장을 다시 골라도 재조회 없음).
    // 반대 방향(필터 줄·홈 이상신호 행에서 f-store 가 바뀔 때)의 미러는
    // drawReviewStoreView 가 그릴 때마다 맞춥니다.
    const rvStore = $("rv-store");
    for (const name of info.stores || []) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        rvStore.append(option);
    }
    rvStore.addEventListener("change", () => {
        if (storeSelect.value === rvStore.value) return;
        storeSelect.value = rvStore.value;
        storeSelect.dispatchEvent(new Event("change"));
    });

    // 배달 지도 카드의 자체 고르개(S17). 위 필터 줄이 지도 영역에서는 안 보여서
    // (showArea) 이론 사용량 카드처럼 카드가 직접 갖습니다 — 지도는 이제 이
    // 고르개만 읽습니다(dmapFilters). 고를 수 있는 달·매장은 전역 필터와 같은
    // 원천(api_filters)이고 기본값도 같은 규칙(최근 한 달)입니다.
    monthPicker("dmap-from", { min: info.ym_min, max: info.ym_max });
    monthPicker("dmap-to", { min: info.ym_min, max: info.ym_max });
    $("dmap-from").value = String(defFrom);
    $("dmap-to").value = String(defTo);
    for (const name of info.stores || []) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        $("dmap-store").append(option);
    }
    for (const id of ["dmap-from", "dmap-to", "dmap-store"]) {
        // 카드가 아직 안 떴으면(게으른 로드) 값만 남겨 두면 됩니다 — 첫
        // 그리기가 어차피 이 고르개를 읽습니다. 떠 있으면 마커·상세를 같이
        // 다시 그립니다(지도 유무는 map.js 가 판단 — SDK 없이도 상세는 돕니다).
        $(id).addEventListener("change", dmapFilterChanged);
    }

    // 내보내기 기본 기간을 데이터 범위에 맞추는 데 씁니다.
    S.filterRange = { min: info.ym_min, max: info.ym_max };

    for (const id of ["f-from", "f-to", "f-store", "f-channel"]) {
        $(id).addEventListener("change", load);
    }

    document.querySelectorAll("[data-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = $(button.dataset.toggle);
            target.hidden = !target.hidden;
            // 기본은 표 토글(표로/차트로 보기). 원장 카드처럼 차트가 토글
            // 대상이면 data-label-shown/hidden 이 문구를 정합니다(카드 #118).
            button.textContent = target.hidden
                ? (button.dataset.labelHidden || "표로 보기")
                : (button.dataset.labelShown || "차트로 보기");
            // 숨긴 채 그려진 차트는 fallback 폭으로 굳어 있습니다(H2 와 같은
            // 병) — 방금 드러난 대상에 차트가 있으면 한 번 다시 그립니다.
            if (!target.hidden && S.lastData && target.querySelector("svg.plot")) {
                draw(S.lastData);
            }
        });
    });

    // 원장(ledger) 카드는 기본 접힘이라, 접힌 채 그려진 차트가 fallback 폭으로
    // 굳습니다 — 펼치는 순간 한 번 다시 그립니다(위 토글과 같은 이유).
    document.querySelectorAll("details.ledger").forEach((box) => {
        box.addEventListener("toggle", () => {
            const svg = box.querySelector("svg.plot");
            if (box.open && S.lastData && svg && svg.clientWidth > 0) {
                draw(S.lastData);
            }
        });
    });

    // 급증·급감 매장만 보기 / 매장 검색. 이미 받아 온 데이터를 다시 그리기만 합니다.
    $("alerts-only").addEventListener("change", () => S.lastData && drawAlerts(S.lastData));
    $("alerts-q").addEventListener("input",
        debounce(() => S.lastData && drawAlerts(S.lastData), 150));

    // 매출 탭 엑셀 내보내기(필터 줄 버튼) — 조회 없는 클릭 배선이라 여기서 겁니다.
    $("sales-export").addEventListener("click", runSalesExport);

    // 리뷰 필터는 서버에서 걸러야 하므로 다시 받습니다.
    for (const id of ["rv-unanswered", "rv-drafts-only", "rv-platform", "rv-rating"]) {
        $(id).addEventListener("change", load);
    }

    // 창 크기 대신 카드 영역의 실제 너비를 봅니다.
    // 창 크기가 안 바뀌어도 칸 배치가 달라질 수 있기 때문입니다.
    const redraw = debounce(() => S.lastData && draw(S.lastData), 150);
    let lastWidth = 0;
    new ResizeObserver((entries) => {
        const width = Math.round(entries[0].contentRect.width);
        if (width && width !== lastWidth) { lastWidth = width; redraw(); }
    }).observe(document.querySelector(".grid"));

    // 영역·서브탭 전환은 숨김 해제뿐이라(nav.js) 위 ResizeObserver 에 안
    // 걸립니다. 숨긴 채 그려진 SVG 는 clientWidth=0 → fallback 폭(480·720)으로
    // 굳어, 첫 진입 화면에서 차트가 카드 절반만 채웁니다(H2, SALES-DIAGNOSIS).
    // 보이게 된 순간 폭이 어긋난 차트가 하나라도 있으면 한 번 다시 그립니다 —
    // 맞으면 아무것도 안 하므로 평상시 전환 비용은 없습니다.
    document.addEventListener("mitaly:area-shown", () => {
        if (!S.lastData) return;
        const stale = [...document.querySelectorAll("svg.plot")].some((svg) => {
            const vb = svg.viewBox.baseVal.width;
            return svg.clientWidth > 0 && vb > 0
                && Math.abs(svg.clientWidth - vb) > 2;
        });
        if (stale) draw(S.lastData);
    });

    // 홈 타일 배선과 지도 nav 배선은 조회가 없어(클릭 리스너뿐) 먼저 겁니다.
    initHomeTiles();
    initHome();
    initHomeHero();
    initBigtable();
    initDeliveryMap();

    // 보이는 화면(홈·매출)의 위 4칸을 먼저 그립니다. 안 보이는 20여 개 영역의
    // 첫 조회는 그 첫 그리기 뒤로 미룹니다 — 안 그러면 부팅 때 영역들이
    // 한꺼번에 조회를 던져 브라우저 연결(도메인당 6개)과 Supabase 를 나눠
    // 쓰느라 눈앞의 매출 4칸이 늦게 뜹니다(2026-08-14 실측: 부팅 rpc 60건
    // 중 35건이 지금 안 보이는 영역 몫이고, 그게 매출 4칸 조회보다 먼저 큐에
    // 실렸습니다). 첫 그리기 뒤에 시작하므로 영역 조회는 대시보드 나머지와
    // 겹쳐 돌아 예전만큼 일찍 채워지고, 매출 4칸만 먼저 자리를 차지합니다.
    // 홈 타일의 '업무·문의 수'가 먼저 차도록 그 둘을 앞에 둡니다. 나머지는
    // 원래 순서를 지킵니다. (수집 요청·계정 상태·내보내기 화면의 init 3개는
    // 3라운드 2차에서 화면과 함께 빠졌습니다 — 엑셀은 위 필터 줄 버튼이 대신.)
    await load(() => runAfterPaint([
        // 주차별 전사 카드(#114)는 매출 영역이지만 필터와 무관한 단발 조회라
        // load() 묶음이 아니라 여기서 한 번만 붑니다(필터 변경에 재조회 없음).
        // 매장 진단(#115)도 같은 이유 — 기준월 고르개는 카드가 직접 갖습니다.
        initDiagnosis,
        // 매장 대시보드(#112)·전매장 현황(#113)도 자체 고르개를 갖는 단발
        // 조회라 load() 묶음 밖입니다 — 필터 변경에 재조회하지 않습니다.
        initStoreDash, initAllStores,
        // 전사 추이 hero(#129)의 주간(90)·일별(95) 재료도 전 매장 고정의
        // 단발 조회입니다 — 월은 load() 의 api_monthly 를 접고, 연도·분기는
        // 전 기간 api_monthly 를 처음 고를 때 한 번 받습니다(카드 #139).
        initCompanyTrend,
        initTasks, initInquiries, initDrafts,
        initNotices, initVisits, initStoreDb, initAccountPresence,
        initLifecycle, initKakaoStats, initNotifications, initRecipients,
        initConsents, initSettlement, initAds, initIngredients,
        initOurhome, initIngStore, initPosMenu, initComms, initKpiSettings,
        initSettings,
    ]));
    loadLastUpdated();
}

// 보이는 화면을 그린 뒤, 안 보이는 영역들의 첫 조회를 몇 개씩 끊어 실행합니다.
// 브라우저 연결 상한이 자연히 몰림을 막지만, 무거운 영역(POS 는 조회 6개)이
// 한 틱에 겹치지 않게 나눕니다. 각 init 는 배선 + 첫 조회라, 하나가 실패해도
// 다른 영역으로 옮지 않게 감쌉니다.
function runAfterPaint(inits) {
    let i = 0;
    const pump = () => {
        const end = Math.min(i + 4, inits.length);
        for (; i < end; i++) {
            try { inits[i](); } catch (e) { console.error(e); }
        }
        if (i < inits.length) setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
}

// ---------------------------------------------------------------- (옛 수집 요청 화면)
//
// 수집 요청·러너 상태·계정 상태·수집용 매장 선택창 코드는 3라운드 2차에서
// 화면과 함께 내렸습니다(담당자 확정 — 자리 PC 가 매일 알아서 수집).
// 서버 쪽(collect_requests·runner_status·api_account_health·러너)은 전부
// 무변경이고, 웹에서 그리던 부분만 없습니다. 계정·러너 이상 경고는 홈
// 배너가 이어받습니다(다른 라운드 카드).

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

// load() 차례표. 늦게 끝난 옛 조회를 버리는 데 씁니다.
let loadSeq = 0;

// onFirstPaint 는 부팅 때 첫 그리기(위 4칸) 직후 한 번만 부르는 콜백입니다.
// 필터를 바꿀 때는 load 가 change 리스너로 직접 걸려 Event 가 넘어오므로,
// 함수일 때만 부릅니다(그 경우에만 영역 지연 조회를 시작).
async function load(onFirstPaint) {
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
        // ('전 품목' 카드가 3라운드 2차에서 내려가면서 api_all_items 호출도
        //  뺐습니다 — 2,600종짜리 가장 무거운 조회였습니다. 함수·SQL 은 그대로.)
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
        // (홈 전용 부정 리뷰·요약 호출은 3라운드 1번에서 홈이 매출 필터와
        //  무관해지며 loadHome 으로 옮겨 갔습니다 — 아래 '홈' 절.)
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

    // '매장 리뷰 보기'(카드 #132)의 검토 대기 초안 — 매장을 골랐을 때만
    // 받습니다. api_draft_summary 는 매장을 모르는 전체 합계라, 매장을 아는
    // 기존 rpc(api_pending_drafts, 14_reply_drafts.sql)를 재사용해 화면에서
    // 그 매장 것만 셉니다(dev·prod 대기분 수백 건 수준 — 1,000 상한 안).
    const pendingDrafts = args.p_store
        ? db.rpc("api_pending_drafts", { p_limit: 1000 })
            .then((r) => (r.error ? [] : ((r.data || [])[0] || {}).items || []))
            .catch(() => [])
        : Promise.resolve([]);

    // 화면 맨 위 4개(요약·월별추이·매장별·매장비교)를 먼저 받아 그리고,
    // 나머지는 그 뒤에 채웁니다.
    //
    // 왜: 전부 기다렸다 한 번에 그리면 뒤쪽의 무거운 조회 때문에 맨 위
    // 총매출까지 한참 못 봅니다(옛 '전 품목' 2,600종 시절 실측 20초+).
    // 사용자는 대개 위 몇 개만 보고 판단합니다. 받는 총량은 같지만
    // **보이기까지가 짧아집니다.**
    // 이 둘은 없어도 화면이 떠야 하는 것들이라 위 묶음에 안 넣었습니다.
    // 늦게 오면 2차 그리기에 반영됩니다.
    const pending = { draftSummary: {}, reviewSync: {}, pendingDrafts: [] };
    draftSummary.then((v) => { pending.draftSummary = v; });
    reviewSync.then((v) => { pending.reviewSync = v; });
    pendingDrafts.then((v) => { pending.pendingDrafts = v; });

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

    S.lastData = pack(results, args, pending);
    draw(S.lastData);

    // 위 4칸이 자리를 잡았으니, 안 보이는 영역들의 첫 조회를 이제 시작합니다
    // (부팅 첫 그리기 때만 — 필터 변경 땐 Event 라 typeof 로 걸러집니다).
    if (typeof onFirstPaint === "function") onFirstPaint();

    // 나머지. 여기서 실패해도 이미 그린 것은 지우지 않습니다 —
    // 위쪽 숫자는 멀쩡한데 화면을 통째로 비우면 더 나쁩니다.
    document.body.classList.add("loading-rest");
    const restError = await runInto(
        results, calls, calls.map((_, i) => i).filter((i) => !FIRST.includes(i)), 3);
    if (!stillMine()) return;
    document.body.classList.remove("loading-rest");
    if (restError) return fail(restError);

    S.lastData = pack(results, args, pending);
    draw(S.lastData);
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
        // 전 품목(구 15번)은 3라운드 2차에서 내렸고(담당자 확정), 홈 전용
        // 호출(구 19·20번)은 홈 재구성이 loadHome 으로 분리했습니다 — 두 제거를
        // 합치면 인덱스가 이렇게 당겨집니다. calls 배열과 짝이 맞아야 합니다.
        reviewSummary: ((d(15))[0] || {}).summary || {},
        reviews: ((d(16))[0] || {}).items || [],
        alerts: ((d(17))[0] || {}).alerts || [],
        compare: ((d(18))[0] || {}).compare || {},
        draftSummary: pending.draftSummary,
        reviewSync: pending.reviewSync,
        pendingDrafts: pending.pendingDrafts,
    };
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

    drawAlerts(d);
    drawReport(d);
    // 전사 추이 hero(#129) — 월 단위가 이 load() 의 api_monthly 를 접으므로
    // 필터 변경마다 같이 다시 그립니다(연도·분기·주간·일별은 자기 캐시).
    drawCompanyTrend();

    drawBars($("c-menu"), {
        rows: d.menus.slice(0, 15).map((r) => ({ label: r.menu, value: Number(r.amount) })),
        color: c.s1, horizontal: true, colors: c,
    });
    // 표가 기본 화면입니다(탭 정리 라운드) — 전 메뉴 순위표라 순위·비중을 답니다.
    const menuTotal = d.menus.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    table($("t-menu"), ["순위", "메뉴", "분류", "매출", "수량", "비중"],
        d.menus.map((r, i) => [int(i + 1), r.menu, catLabel(r.category),
            wonFull(r.amount), int(r.qty),
            menuTotal > 0 ? `${(Number(r.amount) / menuTotal * 100).toFixed(1)}%` : "—"]));

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
    drawReviews(d, c);
    drawUnmapped(d);
}

// ---- 전사 매출 추이 (카드 #129 — '전체 매장 요약' hero) -----------------
//
// 옛 품목·시간·요일·매장 서브탭을 합친 '전체 매장 요약' 화면의 답 카드.
// 단위 다섯(연도·분기·월·주간·일별)을 unitbtn 한 줄이 고릅니다
// (docs/web-hierarchy.md 5절). 월은 load() 가 이미 받는 api_monthly
// (전역 필터 기준)를 여기서 접고 — 새 조회 없음(report.js 의 연월 접기와
// 같은 규칙) —, 주간은 90(api_weekly_company)·일별은 95(api_daily_company
// — 홀/배달 분해)를 씁니다. **연도·분기는 전 기간 api_monthly 를 따로 한 번
// 받아 접습니다**(카드 #139) — 필터 기본값이 최근 한 달이라 필터 기준으로
// 접으면 행이 하나뿐이라 전년(전분기) 비교가 안 나오기 때문입니다. 전 기간·
// 전 매장·전 채널 고정 1회 조회(매장 대시보드 분기 카드의 캐시 전례)이고,
// 처음 그 단위를 고를 때 받아 캐시합니다(부팅 비용 없음 · 필터와 무관이라
// 무효화 불요). 실패하면 종전대로 필터 기준 접기로 폴백합니다.
// 두 rpc(90·95)는 전 매장·전 채널 고정의 단발 조회(주차별 카드 #114 전례)라
// 필터 변경에 다시 받지 않고,
// 단위마다 출처가 다른 것은 카드 각주가 말합니다(위계 문서 5절 규칙).
// 증감 색은 KPI 시트 관례(상승 빨강 wk-up · 하락 파랑 wk-down —
// docs/kpi-sheet-adoption.md, 옛 주차별 카드 그대로)입니다.

const COMPANY_DOW_KO = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일" };
const COMPANY_UNIT_PREV = { year: "전년", quarter: "전분기", month: "전월",
                            week: "전주", day: "전일" };

let companyUnit = "month";
let companyWeekly = null;   // api_weekly_company 응답(jsonb 스칼라)
let companyDaily = null;    // api_daily_company 응답(jsonb 스칼라)
let companyAllMonthly = null;   // 전 기간 api_monthly 행 (연도·분기 전용 캐시)
let companyAllLoading = false;  // 진행 중 조회 (중복 조회 방지)
let companyAllFailed = false;   // 실패 → 필터 기준 접기로 폴백(재시도 안 함)

// 연도·분기용 전 기간 재료를 (아직이면) 받아 옵니다. 그 단위를 처음 고를 때
// 한 번만 — 전 기간·전 매장·전 채널 고정이라 필터가 바뀌어도 유효합니다.
// 조회 파라미터는 load() 의 api_monthly 와 같고 범위만 데이터 전 구간
// (S.filterRange = api_filters 의 ym_min~ym_max)입니다.
function ensureCompanyAllMonthly() {
    if (companyAllMonthly || companyAllLoading || companyAllFailed) return;
    const range = S.filterRange || {};
    if (!range.max) { companyAllFailed = true; return; }
    companyAllLoading = true;
    db.rpc("api_monthly", { p_ym_from: range.min, p_ym_to: range.max,
                            p_store: null, p_channel: null })
        .then((r) => {
            companyAllLoading = false;
            if (r.error) companyAllFailed = true;
            else companyAllMonthly = r.data || [];
            if (companyUnit === "year" || companyUnit === "quarter") {
                drawCompanyTrend();
            }
        })
        .catch(() => {
            companyAllLoading = false;
            companyAllFailed = true;
            if (companyUnit === "year" || companyUnit === "quarter") {
                drawCompanyTrend();
            }
        });
}

// "2026-08-13" → "08/13" (옛 주차별 카드의 라벨 규칙 그대로).
const companyMd = (iso) => `${String(iso).slice(5, 7)}/${String(iso).slice(8, 10)}`;

// 전기 대비(%). 전기가 0이거나 없으면 null — 0 나눗셈·신규 기간 오탐 방지
// (18·19·90 과 같은 규칙).
function companyPct(cur, prev) {
    if (prev == null || !(Number(prev) > 0)) return null;
    return Math.round((Number(cur) - Number(prev)) / Number(prev) * 1000) / 10;
}

function companyPctCell(pct) {
    if (pct == null) return "—";
    const text = `${pct > 0 ? "+" : ""}${pct}%`;
    const cls = pct > 0 ? "wk-up" : pct < 0 ? "wk-down" : "";
    return cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text);
}

// api_monthly(채널별 한 줄 — ym·channel(홀/배달)·amount·qty)를 연·분기·월
// 묶음으로 접습니다. key 는 정렬용 숫자, label 은 화면 표기입니다.
function foldCompanyMonthly(rows, keyOf, labelOf) {
    const map = new Map();
    for (const r of rows || []) {
        const key = keyOf(Number(r.ym));
        const slot = map.get(key) || { key, amount: 0, qty: 0, hall: 0, delivery: 0 };
        const amt = Number(r.amount) || 0;
        slot.amount += amt;
        slot.qty += Number(r.qty) || 0;
        if (r.channel === "홀") slot.hall += amt;
        else slot.delivery += amt;
        map.set(key, slot);
    }
    return [...map.values()]
        .sort((a, b) => a.key - b.key)
        .map((s) => ({ ...s, label: labelOf(s.key) }));
}

// 연도·분기는 전 기간 캐시가 있으면 그걸(전년 비교가 항상 나옴), 아직이거나
// 실패면 필터 기준 재료를 접습니다. 월은 항상 필터 기준입니다.
function companyMonthlyRows() {
    const filtered = ((S.lastData || {}).monthly) || [];
    if (companyUnit === "year") {
        return foldCompanyMonthly(companyAllMonthly || filtered,
            (ym) => Math.floor(ym / 100), (y) => `${y}년`);
    }
    if (companyUnit === "quarter") {
        // 표기는 1분기~4분기(담당자 지시 — Q1 금지, 매장 대시보드 분기 카드 전례).
        return foldCompanyMonthly(companyAllMonthly || filtered,
            (ym) => Math.floor(ym / 100) * 10 + Math.ceil((ym % 100) / 3),
            (k) => `${Math.floor(k / 10)}년 ${k % 10}분기`);
    }
    return foldCompanyMonthly(filtered, (ym) => ym, (ym) => ymLabel(ym));
}

function initCompanyTrend() {
    for (const b of document.querySelectorAll("#company-units .unitbtn")) {
        b.addEventListener("click", () => {
            companyUnit = b.dataset.unit;
            for (const x of document.querySelectorAll("#company-units .unitbtn")) {
                x.classList.toggle("is-on", x === b);
            }
            drawCompanyTrend();
        });
    }
    // 주간·일별 재료 — 실패해도 화면이 죽지 않고 그 단위에만 안내가 남습니다
    // (90·95 미적용 프로젝트 대비, draftSummary 와 같은 태도). 26주·8주(56일)는
    // 반년 흐름을 보는 분량이고, 더 길게는 엑셀 내보내기 몫입니다.
    db.rpc("api_weekly_company", { p_weeks: 26 })
        .then((r) => {
            if (r.error) return;
            companyWeekly = Array.isArray(r.data) ? r.data[0] : r.data;
            if (companyUnit === "week") drawCompanyTrend();
        })
        .catch(() => { /* 위 주석 — 그 단위 안내문이 대신 남습니다 */ });
    db.rpc("api_daily_company", { p_days: 56 })
        .then((r) => {
            if (r.error) return;
            companyDaily = Array.isArray(r.data) ? r.data[0] : r.data;
            if (companyUnit === "day") drawCompanyTrend();
        })
        .catch(() => { /* 위 주석 */ });
    drawCompanyTrend();
}

function companyHeroStat(label, valueHtml, subHtml) {
    return `<div class="hero-stat"><div class="hs-label">${escape(label)}</div>`
        + `<div class="hero-num">${valueHtml}</div>`
        + (subHtml ? `<div class="hs-sub">${subHtml}</div>` : "")
        + "</div>";
}

function companyBadge(pct, label) {
    const badge = $("company-badge");
    if (pct == null) { badge.hidden = true; return; }
    badge.hidden = false;
    // 상태 3색 의미 고정(위계 문서 4절) — 급감선 -10%(hq-standards 의
    // 급증·급감 기준)만 조치 필요, 소폭 감소는 주의, 유지·증가는 정상.
    badge.className = "hero-badge "
        + (pct <= -10 ? "hb-critical" : pct < 0 ? "hb-attn" : "hb-good");
    badge.textContent =
        `${label || COMPANY_UNIT_PREV[companyUnit]} 대비 ${pct > 0 ? "+" : ""}${pct}%`;
}

// 진행 중인 마지막 연도·분기의 배지 값 — 부분 기간을 직전 완성 기간과
// 통비교하면 연초엔 전년 대비 -90% 같은 오탐 배지가 뜹니다(H3 — 진행 중인
// 달 오탐 방지와 같은 이유). 그래서 배지는 **완성된 달만 같은 자리끼리**
// 견줍니다: 연도는 전년의 같은 달들(동기간), 분기는 전분기의 같은 순서
// 달들. 마지막 기간이 이미 완성이면 표와 같은 직전 기간 통비교입니다.
// 표는 인접 행 대비 그대로(매장 대시보드 분기 카드 전례 — 각주가 진행 중
// 가능성을 말합니다).
function companyLongBadge(latest, prev) {
    const whole = { pct: companyPct(latest.amount, prev && prev.amount) };
    const isYear = companyUnit === "year";
    const byYm = new Map();
    for (const r of companyAllMonthly) {
        const ym = Number(r.ym);
        byYm.set(ym, (byYm.get(ym) || 0) + (Number(r.amount) || 0));
    }
    const t = new Date();
    const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
    const keyOf = (ym) => (isYear ? Math.floor(ym / 100)
        : Math.floor(ym / 100) * 10 + Math.ceil((ym % 100) / 3));
    // 마지막 기간의 완성된 달들(진행 중인 이번 달 제외, 오름차순).
    const done = [...byYm.keys()]
        .filter((ym) => keyOf(ym) === latest.key && ym < nowYm)
        .sort((a, b) => a - b);
    if (done.length === (isYear ? 12 : 3)) return whole;   // 이미 완성.
    if (!done.length) return { pct: null };
    let prevYms;
    if (isYear) {
        prevYms = done.map((ym) => ym - 100);
    } else {
        const prevQ = latest.key % 10 > 1 ? latest.key - 1
            : (Math.floor(latest.key / 10) - 1) * 10 + 4;
        const y = Math.floor(prevQ / 10);
        const q = prevQ % 10;
        prevYms = [q * 3 - 2, q * 3 - 1, q * 3]
            .slice(0, done.length).map((m) => y * 100 + m);
    }
    const sum = (yms) => yms.reduce((a, ym) => a + (byYm.get(ym) || 0), 0);
    return { pct: companyPct(sum(done), sum(prevYms)),
             label: isYear ? "전년 동기간" : "전분기 동기간" };
}

function drawCompanyTrend() {
    if (!$("company-card")) return;
    const c = palette();
    const stats = $("company-stats");
    const legendEl = $("legend-company");
    const svg = $("c-company");
    const tv = $("t-company");
    const note = $("company-note");

    const empty = (text) => {
        stats.innerHTML = "";
        legendEl.innerHTML = "";
        svg.hidden = true;
        companyBadge(null);
        tv.innerHTML = `<p class="hint">${escape(text)}</p>`;
        note.textContent = "";
    };
    const channelLegend = () => {
        legendEl.innerHTML =
            `<span><i style="background:${c.s1}"></i>홀</span>`
            + `<span><i style="background:${c.s2}"></i>배달</span>`;
    };

    if (companyUnit === "week") {
        const weeks = ((companyWeekly || {}).weeks) || [];
        if (!weeks.length) return empty("아직 주 단위 집계가 없습니다.");
        const latest = weeks[0];                    // 서버가 최신 주 먼저.
        const asc = [...weeks].reverse();
        const dowStart = COMPANY_DOW_KO[(companyWeekly || {}).week_start_dow] || "?";

        companyBadge(latest.wow_pct != null ? Number(latest.wow_pct) : null);
        stats.innerHTML =
            companyHeroStat("최근 주 전사 매출", escape(won(latest.amount)),
                `${escape(companyMd(latest.week_start))}~${escape(companyMd(latest.week_end))}`
                + ` (${escape(dowStart)}요일 시작) · ${escape(wonFull(latest.amount))}`)
            + companyHeroStat("주문수", escape(int(latest.orders)),
                `운영 ${escape(int(latest.store_count))}곳`)
            + companyHeroStat("지점당 매출",
                latest.per_store != null ? escape(won(latest.per_store)) : "—",
                "전사 매출 ÷ 운영 매장수");

        legendEl.innerHTML = "";
        svg.hidden = false;
        drawLine(svg, {
            xLabels: asc.map((w) => companyMd(w.week_start)),
            series: [{ name: "전사 매출", color: c.s1,
                       values: asc.map((w) => Number(w.amount) || 0) }],
            colors: c,
        });

        table(tv, ["주 시작일", "매출", "전주비", "주문수", "운영 매장수", "지점당"],
            weeks.map((w) => [
                `${escape(w.week_start)} ~ ${escape(companyMd(w.week_end))}`,
                escape(wonFull(w.amount)),
                companyPctCell(w.wow_pct != null ? Number(w.wow_pct) : null),
                escape(int(w.orders)),
                escape(int(w.store_count)),
                w.per_store != null ? escape(won(w.per_store)) : "—",
            ]),
            { html: true,
              export: { headers: ["주 시작일", "주 종료일", "매출", "전주비(%)",
                                  "주문수", "운영 매장수", "지점당"],
                        rows: weeks.map((w) => [w.week_start, w.week_end, w.amount,
                                                w.wow_pct, w.orders, w.store_count,
                                                w.per_store]) } });
        note.textContent = "주간·일별은 전 매장·전 채널 고정(위 필터와 무관) · "
            + "일 단위 집계 기준 · 운영 매장수 = 그 주 매출이 있는 매장 수";
        return;
    }

    if (companyUnit === "day") {
        const rows = ((companyDaily || {}).rows) || [];   // 오래된 날 먼저.
        if (!rows.length) return empty("아직 일 단위 집계가 없습니다.");
        const latest = rows[rows.length - 1];
        const prev = rows.length > 1 ? rows[rows.length - 2] : null;

        companyBadge(companyPct(latest.amount, prev && prev.amount));
        const dayLabel = (r) =>
            `${r.day} (${COMPANY_DOW_KO[r.dow] || "?"})`;
        stats.innerHTML =
            companyHeroStat("최근 일자 전사 매출", escape(won(latest.amount)),
                `${escape(dayLabel(latest))} · ${escape(wonFull(latest.amount))}`)
            + companyHeroStat("홀 / 배달",
                `${escape(won(latest.hall_amount))} / ${escape(won(latest.delivery_amount))}`,
                "홀 = 이지포스·아임유 매출 · 배달 = 배달앱 매출")
            + companyHeroStat("주문수", escape(int(latest.orders)),
                `운영 ${escape(int(latest.store_count))}곳`);

        channelLegend();
        svg.hidden = false;
        drawLine(svg, {
            xLabels: rows.map((r) => companyMd(r.day)),
            series: [
                { name: "홀", color: c.s1,
                  values: rows.map((r) => Number(r.hall_amount) || 0) },
                { name: "배달", color: c.s2,
                  values: rows.map((r) => Number(r.delivery_amount) || 0) },
            ],
            colors: c,
        });

        const desc = [...rows].reverse();           // 표는 최신 날 먼저.
        table(tv, ["일자", "매출", "전일비", "홀", "배달", "주문수", "운영 매장수"],
            desc.map((r, i) => [
                escape(dayLabel(r)),
                escape(wonFull(r.amount)),
                companyPctCell(companyPct(r.amount,
                    i + 1 < desc.length ? desc[i + 1].amount : null)),
                escape(wonFull(r.hall_amount)),
                escape(wonFull(r.delivery_amount)),
                escape(int(r.orders)),
                escape(int(r.store_count)),
            ]),
            { html: true,
              export: { headers: ["일자", "요일", "매출", "홀", "배달",
                                  "주문수", "운영 매장수"],
                        rows: desc.map((r) => [r.day, COMPANY_DOW_KO[r.dow] || "",
                                               r.amount, r.hall_amount,
                                               r.delivery_amount, r.orders,
                                               r.store_count]) } });
        note.textContent = "주간·일별은 전 매장·전 채널 고정(위 필터와 무관) · "
            + "일 단위 집계 기준 · 홀 = 이지포스·아임유, 배달 = 배민·쿠팡이츠·요기요 등";
        return;
    }

    // 연도·분기 — 전 기간 api_monthly 접기(위 캐시). 월 — 전역 필터
    // (기간·매장·채널) 기준의 api_monthly 접기.
    const isLong = companyUnit === "year" || companyUnit === "quarter";
    if (isLong) ensureCompanyAllMonthly();
    if (!S.lastData && !(isLong && companyAllMonthly)) return empty("집계 중…");
    const rows = companyMonthlyRows();
    if (!rows.length) return empty("데이터가 없습니다.");
    const latest = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const unitName = companyUnit === "year" ? "연도"
        : companyUnit === "quarter" ? "분기" : "월";

    if (isLong && companyAllMonthly) {
        // 진행 중인 마지막 연도·분기는 동기간 비교(companyLongBadge 주석).
        const b = companyLongBadge(latest, prev);
        companyBadge(b.pct, b.label);
    } else {
        companyBadge(companyPct(latest.amount, prev && prev.amount));
    }
    stats.innerHTML =
        companyHeroStat(`최근 ${unitName} 매출`, escape(won(latest.amount)),
            `${escape(latest.label)} · ${escape(wonFull(latest.amount))}`)
        + companyHeroStat("홀 / 배달",
            `${escape(won(latest.hall))} / ${escape(won(latest.delivery))}`,
            "홀 = 이지포스·아임유 매출 · 배달 = 배달앱 매출")
        + companyHeroStat("판매 수량", escape(int(latest.qty)),
            `${escape(latest.label)} 기준`);

    channelLegend();
    svg.hidden = false;
    drawLine(svg, {
        xLabels: rows.map((r) => r.label),
        series: [
            { name: "홀", color: c.s1, values: rows.map((r) => r.hall) },
            { name: "배달", color: c.s2, values: rows.map((r) => r.delivery) },
        ],
        colors: c,
    });

    const desc = [...rows].reverse();               // 표는 최신 기간 먼저.
    table(tv, [unitName, "매출", `${COMPANY_UNIT_PREV[companyUnit]}비`,
               "홀", "배달", "수량"],
        desc.map((r, i) => [
            escape(r.label),
            escape(wonFull(r.amount)),
            companyPctCell(companyPct(r.amount,
                i + 1 < desc.length ? desc[i + 1].amount : null)),
            escape(wonFull(r.hall)),
            escape(wonFull(r.delivery)),
            escape(int(r.qty)),
        ]),
        { html: true,
          export: { headers: [unitName, "매출", "홀", "배달", "수량"],
                    rows: desc.map((r) => [r.label, r.amount, r.hall,
                                           r.delivery, r.qty]) } });
    if (isLong && companyAllMonthly) {
        note.textContent = "연도·분기는 전 기간·전 매장·전 채널 고정"
            + `(위 필터와 무관) · 마지막 ${unitName}는 진행 중일 수 있음`;
    } else if (isLong && companyAllLoading) {
        note.textContent = "전체 기간 집계 중… (지금은 위 필터 기준)";
    } else if (isLong) {
        note.textContent = "전체 기간 조회 실패 — 위 기간·매장·채널 필터 기준";
    } else {
        note.textContent = "월만 위 기간·매장·채널 필터 기준 — "
            + "다른 단위는 전 매장 고정입니다.";
    }
}

// ---- 홈 (오늘 할 일 + 알아야 할 변화) ---------------------------------
//
// 3라운드 담당자 피드백 1번 — 홈은 "오늘 처리할 일 + 알아야 할 변화" 만 담고
// 매출 필터(기간·매장)와 **무관**하게 그립니다. 매출은 매출 탭에서 보므로
// 홈에는 필터 줄도 없습니다(nav.js showArea 가 숨김). 그래서 홈은 draw(d)
// 파이프라인이 아니라 여기 loadHome 이 전 매장 기준으로 따로 받습니다.
//   · 처리할 일 타일 — tasks.js(refreshTasksSummary)·inquiries.js 가 채우고
//     '승인 대기' 는 nav.js 가 업무 타일(tk-waiting)을 거울로 비춥니다.
//     'AI 답글 초안' 만 여기서 받습니다(api_draft_summary — 전체 기간).
//   · 매출 한 줄·급감 매장 — 기준월은 매출 기본값과 같은 '마지막 완성 월'
//     규칙(initDashboard 의 H3 주석): 진행 중인 달을 기준으로 잡으면 수집이
//     덜 끝나 전 매장이 급감으로 오탐합니다.
//   · 새 부정 리뷰 — 리뷰는 매출과 달리 지금도 들어오므로 이번 달 포함
//     최근 두 달을 봅니다(별점 3점 이하 — 리뷰 화면 '3점 이하만'과 같은 기준).
//   · 경고 배너 — loadHomeHealth(아래). 평소에는 안 보입니다.

let homeLoadedAt = 0;

// ---- 홈 hero — "지금 조치할 게 있나?" (카드 #118, docs/web-hierarchy.md) --
//
// 타일 5개(미처리·승인 대기·문의 검토·초안 검토·진단 대상)의 합을 한 숫자로
// 먼저 답합니다. 값은 여러 모듈이 비동기로 채우므로(app/tasks/inquiries/
// diagnosis) 조회를 더 하지 않고 타일 숫자를 관찰해 따라갑니다(nav.js 의
// tk-waiting 거울과 같은 방식).

const HOME_HERO_PARTS = [
    ["home-tasks", "미처리 업무"],
    ["home-approvals", "승인 대기"],
    ["home-inquiry", "문의 답변 검토"],
    ["home-drafts", "답글 초안 검토"],
    ["home-diag", "진단 대상"],
];

function updateHomeHero() {
    const numEl = $("home-hero-num");
    const badge = $("home-hero-badge");
    const facts = $("home-hero-facts");
    let total = 0;
    let loaded = 0;
    const parts = [];
    for (const [id, label] of HOME_HERO_PARTS) {
        const raw = ($(id).textContent || "").replace(/[^\d]/g, "");
        if (raw === "") continue;   // 아직 집계 전("—")
        loaded += 1;
        const n = Number(raw);
        total += n;
        if (n > 0) parts.push(`${escape(label)} <b>${int(n)}</b>`);
    }
    if (!loaded) {
        numEl.textContent = "—";
        badge.hidden = true;
        facts.textContent = "집계 중…";
        return;
    }
    numEl.textContent = `${int(total)}건`;
    // 미처리 업무(기준일 초과)가 있으면 조치 필요 — 타일의 급함 구분
    // (t-urgent/t-attn)과 같은 눈금입니다.
    const overdue = Number(($("home-tasks").textContent || "").replace(/[^\d]/g, "")) > 0;
    badge.hidden = false;
    badge.className = "hero-badge "
        + (total === 0 ? "hb-good" : overdue ? "hb-critical" : "hb-attn");
    badge.textContent = total === 0 ? "없음" : overdue ? "조치 필요" : "확인 필요";
    facts.innerHTML =
        (parts.length ? parts.join(" · ") : "미처리·검토 대기·진단 대상 모두 0건")
        + (loaded < HOME_HERO_PARTS.length ? " · 일부 집계 중" : "");
}

function initHomeHero() {
    const refresh = debounce(updateHomeHero, 120);
    new MutationObserver(refresh).observe($("home-tiles"), {
        childList: true, characterData: true, subtree: true,
    });
    updateHomeHero();
}

function initHome() {
    // 홈에 들어올 때마다 신선하면 그대로 두고, 오래됐으면 다시 받습니다.
    // 부팅 착지가 홈이면 첫 area-shown 이벤트는 이미 지나갔으므로(nav.js
    // initAreas 가 먼저 돎) 지금 상태(S.area)를 직접 봅니다.
    document.addEventListener("mitaly:area-shown", (e) => {
        if ((e.detail || {}).area === "home") loadHome();
    });
    if (S.area === "home") loadHome();
}

async function loadHome() {
    if (Date.now() - homeLoadedAt < 10 * 60_000) return;
    homeLoadedAt = Date.now();
    loadHomeHealth();

    // 'AI 답글 초안 검토' 타일. draw 파이프라인(draftSummary)과 같은 함수지만
    // 홈은 필터 변경과 무관해 이 타일 몫 한 번이면 됩니다.
    db.rpc("api_draft_summary", {})
        .then((r) => {
            const s = (r.error ? {} : ((r.data || [])[0] || {}).summary) || {};
            $("home-drafts").textContent = int(Number(s.draft) || 0);
        })
        .catch(() => { /* 14_reply_drafts.sql 적용 전 — 타일만 '—' 로 남습니다 */ });

    const range = S.filterRange || {};
    if (!range.max) return;   // 데이터 없음 — initDashboard 가 이미 안내합니다
    const t = new Date();
    const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
    // '마지막 완성 월' — 진행 중인 달이 올라와 있으면 전월로 물립니다(H3).
    const baseYm = (range.max >= nowYm && range.max > range.min)
        ? shiftYm(range.max, -1) : range.max;
    const reviewFromYm = shiftYm(nowYm, -1);

    const [cmpRes, alertRes, negRes, negSumRes] = await Promise.all([
        db.rpc("api_sales_compare", { p_ym: baseYm, p_store: null }),
        db.rpc("api_sales_alerts", { p_ym: baseYm, p_store: null }),
        // 서버가 ≤3 만 골라 주므로 limit 이 부정 리뷰 자체에 걸립니다.
        db.rpc("api_reviews", {
            p_ym_from: reviewFromYm, p_ym_to: nowYm, p_store: null,
            p_platform: null, p_unanswered_only: false,
            p_min_rating: null, p_max_rating: 3, p_limit: 50,
        }),
        // 전수 집계(by_rating) — 목록 limit 과 무관하게 '외 N건' 이 정확하도록.
        db.rpc("api_review_summary", {
            p_ym_from: reviewFromYm, p_ym_to: nowYm,
            p_store: null, p_platform: null,
        }),
    ]);
    // 실패한 채로 10분을 묵히지 않습니다 — 다음 홈 진입이 다시 시도합니다.
    if (cmpRes.error || alertRes.error || negRes.error || negSumRes.error) {
        homeLoadedAt = 0;
    }

    drawHomeSales(cmpRes, baseYm);
    drawHomeDeclining(alertRes, baseYm);
    drawHomeNegReviews(negRes, negSumRes);
}

// 6행 넘으면 '외 N건 더 보기'로 잘렸음을 알립니다(조용한 잘림 방지).
// 클릭 규칙은 행과 같고(nav.js 위임) data-store 가 없어 전체 목록으로 갑니다.
function homeMoreRow(n, go, kind, card) {
    return n > 0
        ? `<button type="button" class="home-anom-row home-anom-more" data-go="${go}" data-kind="${kind}" data-card="${card}">외 ${int(n)}건 더 보기</button>`
        : "";
}

function drawHomeSales(res, baseYm) {
    const el = $("home-sales-line");
    if (res.error) {
        $("home-sales-sub").textContent = "";
        el.innerHTML = `<span class="home-anom-empty">불러오지 못했습니다: ${escape(res.error.message || res.error)}</span>`;
        return;
    }
    const cmp = ((res.data || [])[0] || {}).compare || {};
    const co = cmp.company || {};
    // '전 매장 · 매출 탭 필터와 무관' 을 명시합니다(담당자 피드백) — 매출
    // 탭에서 매장을 좁혀 두고 와도 이 줄은 항상 회사 전체 기준입니다.
    $("home-sales-sub").textContent =
        `${ymLabel(cmp.ym || baseYm)} 마감분 · 전 매장 — 매출 탭 필터와 무관`;
    el.innerHTML =
        `<span class="hs-amount">${won(co.amount)}</span>`
        + `<span class="hs-cmp">전월(${ymLabel(cmp.prev_mom_ym)}) 대비 <b class="${pctClass(co.mom_pct_change)}">${pctText(co.mom_pct_change)}</b></span>`
        + `<span class="hs-cmp">전년동월 대비 <b class="${pctClass(co.yoy_pct_change)}">${pctText(co.yoy_pct_change)}</b></span>`
        + `<span class="hs-go">매출 탭에서 자세히 →</span>`;
}

function drawHomeDeclining(res, baseYm) {
    const listEl = $("home-anom-declining");
    if (res.error) {
        $("home-declining-h").textContent = "";
        listEl.innerHTML = `<p class="home-anom-empty">불러오지 못했습니다: ${escape(res.error.message || res.error)}</p>`;
        return;
    }
    const alerts = ((res.data || [])[0] || {}).alerts || [];

    // 급감은 매장 단위로 묶습니다 — 한 매장이 홀·배달 둘 다 급감이어도
    // 머리글 "1곳" 에 목록도 1행이 되게(수 = 행 수 기준 일치, 직전 라운드 유지).
    const declByStore = new Map();
    for (const s of alerts) {
        for (const ch of (s.channels || [])) {
            let hit = null;
            if (ch.mom_direction === "급감") hit = { channel: ch.channel, pct: ch.mom_pct_change, base: "전월" };
            else if (ch.yoy_direction === "급감") hit = { channel: ch.channel, pct: ch.yoy_pct_change, base: "전년동월" };
            if (!hit) continue;
            if (!declByStore.has(s.store)) declByStore.set(s.store, []);
            declByStore.get(s.store).push(hit);
        }
    }
    const declRows = [...declByStore.entries()].map(([store, hits]) => ({
        store,
        channels: hits.map((h) => h.channel).join("·"),
        // 채널이 여럿이면 가장 크게 빠진 쪽을 대표로 보입니다.
        worst: hits.reduce((a, b) => (Number(b.pct) < Number(a.pct) ? b : a)),
    }));

    $("home-declining-h").textContent =
        `${int(declRows.length)}곳 · ${ymLabel(baseYm)} 기준`;

    // '무엇이 이상인지' 가 행에서 문장으로 읽히게 — "배달 매출이 전월 대비 -N%".
    // 행 클릭은 nav.js(initHomeTiles)가 위임으로 이어 매출 화면을 그 매장으로
    // 좁혀 줍니다(data-store).
    listEl.innerHTML = declRows.length
        ? declRows.slice(0, 6).map((r) =>
            `<button type="button" class="home-anom-row" data-go="sales" data-kind="alert" data-card="alerts-card" data-store="${escape(r.store)}">
               <span class="ar-main">${escape(r.store)}</span>
               <span class="ar-side">${escape(r.worst.channel)} 매출이 ${escape(r.worst.base)} 대비 <b class="pct-down">${pctText(r.worst.pct)}</b>${r.channels.includes("·") ? ` (${escape(r.channels)} 모두 급감)` : ""}</span>
             </button>`).join("") + homeMoreRow(declRows.length - 6, "sales", "alert", "alerts-card")
        : '<p class="home-anom-empty">급감으로 판정된 매장이 없습니다.</p>';
}

function drawHomeNegReviews(negRes, sumRes) {
    const listEl = $("home-anom-reviews");
    if (negRes.error) {
        $("home-reviews-h").textContent = "";
        listEl.innerHTML = `<p class="home-anom-empty">불러오지 못했습니다: ${escape(negRes.error.message || negRes.error)}</p>`;
        return;
    }
    // 부정 리뷰 = 별점 3점 이하(앱 공통 정의). 새로 들어온 순으로 보입니다.
    const rows = (((negRes.data || [])[0] || {}).items || [])
        .filter((r) => Number(r.rating) <= 3)
        .sort((a, b) => String(b.written_at || "").localeCompare(String(a.written_at || "")));

    // 전수는 요약(by_rating)으로 셉니다 — 목록은 limit 에 걸릴 수 있습니다.
    // 요약이 실패하면 목록 수로라도 채웁니다(없는 것보다 낫습니다).
    const byRating = (sumRes.error ? []
        : (((sumRes.data || [])[0] || {}).summary || {}).by_rating) || [];
    const negative = byRating
        .filter((r) => Number(r.rating) <= 3)
        .reduce((sum, r) => sum + (Number(r.count) || 0), 0) || rows.length;

    $("home-reviews-h").textContent =
        `${int(negative)}건 · 최근 두 달 · 별점 3점 이하`;

    const md = (iso) => {
        const when = new Date(iso);
        return Number.isNaN(when.getTime()) ? "" : `${when.getMonth() + 1}/${when.getDate()}`;
    };
    // '왜 떴는지' 를 행이 문장으로 알립니다 — 언제 들어온 몇 점짜리 리뷰인지.
    listEl.innerHTML = rows.length
        ? rows.slice(0, 6).map((r) =>
            `<button type="button" class="home-anom-row" data-go="reviews" data-kind="review" data-card="review-card" data-store="${escape(r.store || "")}">
               <span class="ar-main">${escape(r.store || "")} — ${md(r.written_at)} <span class="ar-star">★${r.rating ?? "—"}</span> 새 리뷰</span>
               <span class="ar-side ar-text">${escape(clip(r.contents || "내용 없음", 34))}</span>
             </button>`).join("")
          + homeMoreRow(negative - Math.min(6, rows.length), "reviews", "review", "review-card")
        : '<p class="home-anom-empty">최근 두 달에 새로 들어온 부정 리뷰가 없습니다.</p>';
}

// ---- 홈 경고 배너 (수집·계정 이상 신호 통합 — 담당자 확정) -------------
//
// 계정 점검(34_account_health)에 '실패' 가 있거나 수집 PC heartbeat
// (runner_status.last_seen_at)이 24시간 이상 끊겼을 때만 홈 맨 위에 보입니다.
// 평소에는 안 보입니다. 수집 탭이 없어져 이 배너가 유일한 신호이고, 러너는
// 퇴근 시 절전이 정상 운영이라(CLAUDE.md 실수 18의 전제 변경) 기준을 2분이
// 아니라 24시간으로 넉넉히 둡니다 — 긴 작업 중 heartbeat 공백 오판도 이
// 여유가 막습니다.
//
// 채널 표기를 PLUGIN_LIST(수집 화면)와 따로 두는 이유: 수집 화면 코드는
// 병렬 개편에서 움직이므로 홈이 그쪽 상수를 붙들지 않습니다.

const HOME_CHANNEL_NAMES = {
    easypos: "이지포스", baemin: "배달의민족", imu: "아임유",
    coupangeats: "쿠팡이츠", yogiyo: "요기요", naver: "네이버",
};

async function loadHomeHealth() {
    const el = $("home-warn");
    const [healthRes, runnerRes] = await Promise.all([
        db.rpc("api_account_health").catch((e) => ({ error: e })),
        db.from("runner_status").select("last_seen_at").limit(1)
            .then((r) => r, (e) => ({ error: e })),
    ]);

    const msgs = [];

    const health = (healthRes && !healthRes.error && healthRes.data) || {};
    const fails = (health.results || []).filter((r) => r.status === "fail");
    if (fails.length) {
        const names = [...new Set(fails.map((f) =>
            HOME_CHANNEL_NAMES[f.channel] || f.channel))].join("·");
        msgs.push(`수집 계정 이상 — ${names} 로그인 확인 실패. `
            + "그 채널의 매출·리뷰가 안 들어오고 있을 수 있습니다.");
    }

    const runnerRow = (runnerRes && !runnerRes.error
        && (runnerRes.data || [])[0]) || null;
    if (runnerRow && runnerRow.last_seen_at) {
        const ageH = (Date.now() - new Date(runnerRow.last_seen_at).getTime()) / 3600_000;
        if (ageH >= 24) {
            const ago = ageH >= 48 ? `${Math.floor(ageH / 24)}일` : `${Math.round(ageH)}시간`;
            msgs.push(`수집 PC 무응답 — 마지막 응답이 ${ago} 전입니다. `
                + "자리 PC가 켜져 있는지 확인이 필요합니다.");
        }
    }

    if (!msgs.length) {
        el.hidden = true;
        return;
    }
    el.innerHTML = msgs.map((m) => `<p>⚠️ ${escape(m)}</p>`).join("");
    el.hidden = false;
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
        // 저별점 = 3점 이하. 홈 '부정 리뷰' 타일·이상신호 목록과 같은 기준
        // 이어야 타일 숫자와 눌러서 도착한 목록이 맞습니다(옛 값 4는 4점
        // 리뷰가 섞여 헤드라인과 목록이 어긋났습니다).
        p_max_rating: rating === "low" ? 3 : null,
    };
}

function ratingStars(value) {
    const n = Math.round(Number(value) || 0);
    return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

// ---- 매장 리뷰 보기 (카드 #132 — 리뷰 탭의 '매장 대시보드'식 매장 보기) ----
//
// 새 조회 없이 load() 가 이미 받아 온 요약(api_review_summary — f-store 로
// 좁혀진 것)을 매장 단면 카드로 그립니다. 부정 리뷰 기준은 앱 공통의
// '3점 이하'(홈 타일·이상신호·rv-rating 과 같은 기준)입니다. 검토 대기
// 초안만 매장을 아는 api_pending_drafts(전체 기간)에서 셉니다 — 기간 필터와
// 기준이 다른 것을 타일 각주가 말합니다.

function drawReviewStoreView(d, c) {
    const store = $("f-store").value;
    // 미러 — 필터 줄·홈 이상신호 행에서 f-store 가 바뀌어도 콤보가 따라갑니다.
    if ($("rv-store").value !== store) $("rv-store").value = store;

    const kpis = $("rvs-kpis");
    if (!store) {
        $("rvs-meta").textContent = "";
        kpis.innerHTML = '<div class="sd-empty">매장을 선택하세요 — 위 매장 칸에 '
            + "이름을 치면 검색되고, 아래 리뷰 목록도 그 매장으로 좁혀집니다.</div>";
        $("rvs-bars").innerHTML = "";
        $("t-rvs-platform").innerHTML = "";
        $("rvs-note").textContent = "";
        return;
    }

    const s = d.reviewSummary || {};
    const total = Number(s.total) || 0;
    const byRating = s.by_rating || [];
    const negative = byRating
        .filter((r) => Number(r.rating) <= 3)
        .reduce((a, r) => a + (Number(r.count) || 0), 0);
    const mine = (d.pendingDrafts || []).filter((x) => x.store === store);
    const draftWait = mine.filter((x) => x.status === "draft").length;
    const draftApproved = mine.filter((x) => x.status === "approved").length;

    $("rvs-meta").textContent =
        `${store} · ${ymLabel(d.args.p_ym_from)} ~ ${ymLabel(d.args.p_ym_to)}`;

    const tile = (label, value, sub, cls) =>
        `<div class="tile${cls ? " " + cls : ""}"><div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${sub}</div>` : "") + "</div>";
    kpis.innerHTML = [
        tile("리뷰", `${int(total)}건`,
            total ? `평균 ${escape(String(s.avg_rating ?? "—"))}점` : "이 기간 리뷰 없음"),
        tile("부정 리뷰 (3점 이하)", `${int(negative)}건`, "",
            negative > 0 ? "t-attn" : ""),
        tile("미답변", `${int(Number(s.unanswered) || 0)}건`, ""),
        tile("검토 대기 초안", `${int(draftWait)}건`,
            `승인됨 ${int(draftApproved)}건 · 전체 기간 기준`),
    ].join("");

    // 별점 분포 — 아래 목록 카드의 rv-bars 와 같은 문법(같은 요약 데이터).
    const max = Math.max(1, ...byRating.map((r) => Number(r.count) || 0));
    $("rvs-bars").innerHTML = byRating.length
        ? '<div class="rvbars">' + byRating.map((r) => {
            const n = Number(r.count) || 0;
            return `<div class="rvbar"><span class="rvbar-label">${ratingStars(r.rating)}</span>`
                + `<span class="rvbar-track"><i style="width:${(n / max) * 100}%;`
                + `background:${c.s1}"></i></span>`
                + `<span class="rvbar-count">${int(n)}</span></div>`;
        }).join("") + "</div>"
        : "";

    // 채널별 건수 (api_review_summary 의 by_platform 그대로).
    const byPlatform = s.by_platform || [];
    if (byPlatform.length) {
        table($("t-rvs-platform"), ["플랫폼", "리뷰", "미답변"],
            byPlatform.map((p) => [p.platform, int(p.count), int(p.unanswered)]));
    } else {
        $("t-rvs-platform").innerHTML = "";
    }

    $("rvs-note").textContent =
        "기간·플랫폼은 위 필터를 따르고, 아래 리뷰 목록도 이 매장으로 좁혀져 있습니다.";
}

function drawReviews(d, c) {
    drawReviewStoreView(d, c);
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

    // 다시 그려도 보던 자리를 잃지 않게 목록 스크롤을 보존합니다.
    // (초안 승인·전송이 load() 로 전체를 다시 받아 오기 때문)
    // load() 의 1차 그리기는 리뷰가 빈 상태로 지나가므로(위 FIRST 4칸),
    // 진짜 목록이 그려져 있을 때의 값만 기억해 2차에서 되살립니다.
    const listEl = $("rv-list");
    if (listEl.querySelector(".rvitem")) rvListScroll = listEl.scrollTop;

    // 슬라이드 패널이 리뷰를 id 로 다시 찾을 색인. 필터로 목록에서 빠진
    // 리뷰도 남게 rows(초안만 필터 적용본)가 아니라 받은 전체를 씁니다.
    reviewIndex = new Map((d.reviews || []).map((r) => [Number(r.id), r]));

    if (!rows.length) {
        listEl.innerHTML = '<p class="hint">조건에 맞는 리뷰가 없습니다.</p>';
        refreshDraftPanel();
        return;
    }

    listEl.innerHTML = rows.map((r) => {
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
            ${(r.drafts || []).length
                ? `<div class="rvopen-wrap"><button type="button" class="ghost rvopen"
                       data-review="${Number(r.id)}">AI 답변 시안 보기${r.drafts.length > 1 ? ` · ${r.drafts.length}건` : ""}</button></div>`
                : draftStateNote(r, replies)}
          </article>`;
    }).join("");

    listEl.scrollTop = rvListScroll;
    refreshDraftPanel();
}

// 초안이 없는 리뷰의 시안 상태 한 줄 (#143 — 담당자: "미답변인 모든 리뷰에서
// 보여야 해"). 그전에는 r.drafts 가 없으면 아무것도 안 그려서, 생성기(자리 PC
// Ollama)가 안 돌던 날 미답변 리뷰가 전부 침묵했습니다. 화면이 상태를 말합니다.
// · 답글이 이미 있으면: 시안이 필요 없는 리뷰 — 그대로 아무것도 안 붙입니다.
// · 미답변 + 기한 안(can_reply ≠ false): "AI 시안 준비 전" — 생성기가 아직
//   안 만든 것. null 은 기한 정보를 안 주는 채널이라 준비 전으로 칩니다
//   (14_reply_drafts.sql api_reply_candidates 의 coalesce(can_reply, true) 와
//   같은 판정 — 생성기가 대상으로 삼는 리뷰와 정확히 같은 집합).
// · 미답변 + 기한 지남(can_reply === false): 생성기 대상이 아니라 "준비 전" 은
//   거짓말이 됩니다. "답글 기한 지남" 으로 갈라 적습니다.
// 버튼이 아니라 글자(rvmeta 비활성 톤)입니다 — 여기서 눌러 생성을 요청하는
// 길은 서버 rpc 가 없어 이번에는 안 만듭니다(보고서 '서버 측 후속').
function draftStateNote(r, replies) {
    if (replies.length) return "";
    const text = r.can_reply === false ? "답글 기한 지남 · AI 시안 없음" : "AI 시안 준비 전";
    return `<div class="rvopen-wrap"><span class="rvmeta">${text}</span></div>`;
}

// ---- AI 답글 초안 ------------------------------------------------------
//
// '승인' 은 "등록해도 좋다" 는 표시, '전송' 은 발송 큐에 올려 자리 PC 가 실제로
// 등록하게 하는 것입니다(QUEUE #94). 전송해도 라이브 스위치가 켜지기 전까지는
// 자리 PC 가 큐만 잡고 등록은 담당자 입회 뒤에 열립니다 — 그 게이트는 러너와
// DB(review_dispatch_config)에 있습니다(D9). '발송 취소' 로 큐에서 뺄 수 있습니다.
//
// 시안은 목록 안이 아니라 우측 슬라이드 패널에서 봅니다(담당자 지시
// 2026-08-16 ⑦) — 목록의 'AI 답변 시안 보기' 버튼이 열고, 확인·수정·승인·
// 전송을 그 안에서 끝냅니다. 검토 함수 호출 경로는 그대로이고 그리는 자리만
// 옮긴 것입니다.

// drawReviews() 가 받은 리뷰를 id 로 다시 찾는 색인과, 지금 패널이 보여 주는
// 리뷰 id. load() 가 목록을 다시 그려도 이 둘로 패널 내용을 이어 갑니다.
let reviewIndex = new Map();
let panelReviewId = null;
let rvListScroll = 0;      // 마지막으로 실제 목록이 있던 때의 스크롤 위치

function openDraftPanel(reviewId) {
    panelReviewId = reviewId;
    $("rvpanel-msg").textContent = "";
    $("rvpanel-msg").className = "rvpanel-msg";
    renderDraftPanel();

    const backdrop = $("rvpanel-backdrop");
    const panel = $("rvpanel");
    backdrop.hidden = false;
    panel.hidden = false;
    // hidden 해제와 같은 프레임에 .open 을 붙이면 transition 이 안 돕니다.
    requestAnimationFrame(() => {
        backdrop.classList.add("open");
        panel.classList.add("open");
    });
    $("rvpanel-close").focus();
}

function closeDraftPanel() {
    if (panelReviewId === null) return;
    panelReviewId = null;
    const backdrop = $("rvpanel-backdrop");
    const panel = $("rvpanel");
    backdrop.classList.remove("open");
    panel.classList.remove("open");
    // 슬라이드가 빠져나간 뒤에 숨깁니다(styles.css 의 0.22s 와 짝).
    setTimeout(() => {
        if (panelReviewId !== null) return;   // 그 사이 다시 열림
        backdrop.hidden = true;
        panel.hidden = true;
    }, 230);
}

// 패널 본문을 reviewIndex 의 현재 데이터로 그립니다. 열려 있지 않으면 아무
// 것도 안 합니다 — drawReviews() 가 매번 불러 목록과 패널을 같이 맞춥니다.
// ⚠️ 색인에 없다고 닫지 않습니다: load() 의 1차 그리기는 리뷰가 아직 안 온
// 빈 상태로도 오고(위 FIRST 4칸), 그때 닫으면 승인 한 번에 패널이 사라집니다.
// 들고 있던 내용을 그대로 두면 2차 그리기가 맞춥니다.
function refreshDraftPanel() {
    if (panelReviewId === null) return;
    if (!reviewIndex.has(panelReviewId)) return;
    renderDraftPanel();
}

function renderDraftPanel() {
    const r = reviewIndex.get(panelReviewId);
    if (!r) return;
    const when = r.written_at
        ? new Date(r.written_at).toLocaleDateString("ko-KR",
            { year: "2-digit", month: "2-digit", day: "2-digit" })
        : "";
    const drafts = r.drafts || [];
    $("rvpanel-body").innerHTML = `
        <div class="rvpanel-review">
            <div class="rvhead">
              <span class="rvstars">${ratingStars(r.rating)}</span>
              <span class="rvscore">${r.rating ?? "—"}</span>
              <span class="rvmeta">${escape(r.store || "")} · ${escape(r.platform || "")} · ${when}</span>
            </div>
            ${r.contents ? `<p class="rvbody">${escape(r.contents)}</p>` : ""}
            ${(r.replies || []).map((x) => `<div class="rvreply"><b>답글</b> ${escape(x.contents || "")}</div>`).join("")}
        </div>
        ${drafts.length ? drafts.map(draftBox).join("")
            : '<p class="hint">이 리뷰에 남은 시안이 없습니다.</p>'}`;
}

const DRAFT_STATUS = {
    draft: "검토 대기",
    approved: "승인됨",
    scheduled: "발송 대기",
    posting: "등록 중",
    posted: "등록 완료",
    failed: "등록 실패",
    rejected: "반려",
};

// 등록이 끝났거나 진행 중이라 사람이 더는 못 건드리는 상태
const DRAFT_LOCKED = ["posting", "posted", "failed"];

function draftBox(draft) {
    const status = draft.status || "draft";
    const hardLocked = DRAFT_LOCKED.includes(status);
    const queued = status === "scheduled";        // 발송 큐 — 취소만 됩니다
    const editable = !hardLocked && !queued;       // draft / approved
    const label = DRAFT_STATUS[status] || status;
    const cls = status === "approved" ? " ok" : queued ? " sent" : "";

    let actions = "";
    if (editable) {
        // '승인' 은 아직 검토 안 끝난 초안(draft)에만. 이미 승인된 것은 '전송'만
        // 하면 됩니다.
        actions = `<div class="rvdraft-actions">
          <button type="button" data-act="send">전송</button>
          ${status === "draft"
            ? '<button type="button" class="ghost" data-act="approve">승인</button>' : ""}
          <button type="button" class="ghost" data-act="save">수정 저장</button>
          <button type="button" class="ghost" data-act="reject">반려</button>
          <span class="rvdraft-msg"></span>
        </div>`;
    } else if (queued) {
        actions = `<div class="rvdraft-actions">
          <button type="button" class="ghost" data-act="cancel">발송 취소</button>
          <span class="rvdraft-msg"></span>
        </div>`;
    }

    return `<div class="rvdraft${cls}" data-draft="${draft.id}">
        <div class="rvdraft-head">
          <span class="tag">AI 초안</span>
          <span class="rvmeta">${escape(label)}</span>
        </div>
        <textarea class="rvdraft-text" rows="3"${editable ? "" : " readonly"}
                  aria-label="답글 초안">${escape(draft.contents || "")}</textarea>
        ${actions}
      </div>`;
}

// 버튼은 다시 그릴 때마다 새로 생깁니다. 컨테이너에 한 번만 걸어 둡니다.
function initDrafts() {
    // 목록 쪽은 패널 열기만 담당합니다.
    $("rv-list").addEventListener("click", (event) => {
        const open = event.target.closest("button.rvopen");
        if (open) openDraftPanel(Number(open.dataset.review));
    });

    // 닫기 3종 — X · 배경 클릭 · ESC.
    $("rvpanel-close").addEventListener("click", closeDraftPanel);
    $("rvpanel-backdrop").addEventListener("click", closeDraftPanel);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && panelReviewId !== null) closeDraftPanel();
    });

    // 시안 조작(승인·전송·수정·반려·발송취소)은 패널 안에서만 일어납니다.
    $("rvpanel-body").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;

        const box = button.closest("[data-draft]");
        const id = Number(box.dataset.draft);
        const act = button.dataset.act;
        const message = box.querySelector(".rvdraft-msg");
        const buttons = [...box.querySelectorAll("button")];

        let reason = null;
        if (act === "reject") {
            reason = window.prompt("반려 사유를 적어 주세요 (비워도 됩니다).\n"
                + "반려하면 이 리뷰는 다음 초안 생성 때 다시 씁니다.", "");
            if (reason === null) return;   // 취소
        }
        if (act === "send"
            && !window.confirm("이 답글을 전송할까요?\n"
                + "발송 큐에 올라가고 자리 PC가 배달앱에 등록합니다.")) {
            return;
        }

        buttons.forEach((b) => { b.disabled = true; });
        message.className = "rvdraft-msg";
        message.textContent = "처리 중…";
        $("rvpanel-msg").textContent = "";
        $("rvpanel-msg").className = "rvpanel-msg";

        const call = act === "approve"
            ? db.rpc("approve_reply_draft", { p_draft_id: id })
            : act === "reject"
                ? db.rpc("reject_reply_draft", { p_draft_id: id, p_reason: reason })
                : act === "send"
                    ? db.rpc("send_reply_draft", { p_draft_id: id })
                    : act === "cancel"
                        ? db.rpc("cancel_send_reply_draft", { p_draft_id: id })
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

        const doneText = act === "approve" ? "승인했습니다"
            : act === "reject" ? "반려했습니다"
            : act === "cancel" ? "발송을 취소했습니다"
            : act === "send"
                ? (data && data.consent === false
                    ? "전송했습니다 · 동의서 등록 뒤 자리 PC가 올립니다"
                    : "전송했습니다 · 자리 PC가 등록합니다")
                : "저장했습니다";
        message.className = "rvdraft-msg ok";
        message.textContent = doneText;

        await load();     // 목록·요약을 다시 받습니다 (패널도 같이 다시 그려짐)

        // 다시 그린 패널에 결과를 남깁니다. 반려처럼 시안 상자가 사라진
        // 경우는 패널 머리의 공용 자리에 씁니다.
        const fresh = $("rvpanel-body")
            .querySelector(`[data-draft="${id}"] .rvdraft-msg`);
        const target = fresh || $("rvpanel-msg");
        target.className = (fresh ? "rvdraft-msg" : "rvpanel-msg") + " ok";
        target.textContent = doneText;
    });
}

// ---- 히트맵 ----------------------------------------------------------
//
// 크기를 색의 진하기로 보여줍니다. 파랑 한 가지만 씁니다 — 여러 색을 섞으면
// 어느 쪽이 큰지 읽을 수 없습니다.

// (renderHeat 는 charts.js — 단계 색·글자색은 styles.css 의 --heat-* 토큰)

// ---- 수집 커버리지 ----------------------------------------------------
//
// 카드는 설정 탭에 삽니다(카드 #130 — 매출 '수집 현황' 서브탭에서 이전).
// 데이터는 종전대로 이 파이프라인(load → draw)이 매출 필터 기간으로 채우는데,
// 설정 탭에는 필터 줄이 없으므로 어느 기간을 보고 있는지 카드 머리에 씁니다.

function drawCoverage(d) {
    const months = [...new Set(d.coverageBySource.map((r) => r.ym))].sort((a, b) => a - b);
    const metaEl = $("coverage-meta");
    if (metaEl) {
        metaEl.textContent = months.length
            ? `${ymLabel(months[0])} ~ ${ymLabel(months[months.length - 1])} 기준`
            : "";
    }
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
        note: "칸 = 그 달 수집된 매장 수",
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
        rowLabel: (r) => clip(r.menu, 18),
        rowTitle: (r) => r.menu,          // 잘린 메뉴명은 title 로 전체 확인
        get: (row, bucket) => Number(row.buckets[bucket]) || 0,
        label: won,
        // 행 순서(총매출순)의 기준을 오른쪽 요약 열로 보여줍니다.
        summary: { label: "합계", get: (r) => r.total, format: won },
        note: rows.length > 15
            ? `총매출순 상위 15종 / 전체 ${rows.length}종 — 전체는 아래 표`
            : "총매출순",
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

// ('전 품목' 카드는 3라운드 2차에서 담당자 확정으로 내렸습니다 —
//  drawAllItems·검색·정렬 코드와 api_all_items 호출을 함께 뺐고,
//  서버 함수(11_all_items_fix.sql)와 데이터·미매핑 카드는 그대로입니다.)

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

// 매장 행의 판정 요약 — 급증·급감으로 판정된 채널만 채널 이름을 붙여 보이고,
// 없으면 정상/비교 대상 없음 한 장으로 줄입니다(펼치기 전에도 어느 채널이
// 문제인지 보이게 — 담당자 피드백 3-2).
function storeDirTags(channels, key) {
    const flags = channels.filter((c) => c[key] === "급증" || c[key] === "급감");
    if (flags.length) {
        return flags.map((c) =>
            `<span class="tag ${c[key] === "급증" ? "up" : "down"}">` +
            `${c[key]} · ${escape(c.channel)}</span>`).join(" ");
    }
    if (channels.some((c) => c[key] === "정상")) return '<span class="tag">정상</span>';
    return '<span class="meta">비교 대상 없음</span>';
}

// 펼쳐 둔 매장. 필터·검색으로 다시 그려도 펼침 상태를 잃지 않습니다.
const alertsOpen = new Set();

// 매장 행 아래 채널(홀/배달) 행의 보이기를 펼침 상태에 맞춥니다.
// 행은 table() 이 새로 만들지만 컨테이너(t-alerts)는 그대로라, 위임 클릭도
// 컨테이너에 한 번만 겁니다(drawAlerts 의 expWired).
function syncAlertRows() {
    $("t-alerts").querySelectorAll("tbody tr").forEach((tr) => {
        const marker = tr.querySelector(".alerts-chind");
        if (!marker) return;
        tr.classList.add("alerts-chrow");
        tr.hidden = !alertsOpen.has(marker.dataset.parent);
    });
}

// 3라운드 2차 재설계(담당자 피드백 3-2): 채널별 행 나열 대신 **매장 단위로
// 묶고**, 매장 행의 ▸ 토글로 홀/배달 채널 행을 펼칩니다. 매장 행의 매출·
// 증감률은 채널 합(서버가 준 prev_*_amount 합산)이고, 판정은 서버 판정을
// 채널 이름과 함께 요약합니다 — 여기서 임계값을 다시 계산하지 않습니다.
// '기간 대비'도 같은 구조입니다: 회사 전체·홀·배달 타일(compare) 아래에
// 매장 → 홀/배달 두 단으로 전월·전년동월 대비가 이 표 하나에 실립니다.
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

    // 매장 검색 자동완성 목록 — 지금 표에 실제로 있는 매장만.
    const dl = $("alerts-store-list");
    const names = alerts.map((s) => s.store);
    if (dl.dataset.names !== names.join("|")) {
        dl.dataset.names = names.join("|");
        dl.innerHTML = names
            .map((n) => `<option value="${escape(n)}"></option>`).join("");
    }

    const flagged = alerts.filter((s) => s.has_alert);
    const query = ($("alerts-q").value || "").trim();
    // 검색어가 있으면 전 매장에서 찾습니다 — '급증·급감만' 이 켜져 있어도
    // 찾는 매장이 정상이라는 답("정상" 행)을 볼 수 있어야 하기 때문입니다.
    const shown = query
        ? alerts.filter((s) => s.store.includes(query))
        : ($("alerts-only").checked ? flagged : alerts);

    $("alerts-shown").textContent =
        `급증·급감 ${flagged.length} / 전체 ${alerts.length}개 매장`
        + (query ? ` · 검색 ${shown.length}개` : "");

    const rows = shown.flatMap((s) => {
        const chs = s.channels || [];
        const open = alertsOpen.has(s.store);

        // 매장 합계와 그 증감률. 서버가 채널별 이전 금액(prev_*_amount)을
        // 주므로 합산 뒤 다시 계산합니다(퍼센트는 합산할 수 없음).
        const amount = chs.reduce((a, c) => a + (Number(c.amount) || 0), 0);
        const sumIf = (k) => (chs.some((c) => c[k] != null)
            ? chs.reduce((a, c) => a + (Number(c[k]) || 0), 0) : null);
        const pct = (prev) => (prev && prev > 0
            ? Math.round(((amount - prev) / prev) * 1000) / 10 : null);
        const momPct = pct(sumIf("prev_mom_amount"));
        const yoyPct = pct(sumIf("prev_yoy_amount"));

        const storeRow = [
            `<button type="button" class="alerts-exp${open ? " open" : ""}"`
                + ` data-exp="${escape(s.store)}" aria-expanded="${open}"`
                + ` aria-label="홀/배달 펼치기"></button>${escape(s.store)}`,
            escape(s.trade_area || "—"),
            chs.map((c) => escape(c.channel)).join("·") || "—",
            wonFull(amount),
            `<span class="${pctClass(momPct)}">${pctText(momPct)}</span>`,
            storeDirTags(chs, "mom_direction"),
            `<span class="${pctClass(yoyPct)}">${pctText(yoyPct)}</span>`,
            storeDirTags(chs, "yoy_direction"),
        ];
        const channelRows = chs.map((c) => [
            `<span class="alerts-chind" data-parent="${escape(s.store)}"></span>`,
            "",
            escape(c.channel),
            wonFull(c.amount),
            `<span class="${pctClass(c.mom_pct_change)}">${pctText(c.mom_pct_change)}</span>`,
            directionTag(c.mom_direction),
            `<span class="${pctClass(c.yoy_pct_change)}">${pctText(c.yoy_pct_change)}</span>`,
            directionTag(c.yoy_direction),
        ]);
        return [storeRow, ...channelRows];
    });

    table($("t-alerts"),
        ["매장", "상권", "채널", "매출", "전월 대비", "전월 판정", "전년동월 대비", "전년동월 판정"],
        rows, { html: true });

    const container = $("t-alerts");
    if (!container.dataset.expWired) {
        container.dataset.expWired = "1";
        container.addEventListener("click", (event) => {
            const button = event.target.closest(".alerts-exp");
            if (!button) return;
            const store = button.dataset.exp;
            if (alertsOpen.has(store)) alertsOpen.delete(store);
            else alertsOpen.add(store);
            button.classList.toggle("open", alertsOpen.has(store));
            button.setAttribute("aria-expanded", String(alertsOpen.has(store)));
            syncAlertRows();
        });
    }
    syncAlertRows();
}

// ---- 미매핑 -----------------------------------------------------------

function drawUnmapped(d) {
    $("unmapped-count").textContent =
        d.unmapped.length ? `${d.unmapped.length}종` : "없음";
    table($("t-unmapped"), ["원본 품목명", "채널", "발생 건수"],
        d.unmapped.map((r) => [r.name, r.source, int(r.count)]));
}

// ---- 표 전면 보기 (검수 반영 2026-08-21, 담당자 지시) --------------------
//
// "표가 될 수 있는 것 하나당 큰 화면" — 매출 탭의 표 있는 카드마다 '크게
// 보기'를 달고, 누르면 그 표(.tableview)를 전면 껍데기(#bigtable)로 **이동**
// 해 화면 전체로 봅니다. 복사가 아니라 이동이라 정렬 클릭·위임 리스너 같은
// 표의 동작이 그대로 살고, 닫으면 원래 자리(접힘 상태 포함)로 돌아갑니다.

let bigtableReturn = null;   // { tv, parent, next, wasHidden }

function openBigtable(tv, title, meta) {
    if (bigtableReturn) closeBigtable();
    bigtableReturn = {
        tv, parent: tv.parentNode, next: tv.nextSibling, wasHidden: tv.hidden,
    };
    tv.hidden = false;
    $("bigtable-title").textContent = title;
    $("bigtable-meta").textContent = meta || "";
    $("bigtable-body").append(tv);
    $("bigtable").hidden = false;
    document.body.classList.add("bigtable-open");
    $("bigtable-close").focus();
}

function closeBigtable() {
    if (bigtableReturn) {
        const { tv, parent, next, wasHidden } = bigtableReturn;
        tv.hidden = wasHidden;
        parent.insertBefore(tv, next);
        bigtableReturn = null;
    }
    $("bigtable").hidden = true;
    document.body.classList.remove("bigtable-open");
}

function initBigtable() {
    for (const card of document.querySelectorAll('[data-area="sales"]')) {
        const tv = card.querySelector(".tableview");
        if (!tv || !tv.id) continue;
        const head = card.querySelector("header, summary");
        if (!head) continue;
        // hero 카드(#129 전사 추이)는 제목이 h2 가 아니라 질문(.hero-q)입니다.
        const title = (head.querySelector("h2")?.textContent
            || head.querySelector(".hero-q")?.textContent || "표").trim();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "linkish bigtable-open-btn";
        btn.textContent = "크게 보기";
        btn.addEventListener("click", (e) => {
            // summary 안에서는 기본 동작이 접힘 토글이라 막습니다.
            e.preventDefault();
            e.stopPropagation();
            const meta = (head.querySelector(".meta")?.textContent || "").trim();
            openBigtable(tv, title, meta);
        });
        head.append(btn);
    }
    $("bigtable-close").addEventListener("click", closeBigtable);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("bigtable").hidden) closeBigtable();
    });
}

// ---------------------------------------------------------------- 표·유틸

// (table 은 dom.js, showTip·hideTip 도 dom.js, niceTicks·clip·catLabel·escape·
//  debounce 는 util.js/format.js 로 이동 — 위 import)

// ================================================================ 엑셀 내보내기
//
// 매출 탭 필터 줄의 '엑셀 내보내기' 버튼(3라운드 2차, 담당자 확정) —
// 지금 고른 기간·매장의 모든 매출 정보를 buildAndDownloadWorkbook 으로 즉시
// 만듭니다. 옛 수집·내보내기 화면의 자동수집 대기 경로(커버리지 확인 →
// collect_requests → 2시간 폴링)는 부르지 않습니다: 자리 PC 가 매일 알아서
// 수집하므로 웹은 이미 수집된 데이터만 묶으면 됩니다. api_export_* 함수와
// 시트 구성은 그대로입니다.

async function runSalesExport() {
    const button = $("sales-export");
    const msg = $("sales-export-msg");
    const { p_ym_from: ymFrom, p_ym_to: ymTo, p_store: store } = currentFilters();

    if (!ymFrom || !ymTo) {
        msg.textContent = "시작·종료 월을 먼저 고르세요.";
        return;
    }

    // 필터 줄의 매장 콤보를 그대로 씁니다 — 전체면 전 매장, 골랐으면 그 매장만.
    const storeArg = store ? [store] : null;
    const storeNames = store ? [store] : [];

    button.disabled = true;
    msg.textContent = "엑셀을 만드는 중…";
    try {
        await buildAndDownloadWorkbook(ymFrom, ymTo, storeArg, storeNames);
        msg.textContent = "엑셀을 내려받았습니다.";
    } catch (err) {
        msg.textContent = "엑셀을 만들지 못했습니다: " + String(err.message || err);
    } finally {
        button.disabled = false;
        // 안내는 잠시 뒤 지웁니다 — 필터 줄이라 오래 남으면 자리를 차지합니다.
        setTimeout(() => { if (!button.disabled) msg.textContent = ""; }, 8000);
    }
}

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
    //
    // 11개를 한꺼번에 던지지 않고 load() 와 같은 이유로 3개씩만 돌립니다
    // (큐 #107 F2). authenticated 는 쿼리당 8초 제한이라, 전 매장·넓은 기간에서
    // 동시에 던지면 서로 밀려 통째로 실패합니다(2026-07-29 실측: 11개 동시 →
    // 10개가 제한 초과 — runLimited 머리주석).
    const [summary, monthly, menu, coverage,
           mArea, mWeek, mDay, byHour, nonstd, detail, unmapped] =
        await runLimited([
            () => db.rpc("api_export_store_summary", args),
            () => db.rpc("api_export_monthly", args),
            () => db.rpc("api_export_menu", args),
            () => db.rpc("api_export_coverage", args),
            () => db.rpc("api_export_menu_matrix", { p_field: "trade_area", ...args }),
            () => db.rpc("api_export_menu_matrix", { p_field: "weekday", ...args }),
            () => db.rpc("api_export_menu_matrix", { p_field: "daypart", ...args }),
            () => db.rpc("api_export_by_hour", args),
            () => db.rpc("api_export_nonstandard", args),
            () => db.rpc("api_export_store_detail", args),
            () => db.rpc("api_export_unmapped",
                   { p_ym_from: ymFrom, p_ym_to: ymTo }),
        ], 3);
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

// (loadSheetJS 는 dom.js 로 이동 — 카드 엑셀 버튼과 같은 사본을 씁니다)

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
let visitRowsCache = new Map();       // visit_id → 행 원본 — '보고 복사'·수정 재료
let visitMyUid = null;                // 로그인 사용자 id — 내 기록에만 수정·삭제(79)
let visitEditId = null;               // 수정 중인 visit_id (null 이면 새 기록 모드)

// 격월 1회 권장 주기(폼 힌트·hq-standards 9번과 같은 기준) — '방문 대상 매장'
// 표의 기한 초과 판정에 씁니다.
const VISIT_CYCLE_DAYS = 60;

async function initVisits() {
    const storeSelect = $("vs-store");
    const { data: stores, error: storeErr } = await fetchStores();
    if (!storeErr) visitAllStores = stores || [];
    rebuildVisitStoreOptions();

    // SV 배정 — 자료가 없으면 빈 select 대신 짧은 안내를 보여줍니다(진단 [B]).
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
            await refreshVisitDue();
        });
    } else {
        $("vs-sv-empty").hidden = false;
    }

    $("vs-visited-on").value = new Date().toISOString().slice(0, 10);

    // 방문자 기본값 = 로그인 사용자(진단 [D]). created_by 는 항상 auth.uid()
    // 로 따로 남으므로 이 칸은 보고서에 찍히는 표시 이름입니다 — 다른 이름으로
    // 고쳐 쓸 수 있게 input 그대로 둡니다.
    const { data: { session } } = await db.auth.getSession();
    visitMyUid = session?.user?.id || null;
    const myName = session?.user?.user_metadata?.name
        || (session?.user?.email || "").split("@")[0];
    if (myName && !$("vs-visited-by").value) $("vs-visited-by").value = myName;

    storeSelect.addEventListener("change", refreshVisits);
    storeSelect.addEventListener("change", refreshVisitStoreMetrics);
    $("vs-submit").addEventListener("click", submitVisit);
    $("vs-cancel-edit").addEventListener("click", cancelVisitEdit);
    $("vd-all").addEventListener("change", refreshVisitDue);

    // '방문 대상 매장' 표의 '기록' 버튼 — 그 매장을 폼에 골라 주고 위로 올립니다.
    $("t-visit-due").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='visit-pick']");
        if (!button) return;
        storeSelect.value = button.dataset.storeId;
        await refreshVisits();
        await refreshVisitStoreMetrics();
        $("visit-form-card").scrollIntoView({ behavior: "smooth" });
    });

    // 이력 표의 동작 버튼들 — '보고 복사'(클립보드) + 내 기록이면 '수정'·'삭제'.
    // 복사 결과는 버튼 글씨로 알립니다(복사됨 ✓ / 복사 실패) — 별도 알림창 없음.
    $("t-visits").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;
        const row = visitRowsCache.get(button.dataset.visitId);
        if (!row) return;
        if (button.dataset.act === "visit-report") {
            const ok = await copyTextToClipboard(buildVisitReport(row));
            button.textContent = ok ? "복사됨 ✓" : "복사 실패";
            setTimeout(() => { button.textContent = "보고 복사"; }, 1500);
        } else if (button.dataset.act === "visit-edit") {
            startVisitEdit(row);
        } else if (button.dataset.act === "visit-del") {
            await deleteVisit(row, button);
        }
    });

    await refreshVisits();
    await refreshVisitStoreMetrics();
    await refreshVisitDue();
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
        notice.textContent = "매장과 방문일은 꼭 넣어 주세요.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const fields = {
        store_id: Number(storeId),
        visited_on: visitedOn,
        visited_by: $("vs-visited-by").value.trim() || null,
        hygiene_note: $("vs-hygiene").value.trim() || null,
        self_purchase_note: $("vs-self-purchase").value.trim() || null,
        cooking_note: $("vs-cooking").value.trim() || null,
        owner_meeting_note: $("vs-owner-meeting").value.trim() || null,
        special_note: $("vs-special").value.trim() || null,
    };

    // 수정 모드면 update, 아니면 insert. created_by 는 만들 때만 남깁니다
    // (수정해도 기록 주인은 그대로 — 79 의 update 정책 축).
    let error;
    if (visitEditId !== null) {
        ({ error } = await db.from("store_visits").update(fields)
            .eq("id", Number(visitEditId)));
    } else {
        const { data: { session } } = await db.auth.getSession();
        ({ error } = await db.from("store_visits")
            .insert({ ...fields, created_by: session?.user?.id }));
    }

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = visitEditId !== null ? "수정했습니다." : "저장했습니다.";
    // 방문자 칸은 비우지 않습니다 — 같은 SV 가 여러 매장을 연달아 입력할 때
    // 매번 이름을 다시 치지 않게(진단 [D]).
    for (const id of ["vs-hygiene", "vs-self-purchase",
                       "vs-cooking", "vs-owner-meeting", "vs-special"]) {
        $(id).value = "";
    }
    exitVisitEditMode();
    await refreshVisits();
    await refreshVisitDue();
}

// '수정' 버튼 — 그 기록을 폼에 되불러 옵니다. 저장 버튼이 '수정 저장' 으로
// 바뀌고, '수정 취소' 가 새 기록 모드로 되돌립니다(진단 [F]).
function startVisitEdit(row) {
    visitEditId = String(row.visit_id);

    // SV 필터가 그 매장을 가리고 있으면 필터를 풀어 option 을 되살립니다.
    const storeSelect = $("vs-store");
    if (![...storeSelect.options].some((o) => o.textContent === row.store_name)) {
        if ($("vs-sv")) $("vs-sv").value = "";
        rebuildVisitStoreOptions();
    }
    const opt = [...storeSelect.options].find((o) => o.textContent === row.store_name);
    storeSelect.value = opt ? opt.value : "";

    $("vs-visited-on").value = row.visited_on;
    $("vs-visited-by").value = row.visited_by || "";
    $("vs-hygiene").value = row.hygiene_note || "";
    $("vs-self-purchase").value = row.self_purchase_note || "";
    $("vs-cooking").value = row.cooking_note || "";
    $("vs-owner-meeting").value = row.owner_meeting_note || "";
    $("vs-special").value = row.special_note || "";

    $("vs-submit").textContent = "수정 저장";
    $("vs-cancel-field").hidden = false;
    const notice = $("vs-notice");
    notice.className = "notice";
    notice.textContent = `${row.store_name} · ${row.visited_on} 기록을 수정하는 중입니다.`;
    $("visit-form-card").scrollIntoView({ behavior: "smooth" });
}

function cancelVisitEdit() {
    exitVisitEditMode();
    for (const id of ["vs-hygiene", "vs-self-purchase",
                       "vs-cooking", "vs-owner-meeting", "vs-special"]) {
        $(id).value = "";
    }
    const notice = $("vs-notice");
    notice.className = "notice";
    notice.textContent = "수정을 취소했습니다.";
}

function exitVisitEditMode() {
    visitEditId = null;
    $("vs-submit").textContent = "방문 기록 추가";
    $("vs-cancel-field").hidden = true;
}

async function deleteVisit(row, button) {
    if (!confirm(`${row.store_name} · ${row.visited_on} 방문 기록을 삭제할까요?`)) return;
    button.disabled = true;
    const { error } = await db.from("store_visits").delete()
        .eq("id", Number(row.visit_id));
    button.disabled = false;

    const notice = $("vs-notice");
    if (error) {
        notice.className = "notice error";
        notice.textContent = "삭제하지 못했습니다: " + error.message;
        return;
    }
    notice.className = "notice";
    notice.textContent = "삭제했습니다.";
    if (visitEditId === String(row.visit_id)) exitVisitEditMode();
    await refreshVisits();
    await refreshVisitDue();
}

// '방문 대상 매장' — 진단 #101 [A]. api_store_visits 전 매장분에서 매장별
// 마지막 방문일을 세어, 미방문·기한 초과(격월 권장 60일)를 오래된 순으로
// 보여줍니다. 새 SQL 없이 화면 계산입니다 — 방문이 격월 1회라 전체 이력도
// 몇 천 건 규모를 넘지 않습니다(p_limit 로 최근 1만 건까지).
async function refreshVisitDue() {
    const container = $("t-visit-due");
    const { data, error } = await db.rpc("api_store_visits",
        { p_store: null, p_limit: 10000 });
    if (error) {
        container.innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }

    // 매장별 마지막 방문일 — 목록이 최신순이라 처음 만난 것이 마지막 방문입니다.
    const lastByStore = new Map();
    for (const v of (Array.isArray(data) ? data : [])) {
        if (!lastByStore.has(v.store_name)) lastByStore.set(v.store_name, v.visited_on);
    }

    const sv = $("vs-sv") ? $("vs-sv").value : "";
    const mine = sv ? (visitStoresBySv.get(sv) || new Set()) : null;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const dayMs = 24 * 60 * 60 * 1000;

    const rows = visitAllStores
        .filter((s) => !mine || mine.has(s.name))
        .map((s) => {
            const last = lastByStore.get(s.name) || null;
            const days = last ? Math.floor((today - new Date(last)) / dayMs) : null;
            return { store: s, last, days };
        });

    const never = rows.filter((r) => r.last === null).length;
    const overdue = rows.filter((r) => r.days !== null && r.days > VISIT_CYCLE_DAYS).length;
    $("visit-due-summary").textContent =
        `${sv ? sv + " 담당 " : ""}${int(rows.length)}곳 중 미방문 ${int(never)} · `
        + `기한 초과 ${int(overdue)}`;

    const showAll = $("vd-all").checked;
    const shown = rows
        .filter((r) => showAll || r.last === null || r.days > VISIT_CYCLE_DAYS)
        .sort((a, b) => {
            // 미방문 맨 위, 그다음 오래된 순
            if ((a.last === null) !== (b.last === null)) return a.last === null ? -1 : 1;
            if (a.last === null) return a.store.name.localeCompare(b.store.name, "ko");
            return (b.days - a.days) || a.store.name.localeCompare(b.store.name, "ko");
        });

    if (!shown.length) {
        container.innerHTML =
            '<p class="hint">미방문·기한 초과 매장이 없습니다. 전체 주기는 위 체크박스로 봅니다.</p>';
        return;
    }

    const status = (r) => {
        if (r.last === null) return '<span class="tag warn">미방문</span>';
        if (r.days > VISIT_CYCLE_DAYS) return '<span class="tag h-warn">기한 초과</span>';
        return "정상";
    };
    const headers = visitStoresBySv.size
        ? ["매장", "담당 SV", "마지막 방문일", "경과", "상태", ""]
        : ["매장", "마지막 방문일", "경과", "상태", ""];
    table(container, headers,
        shown.map((r) => {
            const cells = [
                escape(r.store.name),
                r.last ? escape(r.last) : "—",
                r.days === null ? "—" : `${int(r.days)}일`,
                status(r),
                `<button type="button" class="ghost" data-act="visit-pick" data-store-id="${r.store.id}">기록</button>`,
            ];
            if (visitStoresBySv.size) {
                cells.splice(1, 0, escape(visitSvByStore.get(r.store.name) || "—"));
            }
            return cells;
        }),
        { html: true });
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

    // SV 필터 요약에 '담당 매장 기준' 을 명시합니다 — 이 필터는 방문자
    // (visited_by)가 아니라 배정 매장으로 거르기 때문입니다(진단 [C]).
    $("visit-summary").textContent = storeName
        ? `${escape(storeName)} · ${int(list.length)}건`
        : (sv
            ? `${escape(sv)} 담당 매장 ${int((visitStoresBySv.get(sv) || new Set()).size)}곳 기준 · 방문 ${int(list.length)}건`
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
    // 수정·삭제는 내 기록에만 보입니다(79 의 RLS 가 최종 게이트 — 여기 표시는
    // 눌러도 안 되는 버튼을 안 보여주기 위한 것). created_by 가 안 내려오는
    // 환경(79 적용 전)에서는 보고 복사만 나옵니다.
    const actions = (v) => {
        let html = `<button type="button" class="ghost" data-act="visit-report" data-visit-id="${v.visit_id}">보고 복사</button>`;
        if (visitMyUid && v.created_by === visitMyUid) {
            html += ` <button type="button" class="ghost" data-act="visit-edit" data-visit-id="${v.visit_id}">수정</button>`
                + ` <button type="button" class="ghost" data-act="visit-del" data-visit-id="${v.visit_id}">삭제</button>`;
        }
        return html;
    };
    table($("t-visits"),
        ["매장", "방문일", "방문자", "위생점검", "자점매입", "조리점검", "점주미팅", "특이사항", "동작"],
        list.map((v) => [
            escape(v.store_name),
            escape(v.visited_on),
            v.visited_by ? escape(v.visited_by) : "—",
            multiline(v.hygiene_note),
            multiline(v.self_purchase_note),
            multiline(v.cooking_note),
            multiline(v.owner_meeting_note),
            multiline(v.special_note),
            actions(v),
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

    const ymTo = S.filterRange?.max;
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

// (가맹점 DB 함수 initStoreDb 등은 store_db.js 로 이동 — 위 import)

// ================================================================ 채널별 계정 (통합)
//
// 유무 표와 배달앱 계정 열람이 한 표입니다(카드 #145). 평소에는
// api_account_presence(44)의 체크만 — 게이트(credentials.js)가 열리면
// account.js 가 체크 자리에 아이디·비밀번호를 그립니다.

// (initAccountPresence·drawAccountPresence 는 account.js 로 이동 — 위 import)

// ================================================================ 오픈·폐점 (8번 영역)
//
// 27_store_lifecycle.sql. 방문·점검(initVisits)과 같은 이유로 날짜 필터
// (기간·매장)와 무관해 load() 묶음에 넣지 않고 한 번만 받습니다. 매장을
// 고르면 이력 표만 그 매장으로 좁힙니다(store_visits 와 같은 방식).

// (initLifecycle 등 오픈·폐점 함수는 lifecycle.js 로 이동 — 위 import)

// ================================================================ 카카오 챗봇 통계 (1번 영역)
//
// 62_kakao_intake 의 api_kakao_skill_stats 위의 화면입니다. 이벤트(스킬 호출)
// 그레인이라 위쪽 기간·매장 필터를 따르지 않고(방문·업무와 같은 이유)
// 일수 select 만 둡니다. 블록별 '접수' 는 그 블록 호출이 직접 만든 업무 수라,
// 갈래 시작 블록의 접수가 0 인 것은 정상입니다(접수는 이관·식자재_접수 몫).

// (initKakaoStats·drawKakaoStats 는 kakao_stats.js 로 이동 — 위 import)

boot();

// ================================================================ 광고 (6번 영역)
//
// 48_ad_spend.sql 위의 읽기 화면입니다. 자료(마케팅팀 광고 집행 대장)가 반입
// 되기 전에는 빈 표가 정상이라, 그때는 타일·표를 숨기고 안내 한 줄만 남깁니다.
//
// (initAds 는 ads.js 로 이동 — 위 import. 영역 하나를 자기 파일로 뽑아낸
//  첫 예입니다. db + foundation 만 import 하면 됩니다 — web-split-plan.md 3단계.)

// ================================================================ 식자재·발주 (10번 영역)
//
// 레시피(32_recipes.sql, 원가분석 파일 반입분) + 이론 사용량(49_ingredient_usage.sql
// = 판매량 × 레시피). 계산의 뒤 절반인 '발주량과 대조'(과조리·저발주·자점매입
// 의심)는 발주 자료가 연동돼야 가능합니다 — 그때 이 화면에 대조 열이 붙습니다.
// 이론 사용량 카드가 자체 기간·매장 칸을 갖는 이유: 위쪽 필터 줄은 매출
// 영역에서만 보이기 때문입니다(showArea 참조).

// (initIngredients·renderRecipes·refreshIngredientUsage 는 ingredients.js 로 이동 — 위 import)

// ---------------------------------------------------------------- 발주량 (아워홈)
//
// 59_ourhome_orders.sql 위의 화면입니다. 자점매입 감시의 **원천**이고, 판정은
// 아직 없습니다 — 로스·폐기율이 없으면 정상 폐기와 자점매입이 구분되지 않고,
// 이 자료에는 품목 단위도 없습니다(59 설계 판단 [4]).
//
// 매장 고르개를 stores 표가 아니라 **응답이 준 목록**으로 채웁니다. 아워홈에는
// 우리 대장에 없는 사업장이 있어서(선릉역점·랩실 등) stores 로 채우면 그 매장을
// 아예 고를 수 없습니다.

// (initOurhome·refreshOurhome 는 ourhome.js 로 이동 — 위 import)

