import { FNG_LABEL } from "./constants.js";

// ---------- 공포·탐욕 지수 ----------
// alternative.me의 크립토 Fear & Greed Index (0=극도의 공포 ~ 100=극도의 탐욕). 하루 1회 갱신.
function fngColor(v){
  if(v < 25) return "#F05464";
  if(v < 45) return "#E8833A";
  if(v < 55) return "#D9A441";
  if(v < 75) return "#7FC77E";
  return "#3ECF8E";
}

export async function loadFearGreed(){
  const box = document.getElementById("fngMini");
  try{
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if(!res.ok) throw new Error("fng http " + res.status);
    const data = await res.json();
    const d = data.data && data.data[0];
    if(!d) throw new Error("fng empty");
    const v = Math.max(0, Math.min(100, Math.round(Number(d.value))));
    const valEl = document.getElementById("fngVal");
    valEl.textContent = v;
    valEl.style.color = fngColor(v);
    const clsEl = document.getElementById("fngClass");
    clsEl.textContent = FNG_LABEL[d.value_classification] || d.value_classification || "-";
    clsEl.style.color = fngColor(v);
    box.style.display = "block";
  }catch(e){
    if(box) box.style.display = "none";
  }
}
