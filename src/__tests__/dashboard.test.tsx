jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { render, screen } from "@testing-library/react-native";
import App from "../../App";

describe("dual-core dashboard", () => {
  it("renders the four dual-core dashboard regions", async () => {
    await render(<App />);

    expect(screen.getByText("今天的异宠")).toBeTruthy();
    expect(screen.getByText("关系空间")).toBeTruthy();
    expect(screen.getByText("待你确认")).toBeTruthy();
    expect(screen.getByText("今晚碰个面")).toBeTruthy();
  });
});
