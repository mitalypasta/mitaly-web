// Supabase 클라이언트 — 데모 분기와 설정 게이트. app.js 에서 뽑아낸 조각
// (docs/web-split-plan.md 3단계 착수). db 를 쓰는 모든 화면 모듈이 여기서
// 같은 인스턴스를 import 합니다. 최상위 await 를 쓰므로 이 모듈을 import 하는
// 쪽은 db 준비가 끝난 뒤 실행됩니다.

// index.html?demo=1 로 열면 Supabase 없이 가짜 데이터로 화면만 봅니다.
const DEMO = new URLSearchParams(location.search).get("demo") === "1";

export const CONFIG = window.MITALY_CONFIG || {};

let client;
if (DEMO) {
    const { demoClient } = await import("./demo.js");
    client = demoClient();
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
    // 버전을 고정하고 ?bundle 로 한 덩어리를 받습니다(3라운드 0-5 실측).
    // 떠 있는 @2 는 매 방문 재검증되는 10분짜리 캐시 + 하위 모듈 20여 개를
    // 3~4단 체인으로 불러 부팅에서 가장 오래 걸리는 구간이었습니다(로컬에서도
    // 1초 안팎 — db 준비 전에는 로그인 화면조차 안 뜹니다). 고정판+번들은
    // 요청 3개, immutable 캐시(1년)라 재방문에는 네트워크 비용이 없습니다.
    // 2.112.3 = 2026-08-16 에 @2 가 실제로 풀리던 버전(동작 변화 없음).
    const { createClient } =
        await import("https://esm.sh/@supabase/supabase-js@2.112.3?bundle&target=es2022");
    client = createClient(CONFIG.url, CONFIG.anonKey);
}

export const db = client;

// 매장 목록(id·name)은 부팅 때 여러 영역(업무·방문·오픈폐점·공지·식자재·
// 매장DB·위반)이 각자 조회해 같은 REST 호출이 9번 나갔습니다(2026-08-16 실측,
// 3라운드 0-5). 한 번만 조회해 나눠 씁니다. 매장 목록은 한 세션 안에서
// 사실상 안 바뀌므로(신규 등록은 화면 새로고침 뒤에 보여도 충분) 캐시가
// 안전합니다. 실패하면 캐시를 비워 다음 호출이 다시 시도합니다.
let storesPromise = null;
export function fetchStores() {
    if (!storesPromise) {
        storesPromise = db.from("stores").select("id,name").order("name")
            .then((r) => {
                if (r.error) storesPromise = null;
                return r;
            }, (e) => { storesPromise = null; throw e; });
    }
    return storesPromise;
}
