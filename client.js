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
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    client = createClient(CONFIG.url, CONFIG.anonKey);
}

export const db = client;
