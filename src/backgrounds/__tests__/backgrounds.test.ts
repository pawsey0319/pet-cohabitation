import { backgroundColors, DEFAULT_BACKGROUND, normalizeBackground, normalizeThreadKey, resolveBackground } from "../types";
import { backgroundErrorCode, buildChatBackgroundPrompt, validateBackgroundImage } from "../../../supabase/functions/_shared/chatBackgroundPrompt";

test("per-chat choices fall back to global without changing another chat",()=>{
  const global={presetId:"mist",assetId:null,palette:"sage" as const};
  const companion={presetId:"sand",assetId:null,palette:"warm" as const};
  expect(resolveBackground({global,companion},"companion")).toEqual(companion);
  expect(resolveBackground({global,companion},"steward")).toEqual(global);
  expect(resolveBackground({},"companion")).toEqual(DEFAULT_BACKGROUND);
  expect(normalizeBackground({presetId:"sand",assetId:"11111111-1111-4111-8111-111111111111"})).toBeNull();
  expect(normalizeBackground({presetId:"arbitrary-css-url"})).toBeNull();
});

test("all supported bubble palettes retain readable contrast in both themes",()=>{
  const luminance=(hex:string)=>{const channels=hex.slice(1).match(/../g)!.map(part=>parseInt(part,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  const contrast=(a:string,b:string)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);};
  for(const dark of [false,true])for(const palette of ["warm","sage","slate"] as const){const colors=backgroundColors({...DEFAULT_BACKGROUND,palette},dark);expect(contrast(colors.userBubble,colors.userText)).toBeGreaterThanOrEqual(4.5);expect(contrast(colors.bubble,colors.text)).toBeGreaterThanOrEqual(4.5);}
});

test("local group and Agent backgrounds persist only in demo mode, unresolved routes stay usable",()=>{
  const value={presetId:"mist",assetId:null,palette:"sage" as const};
  for(const key of ["group:local-pair","group:local-circle","group:local-space-1789047311222","agent:local-space-1789047311222"]){
    expect(normalizeThreadKey(key,true)).toBe(key);
    expect(()=>normalizeThreadKey(key,false)).toThrow();
    expect(resolveBackground({[key]:value},key,true)).toEqual(value);
    expect(resolveBackground({[key]:value},key,false)).toEqual(DEFAULT_BACKGROUND);
  }
  expect(resolveBackground({global:value},"group:undefined")).toEqual(value);
});

test("rejects fake image responses and verifies bytes independently of provider MIME",()=>{
  expect(()=>validateBackgroundImage(new TextEncoder().encode('<html>upstream error with secret</html>'))).toThrow("background_invalid_image");
  expect(()=>validateBackgroundImage(new Uint8Array(9*1024*1024))).toThrow("background_invalid_image");
  const png=new Uint8Array(20);png.set([137,80,78,71,13,10,26,10]);expect(validateBackgroundImage(png)).toBe("image/png");
  const jpg=new Uint8Array(20);jpg.set([255,216,255]);expect(validateBackgroundImage(jpg)).toBe("image/jpeg");
  const webp=new Uint8Array(20);webp.set([82,73,70,70]);webp.set([87,69,66,80],8);expect(validateBackgroundImage(webp)).toBe("image/webp");
});

test("only a visual description is sent and errors never expose arbitrary upstream text",()=>{
  const prompt=buildChatBackgroundPrompt("雨后竹林，浅灰绿色");expect(prompt).toContain("雨后竹林，浅灰绿色");expect(prompt).toContain("No text");expect(prompt).toContain("center-cropped");
  expect(backgroundErrorCode(new Error('sql private-token=https://secret.example'))).toBe("background_generation_failed");
  expect(backgroundErrorCode(new Error("image_model_rate_limited"))).toBe("image_model_rate_limited");
});
