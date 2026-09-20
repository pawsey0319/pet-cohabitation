import { canQueueOffline,goalProgress,isOverdue,optimisticWorkItem,priorityItems } from "../domain";
import type { WorkItem,WorkRequest } from "../types";

const item=(id:string,overrides:Partial<WorkItem>={}):WorkItem=>({id,owner_id:"me",kind:"task",title:id,description:"",space_id:null,parent_id:null,assignee_id:"me",due_at:null,status:"not_started",publication:"published",approval:"none",participants:[],review_required:false,completion_note:"",version:1,terms_version:1,terms_expires_at:null,terms_valid:true,accepted_terms_version:1,source_private_message_id:null,created_at:"2026-09-10T00:00:00Z",updated_at:"2026-09-10T00:00:00Z",...overrides});
test("cancelled descendants never inflate goal completion",()=>{
 const rows=[item("goal",{kind:"goal"}),item("stage",{kind:"milestone",parent_id:"goal"}),item("a",{parent_id:"stage",status:"completed"}),item("b",{parent_id:"stage",status:"cancelled"})];
 expect(goalProgress("goal",rows)).toEqual({total:2,completed:1,cancelled:1,percent:50,canComplete:false});
 expect(goalProgress("goal",rows.slice(0,2)).canComplete).toBe(false);
});
test("offline supports personal writes, never group votes or assignments",()=>{
 const request:WorkRequest={action:"edit",request_id:"one",item_id:"task",expected_version:1,input:{title:"local"}};
 expect(canQueueOffline(request,item("task"))).toBe(true);expect(canQueueOffline(request,item("task",{space_id:"group"}))).toBe(false);
 expect(canQueueOffline({...request,action:"accept"},item("task"))).toBe(false);
 expect(canQueueOffline({...request,action:"create",input:{space_id:"group"}})).toBe(false);
});
test("optimistic edits retain the base version progression and pending status",()=>{
 const prior=item("task");const updated=optimisticWorkItem("me",{action:"edit",request_id:"one",item_id:"task",expected_version:1,input:{title:"new",due_at:null}},prior);
 expect(updated).toMatchObject({title:"new",version:2,terms_version:1,sync_state:"pending",due_at:null});expect(prior.title).toBe("task");
 const complete=optimisticWorkItem("me",{action:"complete",request_id:"two",item_id:"task",expected_version:2,input:{completion_note:"done"}},updated);expect(complete.version).toBe(3);expect(complete.status).toBe("completed");
});
test("confirmation then today's deadline precede other pending work",()=>{
 const now=new Date("2026-09-11T12:00:00Z");const rows=[item("later",{due_at:"2026-09-12T16:00:00Z"}),item("today",{due_at:"2026-09-11T14:00:00Z"}),item("accept",{space_id:"group",status:"pending_acceptance"})];
 expect(priorityItems(rows,"me",now).map(item=>item.id)).toEqual(["accept","today","later"]);
 expect(isOverdue(item("over",{due_at:"2026-09-10T00:00:00Z"}),now.valueOf())).toBe(true);
 expect(isOverdue(item("done",{due_at:"2026-09-10T00:00:00Z",status:"completed"}),now.valueOf())).toBe(false);
});
