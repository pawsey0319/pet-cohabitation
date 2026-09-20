import { createServer } from "node:http";
/** Test-only provider: fixed synthetic output; never forwards data to a real model. */
export async function startSyntheticVisionProvider(port = 47561) {
 const calls=[], waiters=[]; let holdNext=false, release=null;
 const server=createServer(async(request,response)=>{
  if(request.method!=="POST"||request.url!=="/v1/chat/completions"||request.headers.authorization!=="Bearer synthetic-vision-integration"){response.writeHead(404);response.end();return;}
  try{
   let raw="";for await(const chunk of request){raw+=chunk;if(raw.length>12*1024*1024)throw new Error("oversized test request");}
   const body=JSON.parse(raw);calls.push(body);for(const ready of waiters.splice(0))ready();
   if(holdNext){holdNext=false;await new Promise(resolve=>{release=resolve;});release=null;}
   response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({choices:[{message:{role:"assistant",content:JSON.stringify({content:"这是一张用于接口验收的合成图片。我只描述图片，没有创建事项或保存记忆。",uncertain:false})},finish_reason:"stop"}]}));
  }catch{response.writeHead(400,{"Content-Type":"application/json"});response.end('{"error":"invalid_synthetic_request"}');}
 });
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"0.0.0.0",resolve);});
 return{calls,holdNext:()=>{holdNext=true;},release:()=>release?.(),waitForCall:async count=>{while(calls.length<count)await Promise.race([new Promise(resolve=>waiters.push(resolve)),new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error("synthetic_provider_not_called")),20000);timeout.unref();})]);},close:async()=>{release?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
