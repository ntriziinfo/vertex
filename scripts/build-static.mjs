import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
const publicFiles = ["index.html", "admin.html", "machines.html", "play.html"];

fs.rmSync(output, {recursive:true, force:true});
fs.mkdirSync(output, {recursive:true});
for(const file of publicFiles){
  const source = path.join(root, file);
  if(!fs.existsSync(source)) throw new Error(`Missing public file: ${file}`);
  fs.copyFileSync(source, path.join(output, file));
}
console.log(`Copied ${publicFiles.length} public files to dist/`);
