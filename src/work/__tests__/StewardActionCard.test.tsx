import {act,fireEvent,render,screen,waitFor} from "@testing-library/react-native";
let mockOwner="a",mockId=0;const mockQuery=jest.fn(),mockInvoke=jest.fn(),mockHandlers=new Map<string,()=>void>();
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>({profile:{id:mockOwner}})}));
jest.mock("../../theme/ThemeProvider",()=>({useAppTheme:()=>({theme:{text:"black",muted:"gray",line:"gray",card:"white",danger:"red"}})}));
jest.mock("../../lib/uuid",()=>({createRequestId:()=>`request-${++mockId}`}));
jest.mock("expo-router",()=>({router:{push:jest.fn()}}));
jest.mock("../repository",()=>({invokeWork:(...args:unknown[])=>mockInvoke(...args)}));
jest.mock("../../ui/common",()=>({AppButton:({label,onPress,disabled}:{label:string;onPress:()=>void;disabled?:boolean})=>{const{Pressable,Text}=require("react-native");return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>;}}));
jest.mock("../../lib/supabase",()=>({isLocalDemoMode:false,requireSupabase:()=>({from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:mockQuery};return q;},channel:()=>{const c:any={on:(_event:unknown,filter:any,handler:()=>void)=>{mockHandlers.set(filter.table,handler);return c;},subscribe:()=>c};return c;},removeChannel:async()=>{}})}));
import {StewardActionCard} from "../StewardActionCard";
const preview={id:"preview",space_id:"space",space_name:"合成小群",exact_content:"逐字发送的合成内容",status:"pending",version:1,expires_at:"2099-01-01",message_id:null};
beforeEach(()=>{mockOwner="a";mockId=0;mockQuery.mockReset().mockResolvedValue({data:preview});mockInvoke.mockReset();mockHandlers.clear();});
test("rendering a preview never executes; confirmation retry retains the original request ID",async()=>{
 await render(<StewardActionCard sourceMessageId="source"/>);await screen.findByText(preview.exact_content);expect(mockInvoke).not.toHaveBeenCalled();mockInvoke.mockRejectedValueOnce(new Error("network error"));await fireEvent.press(screen.getByRole("button",{name:"本人确认，逐字发布"}));await screen.findByText(/操作未确认成功/);const first=mockInvoke.mock.calls[0][1];mockQuery.mockResolvedValue({data:{...preview,status:"confirmed",version:2,message_id:"posted"}});mockInvoke.mockResolvedValue({outcome:"published"});await fireEvent.press(screen.getByRole("button",{name:"本人确认，逐字发布"}));await screen.findByText("异宠代本人发布 · 本人已确认");expect(mockInvoke.mock.calls[1][1]).toEqual(first);
});
test("forget clears a displayed preview and cannot be overwritten by an old in-flight read",async()=>{
 await render(<StewardActionCard sourceMessageId="source"/>);await screen.findByText(preview.exact_content);let finish!:(value:unknown)=>void;mockQuery.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({data:null});await act(async()=>mockHandlers.get("pet_steward_previews")!());await act(async()=>mockHandlers.get("pet_private_context_exclusions")!());expect(screen.queryByText(preview.exact_content)).toBeNull();await act(async()=>finish({data:preview}));expect(screen.queryByText(preview.exact_content)).toBeNull();
});
test("account switch and membership revoke immediately hide the prior private preview",async()=>{
 const view=await render(<StewardActionCard sourceMessageId="source"/>);await screen.findByText(preview.exact_content);mockOwner="b";mockQuery.mockResolvedValue({data:null});await view.rerender(<StewardActionCard sourceMessageId="source"/>);expect(screen.queryByText(preview.exact_content)).toBeNull();await waitFor(()=>expect(mockQuery).toHaveBeenCalledTimes(2));mockQuery.mockResolvedValueOnce({data:preview});await act(async()=>mockHandlers.get("pet_steward_previews")!());await screen.findByText(preview.exact_content);mockQuery.mockResolvedValue({data:null});await act(async()=>mockHandlers.get("space_members")!());expect(screen.queryByText(preview.exact_content)).toBeNull();
});
