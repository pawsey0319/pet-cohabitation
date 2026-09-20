import type { WorkItem, WorkRequest } from "./types";

export function isEnded(item: WorkItem): boolean { return item.status === "completed" || item.status === "cancelled"; }
export function isOverdue(item: WorkItem, now = Date.now()): boolean { return !isEnded(item) && item.due_at !== null && Date.parse(item.due_at) < now; }
export function goalProgress(rootId: string, items: readonly WorkItem[]) {
  const descendants = new Set([rootId]);
  for (let changed=true;changed;) { changed=false; for(const item of items) if(item.parent_id && descendants.has(item.parent_id) && !descendants.has(item.id)) { descendants.add(item.id);changed=true; } }
  const tasks=items.filter(item=>descendants.has(item.id)&&item.id!==rootId&&item.kind==="task");
  const completed=tasks.filter(item=>item.status==="completed").length;
  return { total:tasks.length, completed, cancelled:tasks.filter(item=>item.status==="cancelled").length, percent:tasks.length?Math.round(completed/tasks.length*100):0, canComplete:tasks.length>0&&completed===tasks.length };
}
export function priorityItems(items: readonly WorkItem[], ownerId:string, now=new Date()): WorkItem[] {
  const rank=(item:WorkItem)=>item.space_id && (item.assignee_id===ownerId || item.participants.includes(ownerId) || item.owner_id===ownerId)&&item.status==="pending_acceptance"?0:item.due_at&&new Date(item.due_at).toDateString()===now.toDateString()?1:2;
  return [...items].sort((a,b)=>rank(a)-rank(b)||(a.due_at??"9999").localeCompare(b.due_at??"9999")||b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));
}
export function canQueueOffline(request: WorkRequest, item?: WorkItem): boolean {
  return !request.input.space_id && !item?.space_id && ["create","edit","progress","complete","cancel"].includes(request.action);
}
export function optimisticWorkItem(ownerId:string, request:WorkRequest, current?:WorkItem, now=new Date().toISOString()):WorkItem {
  if(!canQueueOffline(request,current)) throw new Error("群协作需要联网确认");
  if(request.action!=="create"&&!current)throw new Error("请先加载事项再编辑");
  const base:WorkItem=current??{id:request.item_id!,owner_id:ownerId,space_id:null,parent_id:null,kind:"task",title:"",description:"",status:"not_started",assignee_id:ownerId,due_at:null,publication:"published",approval:"none",participants:[],review_required:false,completion_note:"",version:0,terms_version:1,terms_expires_at:null,terms_valid:true,accepted_terms_version:1,source_private_message_id:null,created_at:now,updated_at:now};
  const {confirmed:_confirmed,approved:_approved,material:_material,...input}=request.input;
  return {...base,...input,status:request.action==="complete"?"completed":request.action==="cancel"?"cancelled":request.action==="progress"?"in_progress":base.status,version:base.version+1,updated_at:now,sync_state:"pending"};
}
