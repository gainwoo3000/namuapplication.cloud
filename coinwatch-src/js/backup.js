import { STORAGE_KEY } from "./constants.js";
import { buildSavedState, storageDiagnostics, freezeSaves } from "./persist.js";
import { openOverlay, closeOverlay } from "./sheet.js";
import { showAlert, showConfirm } from "./dialog.js";

// ---------- 설정 › 백업 ----------
// 저장된 데이터(관심 코인·포트폴리오·설정) 전체를 글자 한 줄(백업 코드)로 만들어 두고,
// 다른 기기나 앱을 다시 깐 뒤에 붙여 넣어 되살린다. 서버에는 아무것도 보내지 않는다.
//
// 코드 = "CW1:" + base64(UTF-8 JSON). JSON 그대로 두지 않는 이유: 메신저·메모 앱이
// 따옴표를 바꾸거나 줄을 접어도 깨지지 않게(공백·줄바꿈은 읽을 때 걸러낸다).
// 파일로 저장할 때는 사람이 열어 볼 수 있게 JSON 그대로 쓴다. 읽을 때는 둘 다 받는다.

const CODE_PREFIX = "CW1:";
const BACKUP_VERSION = 1;
const MAX_INPUT = 2_000_000; // 붙여 넣은 글자 수 상한. 거래 수천 건이어도 이 안에 든다

// 안드로이드 앱(WebView)은 파일 받기·파일 고르기가 앱 쪽에서 따로 연결돼 있지 않으면
// 눌러도 아무 일도 안 일어난다. 그 안에서는 파일 버튼을 숨기고 코드 복사/붙여넣기만 쓴다.
const IN_WEBVIEW = /; wv\)/.test(navigator.userAgent);

function makePayload(){
  return { app: "coinwatch", v: BACKUP_VERSION, savedAt: new Date().toISOString(), data: buildSavedState() };
}

