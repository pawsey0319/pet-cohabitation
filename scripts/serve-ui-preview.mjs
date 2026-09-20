import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve("test-results/mobile-keyboard-web");
const mime={".html":"text/html; charset=utf-8",".js":"application/javascript",".png":"image/png",".svg":"image/svg+xml",".ttf":"font/ttf",".json":"application/json"};
const server=createServer(async(req,res)=>{
 try{
  let p=resolve(root,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));
  if(p!==root&&!p.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  if(!(await stat(p).catch(()=>null))?.isFile())p=resolve(root,"index.html");
  const contents=await readFile(p);res.writeHead(200,{"Content-Type":mime[extname(p)]??"application/octet-stream","Cache-Control":"no-store"});res.end(contents);
 }catch{res.writeHead(404);res.end("Run the local UI web export first.");}
});
server.listen(0,"127.0.0.1",()=>console.log(`UI preview: http://127.0.0.1:${server.address().port}/login`));
