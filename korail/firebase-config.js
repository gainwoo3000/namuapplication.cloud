// Firebase 웹 앱 설정값.
// Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 일반 → "내 앱"의 웹 앱 → "SDK 설정 및 구성"에서
// firebaseConfig 객체를 그대로 복사해 아래 값을 채운다.
// 이 값들은 공개돼도 되는 식별자다. 데이터 보안은 korail-firebase/firestore.rules, storage.rules가 맡는다.
// 값이 비어 있으면 페이지는 "설정 필요" 안내만 보여 준다.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Claude API 중계 함수(korail-firebase/functions)를 배포한 리전. index.js의 region과 같아야 한다.
export const functionsRegion = "asia-northeast3";
