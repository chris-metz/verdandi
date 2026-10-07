import { expect, it } from "vitest";
import { draggedSidebarWidth } from "./sidebar-width";

it("follows the pointer between 180 and 480 px", () => {
  expect(draggedSidebarWidth(300)).toBe(300);
  expect(draggedSidebarWidth(180)).toBe(180);
  expect(draggedSidebarWidth(480)).toBe(480);
});

it("goes no wider than 480 px", () => {
  expect(draggedSidebarWidth(481)).toBe(480);
  expect(draggedSidebarWidth(1600)).toBe(480);
});

it("holds at 180 px down to 90 px, half of it", () => {
  expect(draggedSidebarWidth(179)).toBe(180);
  expect(draggedSidebarWidth(90)).toBe(180);
});

it("hides the sidebar below 90 px", () => {
  expect(draggedSidebarWidth(89.5)).toBe("hidden");
  expect(draggedSidebarWidth(0)).toBe("hidden");
  expect(draggedSidebarWidth(-40)).toBe("hidden");
});

it("keeps whole pixels", () => {
  expect(draggedSidebarWidth(300.4)).toBe(300);
  expect(draggedSidebarWidth(300.6)).toBe(301);
});
