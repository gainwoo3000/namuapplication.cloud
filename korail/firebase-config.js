// Firebase 웹 앱 설정값 (Firebase 콘솔 → 프로젝트 설정 → 내 앱에서 복사).
// 이 값들은 공개돼도 되는 식별자다. 데이터 보안은 korail-firebase/firestore.rules, storage.rules가 맡는다.
export const firebaseConfig = {
  apiKey: "AIzaSyCNb9Uiqr4AEngw-87k-cg9JBk2yKik87Y",
  authDomain: "korail-28356.firebaseapp.com",
  projectId: "korail-28356",
  storageBucket: "korail-28356.firebasestorage.app",
  messagingSenderId: "384296205582",
  appId: "1:384296205582:web:f78cc924fff1bfb4256b5f",
  measurementId: "G-TRRL1F5FCD"
};

// Claude API 중계 함수(korail-firebase/functions)를 배포한 리전. index.js의 region과 같아야 한다.
export const functionsRegion = "asia-northeast3";
