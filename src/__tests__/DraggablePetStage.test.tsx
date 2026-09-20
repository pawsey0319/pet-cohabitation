import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { AppState, PanResponder, StyleSheet, Text, type PanResponderCallbacks } from "react-native";
import { DraggablePetStage } from "../components/DraggablePetStage";
import { clearPetPortraitPosition, loadPortraitPosition, portraitPositionKey, savePortraitPosition } from "../pets/portraitPosition";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const gestures: PanResponderCallbacks[] = [];
let responderSpy: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); gestures.length = 0;
  responderSpy = jest.spyOn(PanResponder, "create").mockImplementation(config => { gestures.push(config); return { panHandlers: {} }; });
});
afterEach(async () => { await cleanup(); responderSpy.mockRestore(); });
const portrait = () => <Text>合成本体</Text>;
const event = {} as any;
const drag = (dx: number, dy: number) => ({ dx, dy, numberActiveTouches: 1 } as any);
async function measure(view: Awaited<ReturnType<typeof render>>, width = 320, height = 200) {
  await fireEvent(view.getByTestId("pet-position-canvas"), "layout", { nativeEvent: { layout: { width, height, x: 0, y: 0 } } });
}
function offset(view: Awaited<ReturnType<typeof render>>) {
  const style = StyleSheet.flatten(view.getByTestId("pet-position-handle").props.style) as any;
  const value = (item: any) => typeof item === "number" ? item : item.__getValue();
  return { x: value(style.transform[0].translateX), y: value(style.transform[1].translateY), width: style.width, height: style.height };
}

test("normal stage starts centered with real movement room and no portrait board or border", async () => {
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>);
  await measure(view);
  expect(offset(view)).toEqual({ x: 100, y: 40, width: 120, height: 120 });
  const style = StyleSheet.flatten(view.getByTestId("pet-position-handle").props.style);
  expect(style.backgroundColor).toBe("transparent"); expect(style.borderWidth).toBeUndefined();
  expect(StyleSheet.flatten(view.getByTestId("pet-position-canvas").props.style).height).toBe(200);
  expect(gestures[0].onStartShouldSetPanResponder!(event, drag(0, 0))).toBe(false);
  expect(gestures[0].onMoveShouldSetPanResponder!(event, drag(3, 3))).toBe(false);
  expect(gestures[0].onMoveShouldSetPanResponder!(event, { ...drag(20, 0), numberActiveTouches: 2 })).toBe(false);
  expect(gestures[0].onMoveShouldSetPanResponder!(event, drag(10, 0))).toBe(true);
});

test("drag clamps both axes and restores the exact owner/pet position on reopening", async () => {
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  await act(() => { gestures[0].onPanResponderGrant!(event, drag(0, 0)); gestures[0].onPanResponderMove!(event, drag(999, 999)); gestures[0].onPanResponderRelease!(event, drag(999, 999)); });
  expect(offset(view)).toEqual({ x: 188, y: 68, width: 120, height: 120 });
  expect(await loadPortraitPosition("a", "pet-a")).toEqual({ x: 1, y: 1, collapsed: false });
  await view.unmount();
  const reopened = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(reopened, 500, 200);
  expect(offset(reopened)).toEqual({ x: 368, y: 68, width: 120, height: 120 });
});

