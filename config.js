// 웹 대시보드 접속 설정
//
// [이 파일이 저장소에 들어 있는 이유 — 2026-07-23]
// 예전에는 이 파일을 gitignore 했습니다. 그 결과 배포본에 키가 빈 채로 올라가
// 웹이 "설정이 필요합니다" 만 띄우고 아무도 못 쓰는 상태가 한동안 이어졌습니다.
// 오류가 안 나서 아무도 몰랐습니다.
//
// 여기 들어가는 publishable 키는 비밀이 아닙니다. 브라우저에 그대로 실려 나가도록
// 설계된 값이라, 사이트를 여는 누구나 이미 볼 수 있습니다. 감출 수 있는 종류가 아닙니다.
// 실제 보안은 이 키가 아니라 RLS + 로그인이 합니다 (로그인 전에는 한 행도 안 나옵니다).
//
// ⚠️ service_role / secret 키는 절대 여기 넣지 마세요. 그건 수집 PC 의 cloud.json 에만.

// ---------------------------------------------------------------- 프로젝트
//
// 두 프로젝트는 스키마가 같고 데이터도 같게 맞춰 둡니다.
//   prod  사내 직원이 실제로 보는 곳
//   dev   새 기능을 시험하는 곳. 깨져도 업무에 지장이 없어야 합니다.

const PROJECTS = {
    prod: {
        url: "https://nuzmuaonbotxcfezondy.supabase.co",
        anonKey: "sb_publishable_yH-84ZSF4IeqE0UD_HYSrg_BfPj6ELi",
    },
    prod_old: {
        url: "https://tqhdbuyrtcgknlpjainp.supabase.co",
        anonKey: "sb_publishable_ixEizdPEWJ6142-izsSZCw_xov_aroy",
    },
    dev: {
        url: "https://zzpwpzevcbxnqeeqyemn.supabase.co",
        anonKey: "sb_publishable_lqrL1Ea5GzzzX627Avs1-Q_BhJtNRBP",
    },
};

// 운영으로 취급할 주소. 여기 없는 주소는 전부 개발로 봅니다.
//
// [왜 '운영 목록' 방식인가 — 반대로 하면 안 됩니다]
// 미리보기 주소는 배포할 때마다 달라집니다. 그래서 '개발 목록' 을 만들 수 없습니다.
// 목록에 없으면 개발로 두는 편이 안전합니다. 최악의 경우가 '시험 데이터를 봤다' 이지,
// '시험하려던 것이 실데이터를 건드렸다' 가 아니기 때문입니다.
const PRODUCTION_HOSTS = [
    "mitalypasta.github.io",   // GitHub Pages (2026-07-23 이후 실제로 쓰는 곳)
    "mitaly-nu.vercel.app",    // Vercel. 로그인이 막혀 배포가 안 되지만 주소는 살려 둡니다
];

// ---------------------------------------------------------------- 선택
//
// 우선순위
//   1) 주소에 ?env=dev / ?env=prod 를 붙이면 그대로 (사람이 명시한 것이 가장 셉니다)
//   2) 운영 주소면 prod
//   3) 나머지(미리보기·localhost)는 dev

function pickEnv() {
    const asked = new URLSearchParams(location.search).get("env");
    if (asked && PROJECTS[asked]) return asked;
    return PRODUCTION_HOSTS.includes(location.hostname) ? "prod" : "dev";
}

const ENV = pickEnv();

window.MITALY_CONFIG = {
    ...PROJECTS[ENV],

    // 지금 무엇을 보고 있는지. 화면 표시와 문제 추적에 씁니다.
    env: ENV,
    projects: PROJECTS,

    // 로그인 링크를 받을 수 있는 이메일 도메인 (예: ["mitaly.co.kr"])
    // 비워두면 제한하지 않습니다. 실제 차단은 Supabase Auth 설정에서 합니다.
    allowedEmailDomains: [],

    // 카카오맵 JavaScript 키 (6번 배달 지도, docs/dong-map-design.md).
    // 도메인 제한이 걸리는 **공개 키**라 여기 둬도 됩니다(anon 키와 같은 성격).
    // 카카오 개발자 앱 '미태리'(ID 1536423, 카카오맵 무료 쿼터 보유)의 JS 키.
    kakaoMapKey: "b32e0b4806e549ca7bfaeee1445f5291",
};

// ---------------------------------------------------------------- 표시
//
// 개발 데이터를 실데이터로 착각하는 것이 이 구조의 가장 큰 위험입니다.
// 화면이 똑같이 생겼기 때문입니다. 운영이 아닐 때는 반드시 눈에 띄게 알립니다.

if (ENV !== "prod") {
    addEventListener("DOMContentLoaded", () => {
        const badge = document.createElement("a");
        badge.className = "env-badge";
        badge.textContent = "개발 데이터";
        badge.title = "운영이 아닙니다. 눌러서 운영 데이터로 전환합니다.";
        // 누르면 같은 화면을 운영으로 다시 엽니다.
        const to = new URL(location.href);
        to.searchParams.set("env", "prod");
        badge.href = to.toString();
        document.body.appendChild(badge);
    });
}
