import {act,fireEvent,render,screen,waitFor} from "@testing-library/react-native";
let mockOwner="a";const mockRpc=jest.fn(),mockInvoke=jest.fn(),mockHandlers=new Map<string,()=>void>();let mockStatus:(status:string)=>void=()=>{};
jest.mock("expo-router",()=>({router:{push:jest.fn()},useFocusEffect:(callback:()=>()=>void)=>require("react").useEffect(callback,[callback])}));
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>({profile:{id:mockOwner},isLocalDemo:false})}));
jest.mock("../../theme/ThemeProvider",()=>({useAppTheme:()=>({theme:{text:"black",muted:"gray",primary:"blue",line:"gray",card:"white",danger:"red",radius:12}})}));
jest.mock("../../components/KeyboardLayout",()=>({KeyboardScrollView:require("react-native").ScrollView,KeyboardTextInput:require("react-native").TextInput}));
jest.mock("../../ui/common",()=>({AppButton:({label,disabled,onPress}:{label:string;disabled:boolean;onPress:()=>void})=>{const {Pressable,Text}=require("react-native");return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>;}}));
jest.mock("../../lib/supabase",()=>({requireSupabase:()=>({rpc:mockRpc,functions:{invoke:mockInvoke},channel:()=>{const channel:{on:jest.Mock;subscribe:jest.Mock}={on:jest.fn((_event,filter,handler)=>{mockHandlers.set(filter.table,handler);return channel;}),subscribe:jest.fn(callback=>{mockStatus=callback;return channel;})};return channel;},removeChannel:jest.fn(async()=>{})})}));
import {UnifiedSearch} from "../UnifiedSearch";
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
function row(id:string){return {id,type:"work",title:`事项 ${id}`,snippet:`资料 ${id}`,createdAt:"2026-09-11T00:00:00Z",spaceId:null,sourceMessageId:null,route:`/items?itemId=${id}`};}
async function press(label:string){await fireEvent.press(screen.getByRole("button",{name:label}));}
beforeEach(()=>{mockOwner="a";mockRpc.mockReset().mockResolvedValue({data:[],error:null});mockInvoke.mockReset().mockResolvedValue({data:{results:[]},error:null});mockHandlers.clear();});

