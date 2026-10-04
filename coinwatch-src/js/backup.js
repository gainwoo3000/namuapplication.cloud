import { STORAGE_KEY } from "./constants.js";
import { buildSavedState, storageDiagnostics, freezeSaves } from "./persist.js";
import { openOverlay, closeOverlay } from "./sheet.js";
import { showAlert, showConfirm } from "./dialog.js";
import { BACKUP_VERSION, MAX_INPUT, encodeCode, decodeInput, summarize, fmtWhen } from "./backup-codec.js";
import { t } from "./i18n.js";

// ---------- 설정 › 백업 ----------
// 저장된 데이터(관심 코인·포트폴리오·설정) 전체를 글자 한 줄(백업 코드)로 만들어 두고,
// 다른 기기나 앱을 다시 깐 뒤에 붙여 넣어 되살린다. 서버에는 아무것도 보내지 않는다.
// 코드 만들기·읽기는 backup-codec.js.

// 안드로이드 앱(WebView)은 파일 받기·파일 고르기가 앱 쪽에서 따로 연결돼 있지 않으면
// 눌러도 아무 일도 안 일어난다. 그 안에서는 파일 버튼을 숨기고 코드 복사/붙여넣기만 쓴다.
const IN_WEBVIEW = /; wv\)/.test(navigator.userAgent);

function makePayload(){
  return { app: "coinwatch", v: BACKUP_VERSION, savedAt: new Date().toISOString(), data: buildSavedState() };
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
  titleEl.textContent = isExport ? t("백업하기", "Back up") : t("불러오기", "Restore");
  exportActs.hidden = !isExport;
  importActs.hidden = isExport;
  box.readOnly = isExport;
  setHint("");
  if(isExport){
    const payload = makePayload();
    descEl.textContent = summarize(payload.data)
      + t("\n아래 코드를 전부 복사해서 메모·메신저 등에 보관해 두세요. 이 코드만 있으면 다른 기기에서도 그대로 되살릴 수 있어요.",
          "\nCopy the whole code below and keep it somewhere safe, like a note or a message to yourself. With this code you can restore everything on any device.");
    box.value = encodeCode(payload);
    box.placeholder = "";
  }else{
    descEl.textContent = t("백업해 둔 코드를 붙여 넣어 주세요. 지금 이 기기의 관심 코인·포트폴리오·설정은 백업 내용으로 바뀌어요.",
      "Paste your backup code. The watchlist, portfolios and settings on this device will be replaced with the backup.");
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
  setHint(ok ? t("복사했어요. 메모나 메신저에 붙여 넣어 보관하세요.", "Copied. Paste it into a note or message to keep it.")
             : t("자동 복사가 안 돼요. 코드 칸을 길게 눌러 전체 선택 후 복사해 주세요.", "Couldn't copy automatically. Long-press the code, select all, and copy it."), !ok);
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
  setHint(t("파일로 저장했어요. 다운로드 폴더를 확인해 주세요.", "Saved as a file. Check your Downloads folder."));
});

// ---------- 불러오기 ----------
document.getElementById("backupPickBtn").addEventListener("click", ()=> fileInput.click());
fileInput.addEventListener("change", async ()=>{
  const f = fileInput.files && fileInput.files[0];
  fileInput.value = ""; // 같은 파일을 다시 골라도 change가 오게
  if(!f) return;
  if(f.size > MAX_INPUT){ setHint(t("파일이 너무 커요. 백업 파일이 맞는지 확인해 주세요.", "That file is too large. Make sure it's a backup file."), true); return; }
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
    setHint(t("이 환경에서는 저장이 막혀 있어서 불러올 수 없어요.", "Saving is blocked here, so the backup can't be restored."), true);
    return;
  }
  const when = fmtWhen(parsed.savedAt);
  const ok = await showConfirm(
    `${when ? t(when + "에 만든 백업이에요.\n", "Backup made on " + when + ".\n") : ""}${summarize(parsed.data)}\n\n`
    + t("지금 이 기기의 관심 코인·포트폴리오·설정이 이 내용으로 바뀌어요. 불러올까요?",
        "The watchlist, portfolios and settings on this device will be replaced with this. Restore it?"));
  if(!ok) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
  }catch(e){
    await showAlert(t("저장하지 못했어요. 기기 저장공간을 확인한 뒤 다시 해 주세요.", "Couldn't save. Check your device storage and try again."));
    return;
  }
  freezeSaves();
  // 읽어 들이기(버전 옮기기·값 검사 포함)는 앱을 켤 때의 loadState()가 그대로 맡는다.
  // 화면 곳곳을 하나씩 다시 그리는 것보다 새로 여는 편이 빠뜨리는 게 없다.
  location.reload();
}
