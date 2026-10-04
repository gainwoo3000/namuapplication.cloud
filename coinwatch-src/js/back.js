// ---------- 안드로이드 앱의 뒤로 가기 버튼 ----------
// 앱(WebView)은 뒤로 가기가 눌리면 먼저 window.cwHandleBack()을 부른다(MainActivity.kt).
// 화면 안에 닫을 게 있으면 하나 닫고 true — 앱은 더 하지 않는다. false면 앱이 WebView 방문 기록을
// 한 칸 되돌리거나(거래소 링크로 나갔다가 돌아오기) 시스템 기본 동작(앱을 뒤로 보내기)을 한다.
// 위에 떠 있는 것부터 하나씩: 다이얼로그 → 아래 창 → 말풍선·펼친 패널 → 환율 그래프
//   → 코인 페이지(트레이딩뷰 상세를 보고 있으면 자체 차트로 먼저) → 첫 탭(시세)으로.
// 브라우저에서는 아무도 부르지 않는다 — 그쪽 뒤로 가기는 방문 기록(#coin/<id>)이 맡는다(chart.js).
import { cancelDialog } from "./dialog.js";
import { closeTopSheet } from "./sheet.js";
import { closeChart, closeExPop } from "./chart.js";
import { closeFxChart } from "./fxchart.js";
import { currentTabName, activateTab, TAB_ORDER } from "./settings.js";

const $ = id => document.getElementById(id);

// style.display로 여닫는 펼침 패널
function hidePanel(id, btnId){
  const el = $(id);
  if(!el || el.style.display === "none") return false;
  el.style.display = "none";
  if(btnId) $(btnId).classList.remove("active");
  return true;
}

window.cwHandleBack = () => {
  if(cancelDialog()) return true;
  if(closeTopSheet()) return true;
  if(closeExPop()) return true;
  if(hidePanel("priceHelpPop") || hidePanel("addCoinPanel", "addCoinBtn") || hidePanel("pfPortfolioPanel")) return true;
  if($("fxPanel").style.display === "block"){ closeFxChart(); return true; }
  if($("chartPanel").classList.contains("open")){
    if(!$("tvChartView").hidden) $("tvBackBtn").click();
    else closeChart();
    return true;
  }
  if(currentTabName() !== TAB_ORDER[0]){ activateTab(TAB_ORDER[0]); return true; }
  return false;
};