function encodeCode(payload){
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for(let i = 0; i < bytes.length; i += 0x8000){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return CODE_PREFIX + btoa(bin);
}

// 백업 코드든 백업 파일(JSON)이든 받아서 payload로. 알아볼 수 없으면 사용자에게 보일 문장을 던진다.
function decodeInput(text){
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
function stripMarkup(v){
  if(typeof v === "string") return v.replace(/[<>"'`]/g, "");
  if(Array.isArray(v)) return v.map(stripMarkup);
  if(v && typeof v === "object"){
    const out = {};
    for(const [k, val] of Object.entries(v)) out[stripMarkup(k)] = stripMarkup(val);
    return out;
  }
  return v;
}

function summarize(d){
  const wl = Array.isArray(d.watchlist) ? d.watchlist.length : 0;
  const pfs = Array.isArray(d.portfolios) ? d.portfolios : [];
  const trades = pfs.reduce((n, p) => n + (p && Array.isArray(p.trades) ? p.trades.length : 0), 0);
  return `관심 코인 ${wl}개 · 포트폴리오 ${pfs.length}개 (거래 ${trades}건)`;
}

function fmtWhen(iso){
  const t = new Date(iso);
  if(isNaN(t)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${t.getFullYear()}.${p(t.getMonth()+1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

// ---------- 창 ----------
const sheet = document.getElementById("backupSheet");
const titleEl = document.getElementById("backupTitle");
const descEl = document.getElementById("backupDesc");
const box = document.getElementById("backupText");
const hintEl = document.getElementById("backupHint");
const exportActs = document.getElementById("backupExportActs");
const importActs = document.getElementById("backupImportActs");
const fileInput = document.getElementById("backupFileInput");

document.getElementById("backupFileBtn").hidden = IN_WEBVIEW;
document.getElementById("backupPickBtn").hidden = IN_WEBVIEW;

function setHint(msg, isError){
  hintEl.textContent = msg || "";
  hintEl.classList.toggle("err", !!isError);
}

function openBackupSheet(mode){
  const isExport = mode === "export";
  titleEl.textContent = isExport ? "백업하기" : "불러오기";
  exportActs.hidden = !isExport;
  importActs.hidden = isExport;
  box.readOnly = isExport;
  setHint("");
  if(isExport){
    const payload = makePayload();
    descEl.textContent = summarize(payload.data)
      + "\n아래 코드를 전부 복사해서 메모·메신저 등에 보관해 두세요. 이 코드만 있으면 다른 기기에서도 그대로 되살릴 수 있어요.";
    box.value = encodeCode(payload);
    box.placeholder = "";
  }else{
    descEl.textContent = "백업해 둔 코드를 붙여 넣어 주세요. 지금 이 기기의 관심 코인·포트폴리오·설정은 백업 내용으로 바뀌어요.";
    box.value = "";
    box.placeholder = "CW1:…";
  }
  box.scrollTop = 0;
  openOverlay(sheet);
}

document.getElementById("backupExportBtn").addEventListener("click", ()=> openBackupSheet("export"));
document.getElementById("backupImportBtn").addEventListener("click", ()=> openBackupSheet("import"));

sheet.addEventListener("click", e=>{
  if(e.target.closest("[data-close]") || !e.target.closest(".sheet")) closeOverlay(sheet);
});
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && sheet.classList.contains("open")) closeOverlay(sheet);
});

// 코드 칸을 누르면 전체 선택 — 휴대폰에서 긴 글자를 손으로 끝까지 드래그하기 어렵다
box.addEventListener("focus", ()=>{ if(box.readOnly) box.select(); });

// ---------- 백업하기 ----------
document.getElementById("backupCopyBtn").addEventListener("click", async ()=>{
  const text = box.value;
  let ok = false;
  try{
    await navigator.clipboard.writeText(text);
    ok = true;
  }catch(e){
    // 클립보드 API가 막힌 환경(일부 WebView·http) — 예전 방식으로 한 번 더
    try{
      box.focus();
      box.select();
      ok = document.execCommand("copy");
    }catch(e2){}
  }
  setHint(ok ? "복사했어요. 메모나 메신저에 붙여 넣어 보관하세요."
             : "자동 복사가 안 돼요. 코드 칸을 길게 눌러 전체 선택 후 복사해 주세요.", !ok);
});

document.getElementById("backupFileBtn").addEventListener("click", ()=>{
  const payload = makePayload();
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coinwatch-backup-${payload.savedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
  setHint("파일로 저장했어요. 다운로드 폴더를 확인해 주세요.");
});

// ---------- 불러오기 ----------
document.getElementById("backupPickBtn").addEventListener("click", ()=> fileInput.click());
fileInput.addEventListener("change", async ()=>{
  const f = fileInput.files && fileInput.files[0];
  fileInput.value = ""; // 같은 파일을 다시 골라도 change가 오게
  if(!f) return;
  if(f.size > MAX_INPUT){ setHint("파일이 너무 커요. 백업 파일이 맞는지 확인해 주세요.", true); return; }
  box.value = await f.text();
  restoreFrom(box.value);
});

document.getElementById("backupRestoreBtn").addEventListener("click", ()=> restoreFrom(box.value));
box.addEventListener("input", ()=>{ if(!box.readOnly) setHint(""); });

async function restoreFrom(text){
  let parsed;
  try{
    parsed = decodeInput(text);
  }catch(e){
    setHint(e.message, true);
    return;
  }
  if(!storageDiagnostics().writable){
    setHint("이 환경에서는 저장이 막혀 있어서 불러올 수 없어요.", true);
    return;
  }
  const when = fmtWhen(parsed.savedAt);
  const ok = await showConfirm(
    `${when ? when + "에 만든 백업이에요.\n" : ""}${summarize(parsed.data)}\n\n`
    + "지금 이 기기의 관심 코인·포트폴리오·설정이 이 내용으로 바뀌어요. 불러올까요?");
  if(!ok) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
  }catch(e){
    await showAlert("저장하지 못했어요. 기기 저장공간을 확인한 뒤 다시 해 주세요.");
    return;
  }
  freezeSaves();
  // 읽어 들이기(버전 옮기기·값 검사 포함)는 앱을 켤 때의 loadState()가 그대로 맡는다.
  // 화면 곳곳을 하나씩 다시 그리는 것보다 새로 여는 편이 빠뜨리는 게 없다.
  location.reload();
}
