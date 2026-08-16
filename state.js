// 모듈 사이에서 재할당되는 공유 가변 상태 — ESM 은 import 한 let 을 다른
// 모듈이 재할당하지 못하므로, 이런 값은 이 저장소 객체의 필드로 둡니다
// (docs/web-split-plan.md shell 분리). 필드마다 쓰는 쪽·읽는 쪽을 적어 둡니다.
export const S = {
    // 데이터 범위(최소/최대 연월). initDashboard(app.js)가 채우고
    // 엑셀 내보내기·방문 지표·정산이 읽습니다.
    filterRange: null,
    // 마지막 load() 결과. app.js 가 채우고 다시 그리기·보고서가 읽습니다.
    lastData: null,
    // 매장 정보 2차 암호. 메모리 전용. 절대 저장하지 않습니다.
    // credentials.js 가 쓰고 영역 전환(nav)이 잠글 때 봅니다.
    credPass: null,
    // 점주 연락처 2차 암호. 위와 같은 규칙 (contacts.js).
    ctPass: null,
    // 지금 보이는 업무 영역("home"·"collect"…). showArea(nav.js)가 쓰고,
    // 수집 화면의 무한 폴링(app.js refreshRunner/refreshRequests)이 읽어
    // 영역을 벗어나 있는 동안은 서버 조회를 쉽니다 (큐 #107 F6).
    area: null,
};
