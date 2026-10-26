import { describe, expect, it } from "vitest";

import { appPath, shellTabs, tabOf } from "../navigation";

describe("shell navigation", () => {
  it("lists Home, History and Contacts, and Staking when staking is on", () => {
    expect(shellTabs({ stake: false }).map((tab) => tab.label)).toEqual([
      "Home",
      "History",
      "Contacts",
    ]);
    expect(shellTabs({ stake: true }).map((tab) => tab.label)).toEqual([
      "Home",
      "History",
      "Staking",
      "Contacts",
    ]);
  });

  it("finds the tab of a path under the base path, and none for a flow", () => {
    const tabs = shellTabs({ stake: true });

    expect(appPath("/some-base-path/dashboard/")).toBe("/dashboard");
    expect(tabOf(tabs, "/some-base-path/dashboard")).toBe("home");
    expect(tabOf(tabs, "/some-base-path/dashboard/transactions")).toBe(
      "history"
    );
    expect(tabOf(tabs, "/some-base-path/dashboard/stake")).toBe("staking");
    expect(tabOf(tabs, "/some-base-path/dashboard/contacts")).toBe("contacts");
    expect(tabOf(tabs, "/some-base-path/dashboard/send")).toBeNull();
    expect(tabOf(tabs, "/some-base-path/settings")).toBeNull();
  });
});
