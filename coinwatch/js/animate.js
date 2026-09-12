import { state } from "./state.js";

export const prevValues = {}; // 숫자 롤링 애니메이션용 이전 값 저장소

// wrapEl(.roll-wrap)을 자릿수(문자) 단위로 굴려서 newText로 교체.
// 이전 텍스트와 길이/구두점 구조가 같을 때만 바뀐 자리만 위/아래로 슬라이드,
// 구조가 다르면 애니메이션 없이 즉시 다시 그림.
// 등락률 셀에 방향색(초록/빨강)을 잠깐 입혔다가 CSS 애니메이션으로 서서히 지운다
export function flashChg(cellEl, dir){
  if(!cellEl || !dir) return;
  const cls = dir > 0 ? "flash-up" : "flash-down";
  cellEl.classList.remove("flash-up", "flash-down");
  void cellEl.offsetWidth; // 리플로우로 애니메이션 재시작 보장
  cellEl.classList.add(cls);
  clearTimeout(cellEl._flashTimer);
  cellEl._flashTimer = setTimeout(()=>cellEl.classList.remove("flash-up", "flash-down"), 1500);
}

export function rollUpdate(wrapEl, newText, up){
  if(!wrapEl) return;
  newText = String(newText);
  const structured = wrapEl.firstElementChild && wrapEl.firstElementChild.classList.contains("roll-col");
  const prev = structured ? wrapEl.textContent : null;
  if(structured && prev === newText) return;

  if(!structured || prev.length !== newText.length){
    wrapEl.innerHTML = "";
    for(const ch of newText){
      const col = document.createElement("span");
      col.className = "roll-col";
      const s = document.createElement("span");
      s.textContent = ch;
      col.appendChild(s);
      wrapEl.appendChild(col);
    }
    return;
  }

  const cols = wrapEl.children;
  let k = 0; // 바뀌는 자릿수 순번 — 왼쪽부터 차례로 조금씩 늦게 굴러 "샤라락" 느낌을 낸다
  for(let i = 0; i < newText.length; i++){
    if(prev[i] === newText[i]) continue;
    const delay = Math.min(k, 8) * 45;
    k++;
    const col = cols[i];
    while(col.children.length > 1) col.removeChild(col.firstElementChild); // 진행 중이던 애니메이션 정리
    const cur = col.firstElementChild;
    cur.className = ""; cur.style.cssText = "";
    const nxt = document.createElement("span");
    nxt.className = "roll-anim";
    nxt.textContent = newText[i];
    nxt.style.transform = "translateY(" + (up ? "100%" : "-100%") + ")";
    col.appendChild(nxt);
    void nxt.offsetWidth;
    requestAnimationFrame(()=>{
      const tr = "transform .3s cubic-bezier(.4,0,.2,1) " + delay + "ms";
      cur.style.transition = tr;
      nxt.style.transition = tr;
      cur.style.transform = "translateY(" + (up ? "-100%" : "100%") + ")";
      nxt.style.transform = "translateY(0)";
    });
    (function(cur, nxt, col, delay){
      setTimeout(function(){
        if(cur.parentNode === col) col.removeChild(cur);
        nxt.className = ""; nxt.style.cssText = "";
      }, 340 + delay);
    })(cur, nxt, col, delay);
  }
}

// row를 부드럽게 접은 뒤(높이/투명도 트랜지션) done() 실행 — 목록 중간 삭제가 뚝 끊기지 않게
export function collapseRow(row, done){
  const h = row.offsetHeight;
  row.style.height = h + "px";
  row.style.overflow = "hidden";
  row.style.transition = "height .28s ease, opacity .28s ease, padding .28s ease, border-width .28s ease";
  void row.offsetHeight;
  row.style.height = "0px";
  row.style.opacity = "0";
  row.style.paddingTop = "0px";
  row.style.paddingBottom = "0px";
  row.style.borderWidth = "0px";
  state.rowAnimating = true;
  setTimeout(function(){ state.rowAnimating = false; done(); }, 300);
}

// 저장된 이전 값과 비교해 오른 방향(up=true)/내린 방향(up=false)을 판단하며 롤링 적용
export function rollNumberByKey(key, wrapEl, newText, newNumeric){
  const prev = prevValues[key];
  const up = prev === undefined ? true : newNumeric >= prev;
  rollUpdate(wrapEl, newText, up);
  prevValues[key] = newNumeric;
}
