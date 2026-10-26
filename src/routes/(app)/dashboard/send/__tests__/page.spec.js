import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { getGasSettings } from "$lib/contracts";
import { formatDusk, luxToDusk } from "$lib/dusk/currency";
import { gasPriceStore, settingsStore } from "$lib/stores";

import SendPage from "../+page.svelte";

const { resolveDuskName } = vi.hoisted(() => ({ resolveDuskName: vi.fn() }));

const page = vi.hoisted(() => ({
  url: new URL("http://localhost/some-base-path/dashboard/send"),
}));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        readable({ url: page.url }).subscribe(run),
    },
  };
});

vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {typeof import("$lib/dusk-domains")} */ (await importOriginal()),
  resolveDuskName,
}));

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

const { balance, currentProfile } = mockedWalletStore.getMockedStoreValue();
const OTHER =
  "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";

/** @param {HTMLElement} container */
const available = (container) =>
  container.querySelector(".send__amount + .send__hint");

describe("Send page", () => {
  afterEach(() => {
    cleanup();
    resolveDuskName.mockReset();
    settingsStore.reset();
    page.url = new URL("http://localhost/some-base-path/dashboard/send");
  });

  afterAll(() => {
    vi.doUnmock("$app/stores");
    vi.doUnmock("$lib/dusk-domains");
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
  });

  it("should render the send page", async () => {
    const { container } = render(SendPage);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should pay from the public balance, or the shielded one for a shielded address, and say which", async () => {
    const { container, getByRole } = render(SendPage);
    const to = getByRole("textbox", { name: "To" });

    expect(available(container)).toHaveTextContent(
      `Available ${formatDusk(balance.unshielded.value, "en")} DUSK from your public balance`
    );

    await fireEvent.input(to, {
      target: { value: currentProfile.address.toString() },
    });

    expect(available(container)).toHaveTextContent(
      `Available ${formatDusk(balance.shielded.spendable, "en")} DUSK from your shielded balance`
    );

    await fireEvent.input(to, {
      target: { value: currentProfile.account.toString() },
    });

    expect(available(container)).toHaveTextContent(/from your public balance$/);
  });

  it("should pay from the public balance again when the recipient entered after a shielded one doesn't resolve, or is cleared", async () => {
    resolveDuskName.mockImplementation((name) =>
      Promise.resolve(
        name === "alice.dusk"
          ? { address: currentProfile.address.toString(), name }
          : { error: "not-registered", name }
      )
    );

    const { container, findByText, getByRole } = render(SendPage);

    /** @param {string} value */
    const enter = (value) =>
      fireEvent.input(getByRole("textbox", { name: "To" }), {
        target: { value },
      });

    await enter("alice.dusk");

    expect(
      await findByText("alice.dusk points to a shielded address")
    ).toBeInTheDocument();
    expect(available(container)).toHaveTextContent(/shielded balance$/);

    await enter("bob.dusk");

    expect(await findByText("bob.dusk isn't registered.")).toBeInTheDocument();
    expect(available(container)).toHaveTextContent(/public balance$/);

    await enter(currentProfile.address.toString());

    expect(available(container)).toHaveTextContent(/shielded balance$/);

    await enter("");

    expect(available(container)).toHaveTextContent(/public balance$/);
  });

  it("should hide the balance it pays from, but not the amount or the summary, while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(SendPage);
    const { gasLimit, gasPrice } = getGasSettings(
      "public-transfer",
      get(settingsStore),
      get(gasPriceStore)
    );
    const fee = gasLimit * gasPrice;
    const amount = getByRole("spinbutton", { name: "Amount" });

    expect(available(container)).toHaveTextContent(
      /^Available •••• hidden DUSK from your public balance$/
    );
    expect(container).not.toHaveTextContent(
      formatDusk(balance.unshielded.value, "en")
    );

    await fireEvent.input(getByRole("textbox", { name: "To" }), {
      target: { value: OTHER },
    });
    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(amount).toHaveValue(luxToDusk(balance.unshielded.value - fee));
    expect(container.querySelector(".send__summary")).toHaveTextContent(
      /Amount [\d,.]+ DUSK/
    );
    expect(available(container)).toHaveTextContent(/•••• hidden/);
  });

  it("should start a transfer from the default gas limit of its recipient", async () => {
    const { container, getByRole } = render(SendPage);
    const maxFee = () =>
      container.querySelector(".gas-fee__amount-value")?.textContent;
    const to = getByRole("textbox", { name: "To" });

    await fireEvent.input(to, {
      target: { value: currentProfile.account.toString() },
    });

    expect(maxFee()).toBe("0.0025");

    await fireEvent.input(to, {
      target: { value: currentProfile.address.toString() },
    });

    expect(maxFee()).toBe("0.05");
  });

  it("should keep the user's gas limit when other settings change", async () => {
    const { container, getByLabelText, getByRole } = render(SendPage);

    await fireEvent.input(getByRole("textbox", { name: "To" }), {
      target: { value: currentProfile.account.toString() },
    });
    await fireEvent.click(getByRole("button", { name: "Edit" }));
    await fireEvent.input(getByLabelText(/gas limit/i), {
      target: { value: "3000000" },
    });
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, userId: "someone" }))
    );

    expect(container.querySelector(".gas-fee__amount-value")?.textContent).toBe(
      "0.003"
    );
  });

  it("should open with the recipient in the address, as from Send again or a contact", () => {
    page.url = new URL(
      `http://localhost/some-base-path/dashboard/send?to=${OTHER}`
    );

    const { getByRole } = render(SendPage);

    expect(getByRole("textbox", { name: "To" })).toHaveValue(OTHER);
  });
});
