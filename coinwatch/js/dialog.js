// 브라우저 기본 alert()/confirm()/prompt()는 다크+골드 테마 안에서 붕 떠 보여서,
// 같은 패널 스타일(변수 재사용)로 만든 커스텀 다이얼로그로 대체.
// 전부 Promise를 반환 — 호출부에서 필요하면 await, 필요 없으면 그냥 호출만 해도 됨.

let overlayEl = null;

function ensureOverlay(){
  if(overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.className = "dialog-overlay";
  overlayEl.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-msg"></div>
      <input class="dialog-input" style="display:none;">
      <div class="dialog-actions"></div>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener("mousedown", (e)=>{
    if(e.target === overlayEl) overlayEl._onCancel && overlayEl._onCancel();
  });
  return overlayEl;
}

function openDialog({ message, showInput, defaultValue, cancelValue, buttons }){
  return new Promise(resolve => {
    const el = ensureOverlay();
    el.querySelector(".dialog-msg").textContent = message;
    const input = el.querySelector(".dialog-input");
    if(showInput){
      input.style.display = "block";
      input.value = defaultValue || "";
    }else{
      input.style.display = "none";
    }

    function close(result){
      el.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    el._onCancel = ()=> close(cancelValue);

    function onKey(e){
      if(e.key === "Escape") close(cancelValue);
      if(e.key === "Enter" && showInput) close(input.value);
    }

    const actions = el.querySelector(".dialog-actions");
    actions.innerHTML = "";
    buttons.forEach(b=>{
      const btn = document.createElement("button");
      btn.className = "wt-btn" + (b.primary ? " active" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", ()=> close(b.useInput ? input.value : b.value));
      actions.appendChild(btn);
    });

    document.addEventListener("keydown", onKey);
    el.classList.add("open");
    if(showInput){ input.focus(); input.select(); }
  });
}

export function showAlert(message){
  return openDialog({
    message, showInput:false, cancelValue:true,
    buttons:[{ label:"확인", value:true, primary:true }]
  });
}

export function showConfirm(message){
  return openDialog({
    message, showInput:false, cancelValue:false,
    buttons:[
      { label:"취소", value:false },
      { label:"확인", value:true, primary:true }
    ]
  });
}

export function showPrompt(message, defaultValue){
  return openDialog({
    message, showInput:true, defaultValue, cancelValue:null,
    buttons:[
      { label:"취소", value:null },
      { label:"확인", useInput:true, primary:true }
    ]
  });
}
