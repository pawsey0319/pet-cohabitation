import { runInBackground } from "../_shared/background.ts";
import { processMemoryJobs } from "../_shared/memoryWorker.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { json,errorResponse } from "../_shared/responses.ts";
import { authenticatedUser,requirePost,serviceClient } from "../_shared/supabase.ts";
Deno.serve(async(request)=>{
  if(request.method==="OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user=await authenticatedUser(request); const client=serviceClient();
    const pet=await client.from("pets").select("id").eq("owner_id",user.id).single();
    if(pet.error) throw pet.error;
    runInBackground(processMemoryJobs(client,pet.data.id).catch(()=>undefined));
    return json(request,{queued:true});
  } catch(error) { return errorResponse(request,error); }
});
