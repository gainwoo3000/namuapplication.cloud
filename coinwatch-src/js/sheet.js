// ---------- 아래에서 올라오는 선택 창(바텀시트) ----------
// openSheet({ title, options:[{ value, label, danger? }], selected, onPick })
// 고르면 onPick(value)을 부르고 닫힌다. 바깥(어두운 배경)을 누르거나 Esc로도 닫힌다.
// 창은 하나만 만들어 두고 내용만 갈아끼운다.

let overlay = null;
let onPickCb = null;

function ensureSheet(){
  if(overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-title"></div>
    <div class="sheet-list"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e=>{
    const opt = e.target.closest(".sheet-opt");
    if(opt){
      const cb = onPickCb;
      closeSheet();
      if(cb) cb(opt.dataset.value);
      return;
    }
    if(!e.target.closest(".sheet")) closeSheet();
  });
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape" && overlay.classList.contains("open")) closeSheet();
  });
  return overlay;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

export function openSheet({ title, options, selected, onPick }){
  const el = ensureSheet();
  onPickCb = onPick;
  el.querySelector(".sheet-title").textContent = title || "";
  el.querySelector(".sheet-title").hidden = !title;
  el.querySelector(".sheet-list").innerHTML = options.map(o => {
    const on = selected !== undefined && String(o.value) === String(selected);
    return `<button type="button" class="sheet-opt${on ? " selected" : ""}${o.danger ? " danger" : ""}" data-value="${esc(o.value)}">`
      + `<span>${esc(o.label)}</span>${on ? '<span class="sheet-check">✓</span>' : ""}</button>`;
  }).join("");
  el.querySelector(".sheet-list").scrollTop = 0;
  // 한 프레임 뒤에 .open — 붙이자마자 열면 아래에서 올라오는 전환이 먹지 않는다
  el.classList.add("show");
  requestAnimationFrame(()=> requestAnimationFrame(()=> el.classList.add("open")));
}

export function closeSheet(){
  if(!overlay || !overlay.classList.contains("open")) return;
  onPickCb = null;
  overlay.classList.remove("open");
  setTimeout(()=>{ if(!overlay.classList.contains("open")) overlay.classList.remove("show"); }, 260);
}

// ---------- 폼이 든 아래 창(거래 입력·거래소 설정·백업) 공통 ----------
// 마크업이 이미 있는 .sheet-overlay를 여닫는다. 위의 openSheet는 선택지 목록 전용.
// openSheet와 같은 방식: 붙인 다음 프레임에 .open을 걸어야 아래에서 올라오는 전환이 먹는다
export function openOverlay(el){
  el.classList.add("show");
  syncViewport();
  requestAnimationFrame(()=> requestAnimationFrame(()=> el.classList.add("open")));
}
export function closeOverlay(el){
  // "open"은 두 프레임 뒤에 붙으므로, 그 전에 닫혀도 확실히 걷히게 "show"를 본다
  if(!el.classList.contains("show")) return;
  if(document.activeElement && el.contains(document.activeElement)) document.activeElement.blur(); // 키보드부터 내린다
  el.classList.remove("open");
  setTimeout(()=>{ if(!el.classList.contains("open")) el.classList.remove("show"); }, 260);
}

// 키보드가 올라오면 보이는 영역(visualViewport)이 줄어든다. 창 아래쪽을 키보드 바로 위에 붙이고,
// 높이도 그 영역을 넘지 않게 해서 입력칸이 키보드에 가리지 않게 한다.
// (iOS는 키보드가 떠도 레이아웃은 그대로라 fixed bottom:0이 키보드 밑에 깔리고, 화면이 통째로 밀려 올라간다)
export function syncViewport(){
  const vv = window.visualViewport;
  if(!vv) return;
  const root = document.documentElement.style;
  root.setProperty("--vv-top", vv.offsetTop + "px");
  root.setProperty("--vv-h", vv.height + "px");
  root.setProperty("--vv-bottom", Math.max(0, window.innerHeight - vv.offsetTop - vv.height) + "px");
}
if(window.visualViewport){
  window.visualViewport.addEventListener("resize", syncViewport);
  window.visualViewport.addEventListener("scroll", syncViewport);
}
