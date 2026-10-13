import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
const publicFiles = ["index.html", "admin.html", "machines.html", "play.html", "monitor.html"];

fs.rmSync(output, {recursive:true, force:true});
fs.mkdirSync(output, {recursive:true});
for(const file of publicFiles){
  const nebula = process.env.VERTEX_STORE_ID === "store-nebula";
  const source = path.join(root, nebula && file === "machines.html" ? "nebula-machines.html" : file);
  if(!fs.existsSync(source)) throw new Error(`Missing public file: ${file}`);
  let html = fs.readFileSync(source, "utf8");
  if(nebula){
    html = html.replaceAll("VERTEX", "NEBULA");
    if(file === "index.html") html = html.replaceAll("/admin.html", "/machines.html").replaceAll("店舗管理", "台選び");
    if(file === "play.html"){
      html = html.replace('<p id="error"', '<p><a href="/machines.html" style="color:#bba5ff">← 台選びに戻る</a></p><p id="error"');
      html = html.replace('<p id="sendStatus"', '<p><a href="/machines.html" style="color:#bba5ff">台選びに戻る</a></p><p id="sendStatus"');
    }
  }
  fs.writeFileSync(path.join(output, file), html);
}
console.log(`Copied ${publicFiles.length} public files to dist/`);
