// 백업 코드 만들기·읽기. 화면(backup.js)과 떼어 둔 순수 함수라 node --test로 바로 돌릴 수 있다.
//
// 코드 = "CW1:" + base64(UTF-8 JSON). JSON 그대로 두지 않는 이유: 메신저·메모 앱이
// 따옴표를 바꾸거나 줄을 접어도 깨지지 않게(공백·줄바꿈은 읽을 때 걸러낸다).
// 파일로 저장할 때는 사람이 열어 볼 수 있게 JSON 그대로 쓴다. 읽을 때는 둘 다 받는다.

export const CODE_PREFIX = "CW1:";
export const BACKUP_VERSION = 1;
export const MAX_INPUT = 2_000_000; // 붙여 넣은 글자 수 상한. 거래 수천 건이어도 이 안에 든다

export function encodeCode(payload){
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for(let i = 0; i < bytes.length; i += 0x8000){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return CODE_PREFIX + btoa(bin);
}

// 백업 코드든 백업 파일(JSON)이든 받아서 payload로. 알아볼 수 없으면 사용자에게 보일 문장을 던진다.
export function decodeInput(text){
  const raw = String(text || "").trim();
  if(!raw) throw new Error("백업 코드를 붙여 넣어 주세요.");
  if(raw.length > MAX_INPUT) throw new Error("내용이 너무 길어요. 백업 코드가 맞는지 확인해 주세요.");
  let payload;
  try{
    if(raw.startsWith("{")){
      payload = JSON.parse(raw);
    }else{
      const i = raw.indexOf(CODE_PREFIX);
      if(i < 0) throw 0;
      const b64 = raw.slice(i + CODE_PREFIX.length).replace(/\s+/g, "");
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
  }catch(e){
    throw new Error("백업 코드를 읽지 못했어요. 앞뒤가 잘리지 않고 전부 복사됐는지 확인해 주세요.");
  }
  if(!payload || payload.app !== "coinwatch" || !payload.data || typeof payload.data !== "object"){
    throw new Error("코인워치캡 백업이 아니에요.");
  }
  if(payload.v > BACKUP_VERSION){
    throw new Error("더 새 버전의 앱에서 만든 백업이에요. 앱을 최신으로 새로 고친 뒤 다시 해 주세요.");
  }
  const d = payload.data;
  if(!Array.isArray(d.watchlist) && !Array.isArray(d.portfolios)){
    throw new Error("백업 안에 관심 코인·포트폴리오가 없어요.");
  }
  return { savedAt: payload.savedAt, data: stripMarkup(d) };
}

// 남에게 받은 코드일 수도 있다. 포트폴리오·코인 이름은 화면에 HTML로 끼워 넣어 그리는 곳이 있어서,
// 태그·따옴표가 섞여 들어오면 화면이 깨지거나 스크립트가 끼어들 수 있다. 되살리기 전에 걷어 낸다.
export function stripMarkup(v){
  if(typeof v === "string") return v.replace(/[<>"'`]/g, "");
  if(Array.isArray(v)) return v.map(stripMarkup);
  if(v && typeof v === "object"){
    const out = {};
    for(const [k, val] of Object.entries(v)){
      // JSON.parse는 "__proto__"를 그냥 키로 만들지만, 여기서 대입하면 out의 프로토타입이 바뀐다
      if(k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[stripMarkup(k)] = stripMarkup(val);
    }
    return out;
  }
  return v;
}

export function summarize(d){
  const wl = Array.isArray(d.watchlist) ? d.watchlist.length : 0;
  const pfs = Array.isArray(d.portfolios) ? d.portfolios : [];
  const trades = pfs.reduce((n, p) => n + (p && Array.isArray(p.trades) ? p.trades.length : 0), 0);
  return `관심 코인 ${wl}개 · 포트폴리오 ${pfs.length}개 (거래 ${trades}건)`;
}

export function fmtWhen(iso){
  const t = new Date(iso);
  if(isNaN(t)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${t.getFullYear()}.${p(t.getMonth()+1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
