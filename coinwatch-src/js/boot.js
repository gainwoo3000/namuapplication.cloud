// 앱 시작점. 처음 온 사람은 아직 화면 언어를 IP 위치로 정하는 중일 수 있다(index.html <head>).
// 언어는 모듈 맨 위의 상수(기간 버튼 이름 등)에까지 들어가므로, 정해진 뒤에 앱 전체를 불러온다.
// 빌드하면 main.js도 이 파일 하나에 합쳐진다 — 기다린 뒤 따로 내려받는 게 아니다.
(window.APP_LANG_READY || Promise.resolve()).then(() => import("./main.js"));
