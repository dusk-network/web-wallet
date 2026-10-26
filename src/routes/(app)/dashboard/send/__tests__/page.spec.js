import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { getGasSettings } from "$lib/contracts";
import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";
import { gasPriceStore, settingsStore } from "$lib/stores";

import SendPage from "../+page.svelte";

const { resolveDuskName } = vi.hoisted(() => ({ resolveDuskName: vi.fn() }));

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

const formatter = createCurrencyFormatter("en", "DUSK", 9);
const { balance, currentProfile } = mockedWalletStore.getMockedStoreValue();
const formattedShielded = formatter(luxToDusk(balance.shielded.spendable));
const formattedUnshielded = formatter(luxToDusk(balance.unshielded.value));

describe("Send page", () => {
  afterEach(() => {
    cleanup();
    resolveDuskName.mockReset();
    settingsStore.reset();
  });

  afterAll(() => {
    vi.doUnmock("$lib/dusk-domains");
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
  });

  it("should render the send page", async () => {
    const { container } = render(SendPage);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should update the spendable amount passed to its child components, and say which balance it is, when a `keyChange` event is fired", async () => {
    const { container, getByRole } = render(SendPage);
    const addressTextbox = getByRole("textbox");
    const label = () => container.querySelector(".contract-statuses__label");

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedUnshielded);
    expect(label()).toHaveTextContent(/^Spendable \(public\)$/);

    await fireEvent.input(addressTextbox, {
      target: { value: currentProfile.address.toString() },
    });

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedShielded);
    expect(label()).toHaveTextContent(/^Spendable \(shielded\)$/);

    await fireEvent.input(addressTextbox, {
      target: { value: currentProfile.account.toString() },
    });

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedUnshielded);
    expect(label()).toHaveTextContent(/^Spendable \(public\)$/);
  });

  it("should show the public spendable amount again when the recipient entered after a shielded one doesn't resolve, or is cleared", async () => {
    resolveDuskName.mockImplementation((name) =>
      Promise.resolve(
        name === "alice.dusk"
          ? { address: currentProfile.address.toString(), name }
          : { error: "not-registered", name }
      )
    );

    const { container, findByText, getByRole } = render(SendPage);
    const spendable = () =>
      container.querySelector(".contract-statuses__value");

    /** @param {string} value */
    const enter = (value) =>
      fireEvent.input(getByRole("textbox"), { target: { value } });

    await enter("alice.dusk");

    expect(await findByText("Shielded address")).toBeInTheDocument();
    expect(spendable()).toHaveTextContent(formattedShielded);

    await enter("bob.dusk");

    expect(await findByText("bob.dusk isn't registered")).toBeInTheDocument();
    expect(spendable()).toHaveTextContent(formattedUnshielded);

    await enter(currentProfile.address.toString());

    expect(spendable()).toHaveTextContent(formattedShielded);

    await enter("");

    expect(spendable()).toHaveTextContent(formattedUnshielded);
  });

  it("should hide the spendable balance, but not the amount or the Review amounts, while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(SendPage);
    const { gasLimit, gasPrice } = getGasSettings(
      "public-transfer",
      get(settingsStore),
      get(gasPriceStore)
    );
    const fee = gasLimit * gasPrice;
    const maxAmount = luxToDusk(balance.unshielded.value - fee);
    const spendable = container.querySelector(".contract-statuses__value");

    expect(spendable).toHaveTextContent(/^•••• hidden$/);
    expect(container).not.toHaveTextContent(formattedUnshielded);

    await fireEvent.input(getByRole("textbox"), {
      target: {
        value:
          "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
      },
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const amountInput = getByRole("spinbutton");

    await fireEvent.input(amountInput, { target: { value: 10 } });

    expect(amountInput).toHaveValue(10);

    await fireEvent.click(getByRole("button", { name: "Use max" }));

    expect(amountInput).toHaveValue(maxAmount);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(
      Array.from(container.querySelectorAll(".review-amount__value"), (value) =>
        value.textContent?.trim()
      )
    ).toStrictEqual([
      `${formatter(maxAmount)} DUSK`,
      `${formatter(luxToDusk(fee))} DUSK`,
      `${formattedUnshielded} DUSK`,
    ]);
    expect(spendable).toHaveTextContent(/^•••• hidden$/);
  });

  it("should start a transfer from the default gas limit of its recipient", async () => {
    const { container, getByRole } = render(SendPage);
    const maxFee = () =>
      container.querySelector(".gas-fee__amount-value")?.textContent;

    await fireEvent.input(getByRole("textbox"), {
      target: { value: currentProfile.account.toString() },
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(maxFee()).toBe(formatter(luxToDusk(2_500_000n)));

    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.input(getByRole("textbox"), {
      target: { value: currentProfile.address.toString() },
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(maxFee()).toBe(formatter(luxToDusk(50_000_000n)));
  });

  it("should keep the user's gas limit when other settings change", async () => {
    const { container, getByLabelText, getByRole } = render(SendPage);

    await fireEvent.input(getByRole("textbox"), {
      target: { value: currentProfile.account.toString() },
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Edit" }));
    await fireEvent.input(getByLabelText(/gas limit/i), {
      target: { value: "3000000" },
    });
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, userId: "someone" }))
    );

    expect(container.querySelector(".gas-fee__amount-value")?.textContent).toBe(
      formatter(luxToDusk(3_000_000n))
    );
  });
});
