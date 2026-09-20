import {act,fireEvent,render,screen} from "@testing-library/react-native";
let mockOwner="owner-a",mockId=0;const mockList=jest.fn(),mockHandlers=new Map<string,()=>void>();
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>({profile:{id:mockOwner}})}));
jest.mock("../../theme/ThemeProvider",()=>({useAppTheme:()=>({theme:{text:"black",muted:"gray",line:"gray",card:"white",danger:"red",radius:12}})}));
jest.mock("../../lib/uuid",()=>({createRequestId:()=>`request-${++mockId}`}));
jest.mock("../repository",()=>({listWorkSuggestions:(id:string)=>mockList(id),invokeWork:jest.fn(),workOnline:async()=>true}));
jest.mock("../WorkItemsPanel",()=>({WorkEditor:()=>null,WorkItemDetailSheet:()=>null,friendlyError:(value:string)=>value}));
jest.mock("../../ui/common",()=>({AppButton:({label,onPress}:{label:string;onPress:()=>void})=>{const {Pressable,Text}=require("react-native");return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>;}}));
jest.mock("../../lib/supabase",()=>({isLocalDemoMode:false,requireSupabase:()=>({channel:()=>{const channel:{on:jest.Mock;subscribe:jest.Mock}={on:jest.fn((_event,filter,handler)=>{mockHandlers.set(filter.table,handler);return channel;}),subscribe:jest.fn(()=>channel)};return channel;},removeChannel:jest.fn(async()=>{})})}));
import {GroupWorkSuggestions} from "../GroupWorkSuggestions";
const data=(title:string)=>({authorization:{version:1,active_since:null},consents:[],suggestions:[{id:title,title,description:"合成建议",sources:[]}]});
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
beforeEach(()=>{mockOwner="owner-a";mockId=0;mockList.mockReset();mockHandlers.clear();});
test("switching groups excludes a delayed result from the prior space",async()=>{
 const old=deferred();mockList.mockReturnValueOnce(old.promise).mockResolvedValueOnce(data("新群建议"));const view=await render(<GroupWorkSuggestions spaceId="old"/>);await view.rerender(<GroupWorkSuggestions spaceId="new"/>);await fireEvent.press(await screen.findByRole("button",{name:"发现 1 件可能要跟进的事"}));expect(screen.getByText("新群建议")).toBeTruthy();await act(async()=>old.resolve(data("旧群资料")));expect(screen.queryByText("旧群资料")).toBeNull();
});
test("account change and permission invalidation immediately hide earlier suggestions",async()=>{
 mockList.mockResolvedValueOnce(data("账号甲建议"));const view=await render(<GroupWorkSuggestions spaceId="space"/>);await fireEvent.press(await screen.findByRole("button",{name:"发现 1 件可能要跟进的事"}));const next=deferred();mockList.mockReturnValueOnce(next.promise);mockOwner="owner-b";await view.rerender(<GroupWorkSuggestions spaceId="space"/>);expect(screen.queryByText("账号甲建议")).toBeNull();await act(async()=>next.resolve(data("账号乙建议")));await fireEvent.press(await screen.findByRole("button",{name:"发现 1 件可能要跟进的事"}));expect(screen.getByText("账号乙建议")).toBeTruthy();mockList.mockRejectedValueOnce(new Error("not_space_member"));await act(async()=>mockHandlers.get("space_members")!());expect(screen.queryByText("账号乙建议")).toBeNull();
});
