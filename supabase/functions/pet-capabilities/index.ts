import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { PET_CAPABILITIES } from "../_shared/petCapabilities.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user = await authenticatedUser(request); const client = serviceClient();
    const pet = await client.from("pets").select("id,status").eq("owner_id", user.id).maybeSingle(); if (pet.error) throw pet.error;
    if (!pet.data) throw new Error("pet_not_found");
    const [grants, receipts, spaces] = await Promise.all([
      client.from("pet_delegation_grants").select("*").eq("owner_id", user.id).eq("pet_id", pet.data.id).is("revoked_at", null).order("created_at", { ascending: false }),
      client.from("pet_action_receipts").select("*").eq("owner_id", user.id).eq("pet_id", pet.data.id).order("created_at", { ascending: false }).limit(50),
      client.from("space_members").select("space_id,spaces(name)").eq("user_id", user.id),
    ]);
    for (const result of [grants, receipts, spaces]) if (result.error) throw result.error;
    const ids = (spaces.data ?? []).map(row => row.space_id);
    const members = ids.length ? await client.from("space_members").select("space_id,user_id,profiles(nickname)").in("space_id", ids) : { data: [], error: null }; if (members.error) throw members.error;
    const resourceQueries = await Promise.all([
      client.from("work_items").select("id,title,space_id").eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(60),
      client.from("reminder_series").select("id,content").eq("owner_id",user.id).limit(40),
      client.from("pet_personal_memories").select("id,content").eq("owner_id",user.id).limit(20),
      client.from("pet_life_facts").select("id,label").eq("owner_id",user.id).eq("state","active").limit(40),
      client.from("chat_background_assets").select("id,name").eq("owner_id",user.id).is("deleted_at",null).limit(40),
    ]);
    for (const result of resourceQueries) if (result.error) throw result.error;
    const context = await client.rpc("pet_action_planning_context",{p_pet:pet.data.id,p_caller:user.id,p_space:null,p_text:""});if(context.error)throw context.error;
    const settings = await client.from("demo_settings").select("image_generation_enabled,test_ends_at").eq("id",true).single();if(settings.error)throw settings.error;
    const resources = resourceQueries.flatMap((result,index) => (result.data ?? []).map((row:any) => ({ id:row.id, label:row.title ?? row.content ?? row.label ?? row.name, domain:["work","reminder","memory","memory","background"][index], space_id:row.space_id ?? null })));
    for(const [key,domain,label] of [["preferenceEvidence","preference","object"],["styleEvidence","personality","quote"],["relationships","personality","relation"],["failedLearningJobs","personality","error_code"],["styleSignals","growth","tendency"]])
      resources.push(...(context.data?.[key] ?? []).map((row:any)=>({id:row.id,label:row[label] ?? "资料记录",domain,space_id:row.space_id ?? null})));
    const capabilities = PET_CAPABILITIES.map(cap => {
      const initialClosed=pet.data!.status==="confirmed" && ["editor.pet_create","editor.pet_generate"].includes(cap.id);
      const imagePaused=["background.generate","avatar.generate"].includes(cap.id) && (!settings.data.image_generation_enabled || settings.data.test_ends_at && Date.parse(settings.data.test_ends_at)<=Date.now());
      return {...cap,availability:{available:cap.mode!=="unavailable"&&!initialClosed&&!imagePaused,reason:cap.mode==="unavailable"?cap.parameters:initialClosed?"正式形象已确认，初始创建流程已关闭":imagePaused?"当前图片生成服务未开放":""}};
    });
    // Every result is scoped to the authenticated owner, with membership checked again.
    const current = await client.from("space_members").select("space_id").eq("user_id", user.id); if (current.error) throw current.error;
    const active = new Set(current.data?.map(row => row.space_id));
    return json(request, { enabled: Deno.env.get("PET_CAPABILITIES_ENABLED") === "true", pet_id: pet.data.id, capabilities, resources: resources.filter(row => !row.space_id || active.has(row.space_id)), grants: grants.data, receipts: receipts.data, spaces: spaces.data?.filter(row => active.has(row.space_id)), members: members.data?.filter(row => active.has(row.space_id)) });
  } catch (reason) { return errorResponse(request, reason); }
});
