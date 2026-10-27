# 사고사례 환류관리 — Firebase 설정

웹 페이지: `https://namuapplication.cloud/korail/` (이 저장소의 `korail/` 폴더)

GitHub Pages는 파일만 내보내므로, 응답·규정 저장과 사진, 로그인, Claude 자동 기능은 Firebase가 맡는다.

| 기능 | 맡는 곳 |
|---|---|
| 응답 · 규정 · 관리자 목록 | Cloud Firestore |
| 사고 경위 사진 | Cloud Storage (`photos/{uid}/`) |
| 로그인 | Firebase Authentication (Google) |
| 위반 법령 자동 채우기 · 핵심 요약 | Cloud Functions `claude` (서울 리전) → Claude API |

API 키는 Functions 비밀값으로만 보관되고 브라우저에는 나가지 않는다.
사용자 한 명당 하루 호출 수 제한(`functions/.env`의 `DAILY_LIMIT`, 기본 50회)이 있다.

## 처음 한 번 설정하는 순서

### 1. Firebase 프로젝트 만들기 ← 본인만 가능
1. https://console.firebase.google.com → **프로젝트 추가** (Google 애널리틱스는 꺼도 된다)
2. 왼쪽 아래 **요금제 업그레이드 → Blaze(종량제)**
   Cloud Storage와 Functions를 쓰려면 Blaze가 필요하다. 무료 사용량 안에서는 요금이 거의 나오지 않지만,
   Google Cloud 콘솔 **결제 → 예산 및 알림**에서 월 예산 알림(예: 1만원)을 걸어 두기를 권한다.

### 2. 로그인
1. **Authentication → 시작하기 → 로그인 방법 → Google → 사용 설정**
2. **Authentication → 설정 → 승인된 도메인 → 도메인 추가** → `namuapplication.cloud`

### 3. 데이터베이스와 사진 저장소
1. **Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**
2. **Storage → 시작하기** → 같은 위치 → 프로덕션 모드
   (보안 규칙은 5단계에서 이 폴더의 파일로 덮어쓴다)

### 4. 웹 앱 설정값 넣기
1. **프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → 웹(`</>`) 앱 추가** (호스팅 설정은 체크하지 않는다)
2. 나오는 `firebaseConfig`의 값 6개를 `korail/firebase-config.js`에 붙여넣고 커밋·푸시
   이 값들은 공개돼도 되는 식별자다. 실제 보안은 `firestore.rules`, `storage.rules`가 맡는다.

### 5. 보안 규칙과 Claude 중계 함수 배포 (내 컴퓨터에서)
Claude API 키는 https://console.anthropic.com → **API Keys**에서 만든다.

```bash
npm install -g firebase-tools        # Node 20 이상
firebase login

cd korail-firebase
firebase use --add                   # 1단계에서 만든 프로젝트 선택 (.firebaserc 가 바뀐다)
(cd functions && npm install)

firebase functions:secrets:set ANTHROPIC_API_KEY   # 키 붙여넣기
firebase deploy --only firestore:rules,storage,functions
```

### 6. 첫 관리자 등록과 기본 규정 ← 배포 직후 바로
1. `https://namuapplication.cloud/korail/#regs` 열기 → **Google 로그인**
2. **규정 관리 → "…계정을 첫 관리자로 등록"**
   관리자 문서가 없을 때 처음 누른 사람이 관리자가 되므로 배포하자마자 담당자 계정으로 누른다.
3. **기본 규정 7개 등록** 누르기
   철도안전법 제40조의2(제1·2·5항)는 원문과 처벌 조항까지 들어 있고, 내부 규정 6개는 이름만 들어간다.
   각 규정의 **원문 붙여넣기**로 조문을 등록해야 자동 채우기가 그 조문을 찾아 넣는다.

## 권한

| 할 수 있는 일 | 로그인한 누구나 | 관리자 |
|---|---|---|
| 응답 작성 · 결과/통계/사례 요약 보기 · CSV 내려받기 | O | O |
| 사진 올리기 (자기 사진만 지움) | O | O |
| 핵심 요약 저장 | O | O |
| 규정 · 조문 추가/수정/삭제 | | O |
| 응답 삭제 · 관리자 추가/빼기 | | O |

- 관리자 추가: **규정 관리 → 관리자** 칸에 Google 계정 이메일 입력.
- 지금 규칙은 **Google 계정으로 로그인한 누구나** 사고 기록을 읽고 쓸 수 있다.
  나중에 특정 계정만 허용하려면 `firestore.rules`의 `signedIn()`을 허용 목록 검사로 바꾸고 다시 배포한다.
- 사진은 Storage 다운로드 주소(토큰 포함)로 표시된다. 그 주소를 아는 사람은 로그인 없이도 볼 수 있다.

## 설정 바꾸기
- 하루 사용 한도·모델: `functions/.env` 수정 → `firebase deploy --only functions`
- 함수 리전을 바꾸면 `functions/index.js`의 `region`과 `korail/firebase-config.js`의 `functionsRegion`을 같이 바꾼다.

## 문제가 생기면

| 화면에 보이는 것 | 원인과 해결 |
|---|---|
| "Firebase 설정이 필요합니다" | `korail/firebase-config.js` 값이 비어 있음 → 4단계 |
| 로그인 시 "승인 도메인에 없습니다" | 2단계 승인된 도메인에 `namuapplication.cloud` 추가 |
| "이 계정으로는 응답을 저장할 수 없습니다" | 규칙이 배포되지 않았거나 다른 프로젝트에 배포됨 → 5단계, `firebase use` 확인 |
| 사진을 올리지 못함 | Storage를 만들지 않았거나 `storage` 규칙 미배포 |
| "자동 기능 서버에 연결하지 못했습니다" | Functions 미배포 또는 리전 불일치 |
| "Claude API 키가 올바르지 않습니다" | `firebase functions:secrets:set ANTHROPIC_API_KEY` 다시 실행 후 재배포 |
| "모델 이름을 확인해야 합니다" | `functions/.env`의 `CLAUDE_MODEL` 수정 후 재배포 |
| "오늘 자동 기능 사용 한도" | `DAILY_LIMIT` 늘리고 재배포 |

함수 로그: `firebase functions:log --only claude`
