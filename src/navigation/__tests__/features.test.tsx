import { fireEvent, render, screen } from "@testing-library/react-native";
import { PetSectionNav } from "../../components/PetSectionNav";
import { PET_FEATURES, legacyPetDestination } from "../features";
jest.mock("../../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: { card: "#fff", line: "#ddd", accent: "#a3563c", muted: "#666" } }) }));
test("pet navigation separates memory/growth/desktop and offers no duplicate steward module", async () => {
  const open = jest.fn(); await render(<PetSectionNav value="companion" onChange={open} />);
  expect(screen.queryByText("消息管家")).toBeNull();
  await fireEvent.press(screen.getByText("记忆")); expect(PET_FEATURES[open.mock.calls[0][0] as keyof typeof PET_FEATURES].href).toBe("/pet-memory");
  await fireEvent.press(screen.getByText("成长")); expect(open).toHaveBeenLastCalledWith("growth");
  await fireEvent.press(screen.getByText("桌宠")); expect(open).toHaveBeenLastCalledWith("desktop");
});
test("old steward and reply preferences links have explicit canonical destinations", () => {
  expect(legacyPetDestination("steward")).toBe("/pet");
  expect(legacyPetDestination("reply")).toBe("/pet-settings");
  expect(legacyPetDestination("growth")).toBe("/pet-growth");
  expect(legacyPetDestination("anything-else")).toBeNull();
});
