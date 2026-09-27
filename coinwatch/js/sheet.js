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
