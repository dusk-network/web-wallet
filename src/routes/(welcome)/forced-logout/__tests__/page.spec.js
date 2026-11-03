import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import LogoutPage from "../+page.svelte";

describe("Forced logout page", () => {
  const jsDomAlert = window.alert;

  window.alert = vi.fn();

  afterEach(cleanup);

  afterAll(() => {
    window.alert = jsDomAlert;
  });

  it("should render the page alert the user about the forced logout on mount", () => {
    const { getByText } = render(LogoutPage);
    const why =
      "Your DUSK is safe on the network. Another tab or window created, restored or reset a wallet in this browser, so this tab locked.";

    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(why);
    expect(getByText(why)).toBeInTheDocument();
    expect(
      getByText(
        "If your wallet is no longer here, restore it with its recovery phrase. It then syncs again in full."
      )
    ).toBeInTheDocument();
  });
});