test("changing type discards old request and immediately permits another search",async()=>{
 const old=deferred();mockRpc.mockReturnValueOnce(old.promise);await render(<UnifiedSearch initialQuery="资料"/>);await press("查找");await press("事项");await press("查找");expect(mockRpc).toHaveBeenCalledTimes(2);await act(async()=>old.resolve({data:[row("old")]}));expect(screen.queryByText("事项 old")).toBeNull();
});
test("date and status changes invalidate in-flight results and hidden status never leaks to other types",async()=>{
 const first=deferred();mockRpc.mockReturnValueOnce(first.promise);await render(<UnifiedSearch initialQuery="资料"/>);await press("事项");await press("查找");await fireEvent.changeText(screen.getByLabelText("起始日期"),"2026-09-10");await press("已完成");await act(async()=>first.resolve({data:[row("stale")]}));expect(screen.queryByText("事项 stale")).toBeNull();await press("查找");expect(mockRpc.mock.calls.at(-1)[1].p_status).toBe("completed");await press("全部");await press("查找");expect(mockRpc.mock.calls.at(-1)[1].p_status).toBeNull();
});
test("account and group switches hide previously rendered results and reject late responses",async()=>{
 mockRpc.mockResolvedValueOnce({data:[row("private")]});const view=await render(<UnifiedSearch initialQuery="资料" spaceId="group-a"/>);await press("查找");expect(await screen.findByText("事项 private")).toBeTruthy();const pending=deferred();mockRpc.mockReturnValueOnce(pending.promise);await press("查找");mockOwner="b";await view.rerender(<UnifiedSearch initialQuery="资料" spaceId="group-b"/>);expect(screen.queryByText("事项 private")).toBeNull();await act(async()=>pending.resolve({data:[row("late-a")]}));expect(screen.queryByText("事项 late-a")).toBeNull();await press("查找");expect(mockRpc.mock.calls.at(-1)[1]).toMatchObject({p_owner:"b",p_space:"group-b"});
});
test.each(["space_members","pet_private_context_exclusions"])("%s invalidation clears displayed and in-flight results",async(table)=>{
 mockRpc.mockResolvedValueOnce({data:[row("private")]});await render(<UnifiedSearch initialQuery="资料"/>);await press("查找");expect(await screen.findByText("事项 private")).toBeTruthy();await act(async()=>mockHandlers.get(table)!());expect(screen.queryByText("事项 private")).toBeNull();const pending=deferred();mockRpc.mockReturnValueOnce(pending.promise);await press("查找");await act(async()=>{mockHandlers.get(table)!();pending.resolve({data:[row("late")]});});expect(screen.queryByText("事项 late")).toBeNull();
});
test("pagination deduplicates results while advancing by fetched row count",async()=>{
 mockRpc.mockResolvedValueOnce({data:Array.from({length:30},(_,i)=>row(String(i)))}).mockResolvedValueOnce({data:Array.from({length:30},(_,i)=>row(String(i+29)))}).mockResolvedValueOnce({data:[]});await render(<UnifiedSearch initialQuery="资料"/>);await press("查找");await press("更多结果");expect(screen.getAllByText("事项 29")).toHaveLength(1);await press("更多结果");expect(mockRpc.mock.calls.map(call=>call[1].p_offset)).toEqual([0,30,60]);
});
test("invalid dates and failed requests recover without a stuck busy state",async()=>{
 await render(<UnifiedSearch initialQuery="资料"/>);await fireEvent.changeText(screen.getByLabelText("起始日期"),"2026-02-30");await press("查找");expect(await screen.findByText("请输入真实存在的日期。")).toBeTruthy();expect(mockRpc).not.toHaveBeenCalled();await fireEvent.changeText(screen.getByLabelText("起始日期"),"");mockRpc.mockRejectedValueOnce(new Error("offline"));await press("查找");expect(await screen.findByText("offline")).toBeTruthy();await press("查找");await waitFor(()=>expect(mockRpc).toHaveBeenCalledTimes(2));await act(async()=>mockStatus("CHANNEL_ERROR"));expect(screen.queryByText("offline")).toBeNull();
});

test("semantic search only runs after explicit click and model failure preserves keyword results",async()=>{
 mockRpc.mockResolvedValueOnce({data:[row("keyword")]});await render(<UnifiedSearch initialQuery="资料"/>);await press("查找");expect(await screen.findByText("事项 keyword")).toBeTruthy();expect(mockInvoke).not.toHaveBeenCalled();mockInvoke.mockResolvedValueOnce({error:new Error("model offline")});await press("按意思找");expect(await screen.findByText(/按意思查找暂时不可用/)).toBeTruthy();expect(screen.getByText("事项 keyword")).toBeTruthy();
});
test("keyword search stays available during semantic work and wins over a late semantic result",async()=>{
 const pending=deferred();mockInvoke.mockReturnValueOnce(pending.promise);mockRpc.mockResolvedValueOnce({data:[row("keyword")]});await render(<UnifiedSearch initialQuery="资料"/>);await press("按意思找");await press("查找");expect(await screen.findByText("事项 keyword")).toBeTruthy();await act(async()=>pending.resolve({data:{results:[row("late-semantic")]}}));expect(screen.queryByText("事项 late-semantic")).toBeNull();
});
test("forgetting while semantic search runs discards its eventual result",async()=>{
 const pending=deferred();mockInvoke.mockReturnValueOnce(pending.promise);await render(<UnifiedSearch initialQuery="资料"/>);await press("按意思找");await act(async()=>{mockHandlers.get("pet_private_context_exclusions")!();pending.resolve({data:{results:[row("forgotten")]}});});expect(screen.queryByText("事项 forgotten")).toBeNull();
});
