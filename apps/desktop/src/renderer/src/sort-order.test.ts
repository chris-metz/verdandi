import { describe, expect, it } from "vitest";
import { listDate, sortOrderName, sortOrders } from "./sort-order";

describe("a list's sort order", () => {
  it("offers Newest, then Recently updated", () => {
    expect(sortOrders.map((order) => sortOrderName(order, "open"))).toEqual([
      "Newest",
      "Recently updated",
    ]);
  });

  it("calls Newest Recently closed in a closed list", () => {
    expect(sortOrders.map((order) => sortOrderName(order, "closed"))).toEqual([
      "Recently closed",
      "Recently updated",
    ]);
  });

  it("shows the date it goes by in the date column", () => {
    expect(listDate("newest", "open")).toBe("created");
    expect(listDate("newest", "closed")).toBe("closed");
    expect(listDate("updated", "open")).toBe("updated");
    expect(listDate("updated", "closed")).toBe("updated");
  });
});