test("resize ends a drag, fits a smaller canvas and preserves the saved normalized choice", async () => {
  await AsyncStorage.setItem(portraitPositionKey("a", "pet-a"), JSON.stringify({ version: 1, x: 1, y: 1, collapsed: false }));
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  await act(() => gestures[0].onPanResponderGrant!(event, drag(0, 0)));
  await view.rerender(<DraggablePetStage ownerId="a" petId="pet-a" compact>{portrait}</DraggablePetStage>); await measure(view, 240, 80);
  await act(() => gestures[0].onPanResponderRelease!(event, drag(-999, -999)));
  const small = offset(view); expect(small.x + small.width).toBeLessThanOrEqual(240); expect(small.y + small.height).toBeLessThanOrEqual(80);
  expect(await loadPortraitPosition("a", "pet-a")).toEqual({ x: 1, y: 1, collapsed: false });
  await view.rerender(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  expect(offset(view).x).toBe(188); expect(offset(view).y).toBe(68);
});

test("collapse, show and reset are explicit and preserve or reset the persisted choice", async () => {
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  await fireEvent(view.getByTestId("pet-position-handle"), "accessibilityAction", { nativeEvent: { actionName: "left" } });
  await fireEvent.press(view.getByLabelText("收起异宠本体"));
  expect(view.queryByTestId("pet-position-canvas")).toBeNull();
  expect(await loadPortraitPosition("a", "pet-a")).toEqual({ x: .3, y: .5, collapsed: true });
  await fireEvent.press(view.getByLabelText("显示异宠本体")); await measure(view);
  expect((await loadPortraitPosition("a", "pet-a")).x).toBe(.3);
  await fireEvent.press(view.getByLabelText("异宠位置复原"));
  expect(await loadPortraitPosition("a", "pet-a")).toEqual({ x: .5, y: .5, collapsed: false });
});

test("delayed storage and gesture callbacks from a previous owner cannot overwrite the next pet", async () => {
  let finish!: (value: string) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  const previous = gestures[0];
  await view.rerender(<DraggablePetStage ownerId="b" petId="pet-b">{portrait}</DraggablePetStage>); await measure(view);
  await act(() => { finish(JSON.stringify({ version: 1, x: 0, y: 0, collapsed: true })); previous.onPanResponderGrant!(event, drag(0, 0)); previous.onPanResponderRelease!(event, drag(900, 900)); });
  expect(offset(view)).toEqual({ x: 100, y: 40, width: 120, height: 120 });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await view.rerender(<DraggablePetStage ownerId="b" petId="another-pet">{portrait}</DraggablePetStage>); await measure(view);
  expect(offset(view).x).toBe(100);
});

test("damaged stored data uses a safe centered position", async () => {
  await AsyncStorage.setItem(portraitPositionKey("a", "pet-a"), '{"version":1,"x":"NaN","y":-99}');
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  expect(offset(view)).toEqual({ x: 100, y: 40, width: 120, height: 120 });
});

test("local account cleanup fences queued writes and preserves other owners' positions", async () => {
  await savePortraitPosition("b", "pet", { x: 1, y: 0, collapsed: false }, () => true);
  let finish!: () => void;
  const original = AsyncStorage.setItem;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = savePortraitPosition("a", "pet", { x: 0, y: 0, collapsed: false }, () => true);
  await act(async () => { await Promise.resolve(); });
  const queued = savePortraitPosition("a", "pet", { x: 1, y: 1, collapsed: true }, () => true);
  const clearing = clearPetPortraitPosition("a"); finish(); await Promise.all([first, queued, clearing]);
  expect(await AsyncStorage.getItem(portraitPositionKey("a", "pet"))).toBeNull();
  expect(await loadPortraitPosition("b", "pet")).toEqual({ x: 1, y: 0, collapsed: false });
  expect(original).toHaveBeenCalledTimes(2);
});

test("an unmounted component cannot enqueue a later write", async () => {
  const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
  await act(() => gestures[0].onPanResponderGrant!(event, drag(0, 0)));
  await view.unmount();
  await act(() => gestures[0].onPanResponderRelease!(event, drag(80, 20)));
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test("backgrounding or hiding the canvas cancels an in-flight drag without saving its late release", async () => {
  let onChange!: (state: "active" | "background") => void;
  const listener = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => { onChange = callback; return { remove: jest.fn() }; });
  try {
    const view = await render(<DraggablePetStage ownerId="a" petId="pet-a">{portrait}</DraggablePetStage>); await measure(view);
    await act(() => { gestures[0].onPanResponderGrant!(event, drag(0, 0)); gestures[0].onPanResponderMove!(event, drag(50, 20)); onChange("background"); onChange("active"); gestures[0].onPanResponderRelease!(event, drag(50, 20)); });
    expect(offset(view)).toEqual({ x: 100, y: 40, width: 120, height: 120 });
    await act(() => gestures[0].onPanResponderGrant!(event, drag(0, 0)));
    await view.rerender(<DraggablePetStage ownerId="a" petId="pet-a" constrained>{portrait}</DraggablePetStage>);
    await act(() => gestures[0].onPanResponderRelease!(event, drag(50, 20)));
    expect(view.queryByTestId("pet-position-canvas")).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  } finally { listener.mockRestore(); }
});
