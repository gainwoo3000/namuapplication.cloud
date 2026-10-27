/**
 * 사고사례 환류관리 — Claude API 중계 함수 (Firebase Cloud Functions v2, 호출형)
 *
 * 브라우저는 API 키를 모른다. 로그인한 사용자가 이 함수를 부르면, 함수가 서버에 보관된
 * ANTHROPIC_API_KEY로 Claude를 대신 부르고 결과만 돌려준다.
 *
 * 받는 작업은 두 가지뿐이고, 프롬프트는 서버가 만든다(임의 프롬프트 중계 금지).
 *   - violations : 사고 기록 + 등록된 규정 목록 → 위반 가능 조문 JSON
 *   - summary    : 사례 요약 목록 → 교육용 핵심 요약 3~5문장
 *
 * 비용 보호: 사용자마다 하루(한국 시간) DAILY_LIMIT회까지만 호출된다.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

// 비밀값: firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
// 일반 설정값: 처음 배포할 때 물어보며, functions/.env 에 적어 두면 묻지 않는다.
const CLAUDE_MODEL = defineString('CLAUDE_MODEL', { default: 'claude-sonnet-5-5' });
const DAILY_LIMIT = defineInt('DAILY_LIMIT', { default: 50 });

exports.claude = onCall(
  {
    region: 'asia-northeast3', // 서울. 웹의 korail/firebase-config.js functionsRegion과 같아야 한다.
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 180,
    memory: '256MiB',
    maxInstances: 5,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const data = request.data || {};
    const task = data.task;
    if (task !== 'violations' && task !== 'summary') {
      throw new HttpsError('invalid-argument', '알 수 없는 작업입니다.');
    }

    let prompt;
    let maxTokens;
    if (task === 'violations') {
      const record = String(data.record || '').slice(0, 8000);
      if (!record.trim()) throw new HttpsError('invalid-argument', '사고 기록이 비어 있습니다.');
      const library = Array.isArray(data.library) ? data.library : [];
      if (!library.length) throw new HttpsError('invalid-argument', '등록된 규정이 없습니다.');
      prompt = violationsPrompt(record, JSON.stringify(library).slice(0, 150000));
      maxTokens = 2500;
    } else {
      const text = String(data.text || '').slice(0, 12000);
      if (!text.trim()) throw new HttpsError('invalid-argument', '요약할 내용이 없습니다.');
      prompt = summaryPrompt(text);
      maxTokens = 900;
    }

    const key = ANTHROPIC_API_KEY.value();
    if (!key) throw new HttpsError('failed-precondition', 'Claude API 키가 설정되지 않았습니다. 관리자에게 알려 주세요.');

    await countUsage(request.auth.uid);
    const out = await callClaude(key, prompt, maxTokens);

    if (task === 'violations') return { result: parseJson(out) };
    return { text: out.trim() };
  }
);

/** 사용자별 하루 호출 수를 세고 한도를 넘으면 막는다. */
async function countUsage(uid) {
  const limit = DAILY_LIMIT.value();
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 날짜
  const db = getFirestore();
  const ref = db.doc(`usage/${uid}_${day}`);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const count = (snap.exists ? snap.get('count') || 0 : 0) + 1;
    if (count > limit) {
      throw new HttpsError('resource-exhausted', `오늘 자동 기능 사용 한도(${limit}회)에 도달했습니다. 내일 다시 시도하세요.`);
    }
    t.set(ref, { uid, day, count, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

async function callClaude(key, prompt, maxTokens) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL.value(),
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    throw new HttpsError('unavailable', 'Claude 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Claude API error', res.status, body.slice(0, 500));
    if (res.status === 401 || res.status === 403) throw new HttpsError('failed-precondition', 'Claude API 키가 올바르지 않습니다. 관리자에게 알려 주세요.');
    if (res.status === 404) throw new HttpsError('failed-precondition', 'Claude 모델 이름(CLAUDE_MODEL)을 확인해야 합니다. 관리자에게 알려 주세요.');
    if (res.status === 429 || res.status === 529) throw new HttpsError('resource-exhausted', 'Claude 사용량이 많습니다. 잠시 후 다시 시도하세요.');
    if (res.status === 400) throw new HttpsError('invalid-argument', '요청이 너무 깁니다. 규정 조문 수나 입력 내용을 줄여 주세요.');
    throw new HttpsError('internal', 'Claude 호출에 실패했습니다. 잠시 후 다시 시도하세요.');
  }
  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new HttpsError('internal', '빈 응답을 받았습니다. 다시 시도하세요.');
  return text;
}

/** 답에서 JSON 하나를 관대하게 꺼낸다: 전체 → 코드펜스 → 첫 { 부터 마지막 } 까지 */
function parseJson(text) {
  const tries = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object') return v;
    } catch (e) { /* 다음 후보 */ }
  }
  throw new HttpsError('internal', '분석 결과를 읽지 못했습니다. 다시 시도하세요.');
}

function violationsPrompt(record, libraryJson) {
  return `당신은 철도 운전취급 사고조사를 돕는 검토자입니다. 아래 사고 기록을 읽고, 아래 '등록된 규정 목록' 안에서 이 사고와 관련해 위반되었을 가능성이 있는 조문을 고르세요.

규칙:
- 반드시 등록된 규정 목록에 있는 regId와 articleId만 사용합니다. 목록에 없는 조문 번호, 조문 내용, 과태료·벌칙 금액을 만들어 내지 않습니다.
- 규정은 해당하지만 맞는 조문이 목록에 없으면 articleId를 null로 둡니다.
- 사고가 발생했다는 사실만으로 위반이라고 단정하지 않습니다. 기록에서 확인되는 행위(미이행, 확인 생략 등)를 근거로 듭니다.
- 근거가 약하면 confidence를 "낮음"으로 합니다. 해당하는 조문이 없으면 빈 배열을 돌려줍니다.
- 최대 6개까지, 관련성이 큰 순서로.

출력은 JSON 객체 하나만 씁니다. 다른 글은 쓰지 않습니다. 형식:
{"violations":[{"regId":"r01","articleId":"a1 또는 null","duty":"규정이 요구하는 행동 (한 문장)","gap":"기록상 실제 행위와의 차이 (한 문장)","reason":"이 조문을 고른 근거 (한두 문장)","confidence":"높음|중간|낮음"}],"note":"추가로 확인할 점 (한 문장, 없으면 빈 문자열)"}

[사고 기록]
${record}

[등록된 규정 목록]
${libraryJson}`;
}

function summaryPrompt(text) {
  return `다음은 철도 사고사례 분석 기록입니다. 승무원 교육자료에 넣을 핵심 요약을 한국어 평서문 3~5문장으로 쓰세요.
순서: 무슨 일이 있었는지 → 확인된 미이행 행위 → 관련 규정과 처벌 조항 → 판정과 개선대책.
기록에 없는 사실, 조문, 금액은 추가하지 않습니다. '기록 없음'인 항목은 언급하지 않습니다. 제목, 목록, 마크다운 없이 문장만 씁니다.

${text}`;
}
