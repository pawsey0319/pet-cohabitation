import {act,render,screen,waitFor} from "@testing-library/react-native";
let mockId=0,mockOwner="owner-a";const mockQueries=jest.fn(),mockChannels=new Map<string,{on:jest.Mock;subscribe:jest.Mock;subscribed:boolean;handlers:Map<string,()=>void>}>();
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>({profile:{id:mockOwner}})}));
jest.mock("../../theme/ThemeProvider",()=>({useAppTheme:()=>({theme:{text:"black",muted:"gray",line:"gray",card:"white",danger:"red",radius:12}})}));
jest.mock("../../lib/uuid",()=>({createRequestId:()=>`request-${++mockId}`}));
jest.mock("../repository",()=>({invokeWork:jest.fn()}));
jest.mock("../WorkItemsPanel",()=>({WorkEditor:()=>null,WorkItemDetailSheet:()=>null,friendlyError:(value:string)=>value}));
jest.mock("../WorkItemCard",()=>({WorkItemCard:()=>null}));
jest.mock("../../notifications/ReminderManager",()=>({ReminderManager:()=>null}));
jest.mock("../../notifications/reminders",()=>({validateReminder:()=>null}));
jest.mock("../../components/KeyboardLayout",()=>({KeyboardScreen:require("react-native").View,KeyboardScrollView:require("react-native").ScrollView}));
jest.mock("../../ui/common",()=>({AppButton:()=>null,AppField:()=>null}));
jest.mock("../../lib/supabase",()=>({isLocalDemoMode:false,requireSupabase:()=>({from:()=>{const query:{select:jest.Mock;eq:jest.Mock;maybeSingle:jest.Mock}={select:jest.fn(()=>query),eq:jest.fn(()=>query),maybeSingle:mockQueries};return query;},channel:(name:string)=>{const existing=mockChannels.get(name);if(existing)return existing;const channel:{subscribed:boolean;handlers:Map<string,()=>void>;on:jest.Mock;subscribe:jest.Mock}={subscribed:false,handlers:new Map<string,()=>void>(),on:jest.fn((_event,filter,handler)=>{if(channel.subscribed)throw new Error("cannot add callbacks after subscribe");channel.handlers.set(filter.table,handler);return channel;}),subscribe:jest.fn(()=>{channel.subscribed=true;return channel;})};mockChannels.set(name,channel);return channel;},removeChannel:jest.fn(async()=>{})})}));
import {WorkActionCard} from "../WorkActionCard";
const record={id:"plan",source_message_id:"source",status:"suggested",version:1,plan:{domain:"work",action:"create",scope:"personal",space_id:null,input:{title:"私人任务草案"}},result:null};
beforeEach(()=>{mockId=0;mockOwner="owner-a";mockChannels.clear();mockQueries.mockReset().mockResolvedValue({data:null});});
test("multiple cards for one source and immediate remounts own separate realtime subscriptions",async()=>{
 const a=await render(<WorkActionCard sourceMessageId="source"/>),b=await render(<WorkActionCard sourceMessageId="source"/>);expect(mockChannels.size).toBe(2);await a.unmount();await render(<WorkActionCard sourceMessageId="source"/>);expect(mockChannels.size).toBe(3);await b.unmount();
});
test("forget invalidation clears the card and rejects an older result still in flight",async()=>{
 mockQueries.mockResolvedValueOnce({data:record});await render(<WorkActionCard sourceMessageId="source"/>);expect(await screen.findByText("私人任务草案")).toBeTruthy();let finish!:(value:unknown)=>void;mockQueries.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({data:null});const channel=[...mockChannels.values()][0];await act(async()=>channel.handlers.get("pet_companion_action_plans")!());await act(async()=>channel.handlers.get("pet_private_context_exclusions")!());await act(async()=>finish({data:record}));expect(screen.queryByText("私人任务草案")).toBeNull();
});
test("changing account never renders an old account's action card",async()=>{
 mockQueries.mockResolvedValueOnce({data:record});const view=await render(<WorkActionCard sourceMessageId="source"/>);expect(await screen.findByText("私人任务草案")).toBeTruthy();mockOwner="owner-b";await view.rerender(<WorkActionCard sourceMessageId="source"/>);expect(screen.queryByText("私人任务草案")).toBeNull();await waitFor(()=>expect(mockQueries).toHaveBeenCalledTimes(2));
});

