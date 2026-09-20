import {fireEvent,render,screen,waitFor} from "@testing-library/react-native";
import {VisionAttachmentPicker} from "../vision/VisionAttachmentPicker";
import {visionRequest} from "../vision/repository";
import {stabilizeMediaForOutbox} from "../chat/mediaFile";
import {launchImageLibraryAsync} from "expo-image-picker";
jest.mock("../auth/SessionProvider",()=>({useSession:()=>({profile:{id:"owner"}})}));
jest.mock("../theme/ThemeProvider",()=>({useAppTheme:()=>({theme:{primary:"#333",muted:"#777",danger:"#900"}})}));
jest.mock("../vision/repository",()=>({visionRequest:jest.fn(),readVisionImage:jest.fn()}));
jest.mock("../chat/mediaFile",()=>({stabilizeMediaForOutbox:jest.fn(),removeStabilizedMedia:jest.fn()}));
jest.mock("expo-image-picker",()=>({launchImageLibraryAsync:jest.fn(),launchCameraAsync:jest.fn(),requestCameraPermissionsAsync:jest.fn()}));
jest.mock("expo-image-manipulator",()=>({SaveFormat:{JPEG:"jpeg"},manipulateAsync:async()=>({uri:"file:///cache-converted.jpg"})}));
beforeEach(()=>{jest.clearAllMocks();jest.mocked(visionRequest).mockResolvedValue({available:true});});
test("an unuploaded local image is previewed immediately",async()=>{
 await render(<VisionAttachmentPicker value={{uri:"file:///stable-image.jpg",uploadId:"local-upload"}} onChange={jest.fn()}/>);
 expect(screen.getByLabelText("待发送图片").props.source.uri).toBe("file:///stable-image.jpg");
});
test("choosing one image stabilizes it before handing it to the draft",async()=>{
 jest.mocked(launchImageLibraryAsync).mockResolvedValue({canceled:false,assets:[{uri:"file:///temporary.jpg",width:1000,height:800}]} as any);jest.mocked(stabilizeMediaForOutbox).mockResolvedValue("file:///owner/vision-persisted.jpg");
 const onChange=jest.fn();await render(<VisionAttachmentPicker value={null} onChange={onChange}/>);await waitFor(()=>expect(screen.getByText("相册").parent?.props.accessibilityState?.disabled??screen.getByText("相册").parent?.props.disabled).not.toBe(true));
 await fireEvent.press(screen.getByText("相册"));await waitFor(()=>expect(onChange).toHaveBeenCalledTimes(1));expect(launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({allowsMultipleSelection:false,selectionLimit:1}));expect(stabilizeMediaForOutbox).toHaveBeenCalledWith("file:///cache-converted.jpg","owner",expect.stringMatching(/^vision-/));expect(onChange.mock.calls[0][0]).toMatchObject({uri:"file:///owner/vision-persisted.jpg",uploadId:expect.any(String)});
});
