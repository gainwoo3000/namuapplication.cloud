// 표 맨 왼쪽에 붙는 코인 로고.
// 1순위는 코인게코가 준 이미지(워커가 image 필드를 내려줄 때), 없으면 심볼 기준 아이콘 CDN을
// 차례로 시도하고, 전부 실패하면 심볼 첫 글자 아바타가 그대로 남는다.
const SYMBOL_SOURCES = [
  sym => `https://assets.coincap.io/assets/icons/${sym}@2x.png`,
  sym => `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/32/color/${sym}.png`
];

// 심볼마다 고정된 아바타 색(0~359). 같은 코인은 항상 같은 색으로 보인다.
function logoHue(sym){
  let h = 0;
  for(let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return h;
}

// 이름/심볼에 <, " 같은 문자가 들어와도 속성이 깨지지 않게
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// coin: {symbol, image?} 형태면 충분 (포트폴리오 보유 항목도 그대로 쓸 수 있음)
export function coinLogoHtml(coin){
  const sym = ((coin && coin.symbol) || "").toLowerCase();
  const letter = sym ? sym.charAt(0).toUpperCase() : "?";
  const img = coin && coin.image;
  // data-step: 지금 쓰고 있는 SYMBOL_SOURCES 인덱스. 코인게코 이미지로 시작하면 -1.
  const step = img ? -1 : 0;
  const src = img || (sym ? SYMBOL_SOURCES[0](sym) : "");
  const tag = src
    ? `<img class="coin-logo-img" src="${esc(src)}" data-sym="${esc(sym)}" data-step="${step}" alt="" loading="lazy">`
    : "";
  return `<span class="coin-logo" style="--logo-h:${logoHue(sym)}"><b>${letter}</b>${tag}</span>`;
}

// 이미지 로드 실패는 버블링되지 않으므로 캡처 단계에서 한 번만 받아 처리한다.
document.addEventListener("error", (e)=>{
  const img = e.target;
  if(!img || img.tagName !== "IMG" || !img.classList.contains("coin-logo-img")) return;
  const sym = img.dataset.sym || "";
  const next = Number(img.dataset.step) + 1;
  if(sym && next < SYMBOL_SOURCES.length){
    img.dataset.step = next;
    img.src = SYMBOL_SOURCES[next](sym);
  }else{
    img.remove(); // 남은 소스가 없으면 글자 아바타로 둔다
  }
}, true);
