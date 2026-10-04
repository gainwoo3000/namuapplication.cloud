// coinwatch-src/ (원본) → coinwatch/ (배포본, GitHub Pages가 그대로 서비스)
//   - js/boot.js(→ main.js)에서 import를 따라가며 JS를 파일 하나로 합치고 줄인다(minify)
//   - styles.css도 줄인다
//   - 결과 파일 이름에 내용 해시를 붙인다(assets/boot-XXXX.js) → 캐시 무효화가 저절로 된다
//   - index.html의 CSS·JS 주소를 그 파일로 바꾸고, APP_VERSION에 빌드 시각(KST)을 넣는다
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "coinwatch-src");
const OUT = path.join(root, "coinwatch");
const ASSETS = path.join(OUT, "assets");

// v.YYMMDD.HHMM (한국 시각)
function kstVersion(){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `v.${p.year}${p.month}${p.day}.${p.hour}${p.minute}`;
}

// 예전 index.html이 가리키던 assets 파일들. 배포 직후 HTML을 캐시해 둔 폰(Pages는 10분 캐시)이
// 옛 JS를 찾다가 404가 나지 않게, 바로 직전 빌드 파일까지는 지우지 않고 남겨 둔다.
function referencedAssets(html){
  const names = new Set();
  for(const m of html.matchAll(/assets\/([\w.-]+)/g)){
    names.add(m[1]);
    names.add(m[1] + ".map");
  }
  return names;
}

function replaceOnce(html, from, to){
  if(!html.includes(from)) throw new Error(`index.html에서 "${from}"를 찾지 못했습니다 — scripts/build.mjs를 같이 고쳐 주세요`);
  return html.replace(from, to);
}

const version = kstVersion();
const indexOut = path.join(OUT, "index.html");
const keep = fs.existsSync(indexOut) ? referencedAssets(fs.readFileSync(indexOut, "utf8")) : new Set();

const result = await esbuild.build({
  entryPoints: [path.join(SRC, "js/boot.js"), path.join(SRC, "styles.css")],
  outdir: ASSETS,
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  // 원본이 이미 폰에서 그대로 돌던 문법이라, 그보다 새 문법이 섞여 들어오지 않게만 막는다
  target: "es2020",
  sourcemap: "linked",
  metafile: true,
  legalComments: "none",
  logLevel: "info",
});

const outputs = Object.entries(result.metafile.outputs).filter(([f]) => !f.endsWith(".map"));
const pick = ext => {
  const f = outputs.find(([f]) => f.endsWith(ext));
  return "assets/" + path.basename(f[0]);
};
const jsFile = pick(".js");
const cssFile = pick(".css");

let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
html = replaceOnce(html, 'window.APP_VERSION = "dev";', `window.APP_VERSION = "${version}";`);
html = replaceOnce(html, '<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="${cssFile}">`);
html = replaceOnce(html, '<script type="module" src="js/boot.js"></script>', `<script type="module" src="${jsFile}"></script>`);
fs.writeFileSync(indexOut, html);

// 이번 빌드와 직전 빌드가 쓰는 것만 남기고 정리
const now = referencedAssets(html);
for(const f of fs.readdirSync(ASSETS)){
  if(!now.has(f) && !keep.has(f)) fs.rmSync(path.join(ASSETS, f));
}

console.log(`\n${version}  →  coinwatch/${jsFile}, coinwatch/${cssFile}`);
