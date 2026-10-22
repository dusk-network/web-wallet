import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import {
  createCurrencyFormatter,
  duskToLux,
  luxToDusk,
} from "$lib/dusk/currency";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import { DEFAULT_BLOCKLISTED_ADDRESSES } from "$lib/security/addressBlocklist";

import { Send } from "..";
import { tick } from "svelte";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

describe("Send", () => {
  const formatter = createCurrencyFormatter("en", "DUSK", 9);
  const lastTxId = "some-id";
  const publicAddress =
    "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
  const shieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const bep20BridgeAddress = "0x1234567890123456789012345678901234567890"; // Example BEP20 bridge address
  const baseProps = {
    availableBalance: 1_000_000_000_000n,
    bep20BridgeAddress,
    execute: vi.fn().mockResolvedValue(lastTxId),
    formatter,
    gasLimits: {
      gasLimitLower: 10000000n,
      gasLimitUpper: 2900000000n,
      gasPriceLower: 1n,
    },
    gasSettings: {
      gasLimit: 20000000n,
      gasPrice: 1n,
    },
    publicAddress,
    resolveName: vi.fn(),
    shieldedAddress,
  };

  const invalidAddress =
    "aB5rL7yC2zK9eV3xH1gQ6fP4jD8sM0iU2oX7wG9nZ8lT3hU4jP5mK8nS6qJ3wF4aA9bB2cC5dD8eE7";

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.resolveName.mockReset();
  });

  describe("Address step", () => {
    it("should render the Send component Address step", () => {
      const { container } = render(Send, baseProps);

      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should disable the next button if the address is empty", () => {
      const { getByRole } = render(Send, baseProps);
      const nextButton = getByRole("button", { name: "Next" });
      const addressInput = getByRole("textbox");

      expect(addressInput).toHaveValue("");
      expect(nextButton).toBeDisabled();
    });

    it("should disable the next button if the address is invalid", async () => {
      const { getByRole } = render(Send, baseProps);
      const nextButton = getByRole("button", { name: "Next" });
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: invalidAddress },
      });

      expect(addressInput).toHaveValue(invalidAddress);
      expect(nextButton).toBeDisabled();
    });

    it("should display a warning if the address input is a public account", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const sendToAddress =
        "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: sendToAddress },
      });

      expect(addressInput).toHaveValue(sendToAddress);
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should display a warning if the address input is self-referential", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: publicAddress },
      });

      expect(addressInput).toHaveValue(publicAddress);
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should display a notice if the address input is the BEP20 bridge address", async () => {
      const { getByRole, findByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: bep20BridgeAddress },
      });

      expect(addressInput).toHaveValue(bep20BridgeAddress);
      expect(
        await findByText("BEP20 bridge operation detected")
      ).toBeInTheDocument();
    });
  });

  describe("Amount step", () => {
    it("should render the Send component Amount step", async () => {
      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should disable the next button if the amount is invalid on mount", async () => {
      const props = {
        ...baseProps,
        gasSettings: {
          ...baseProps.gasSettings,
          gasLimit: 40000000n,
          gasPrice: 40000000n,
        },
      };
      const { getByRole } = render(Send, props);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const next = getByRole("button", { name: "Next" });

      await tick();

      expect(next).toBeDisabled();
    });

    it("should set the max amount in the textbox if the user clicks the related button", async () => {
      const maxSpendableDusk = luxToDusk(
        baseProps.availableBalance -
          baseProps.gasSettings.gasPrice * baseProps.gasSettings.gasLimit
      );
      const { getByRole } = render(Send, baseProps);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const useMaxButton = getByRole("button", { name: "USE MAX" });
      const nextButton = getByRole("button", { name: "Next" });
      const amountInput = getByRole("spinbutton");

      await fireEvent.click(useMaxButton);

      expect(amountInput).toHaveValue(maxSpendableDusk);
      expect(nextButton).toBeEnabled();
    });

    it("should not change the default amount (1) in the textbox if the user clicks the related button and the balance is zero", async () => {
      const props = {
        ...baseProps,
        availableBalance: 0n,
      };
      const { getByRole } = render(Send, props);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const useMaxButton = getByRole("button", { name: "USE MAX" });
      const amountInput = getByRole("spinbutton");

      expect(amountInput).toHaveValue(1);

      await fireEvent.click(useMaxButton);

      expect(amountInput).toHaveValue(1);
    });

    it("should not change the default amount (1) in the textbox if the user clicks the related button and the gas settings are invalid", async () => {
      const props = {
        ...baseProps,
        gasSettings: {
          ...baseProps.gasSettings,
          gasLimit: 40000000n,
          gasPrice: 40000000n,
        },
      };

      const { getByRole } = render(Send, props);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const useMaxButton = getByRole("button", { name: "USE MAX" });
      const amountInput = getByRole("spinbutton");

      expect(amountInput).toHaveValue(1);

      await fireEvent.click(useMaxButton);

      expect(amountInput).toHaveValue(1);
    });

    it("should disable the next button if the user enters an invalid amount", async () => {
      const { getByRole } = render(Send, baseProps);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const nextButton = getByRole("button", { name: "Next" });
      const amountInput = getByRole("spinbutton");

      expect(nextButton).toBeEnabled();

      await fireEvent.input(amountInput, { target: { value: 0 } });

      expect(amountInput).toHaveValue(0);
      expect(nextButton).toBeDisabled();
    });

    it("should require a valid EVM address in memo if sending to BEP20 bridge", async () => {
      const { getByRole, findByText, queryByText, container } = render(Send, {
        ...baseProps,
        availableBalance: 1_000_000_000_000_000n,
      });
      const addressInput = getByRole("textbox");
      const nextButtonAddressStep = getByRole("button", { name: "Next" });

      await fireEvent.input(addressInput, {
        target: { value: bep20BridgeAddress },
      });
      await fireEvent.click(nextButtonAddressStep);

      const nextButtonAmountStep = getByRole("button", { name: "Next" });
      const amountInput = getByRole("spinbutton");
      const memoInput = getAsHTMLElement(container, ".operation__send-memo");

      expect(memoInput).toBeInTheDocument();

      // Banner for required memo should be visible
      expect(
        await findByText("Memo required for bridge operation")
      ).toBeInTheDocument();
      expect(nextButtonAmountStep).toBeDisabled();

      // Enter an invalid EVM address as memo
      await fireEvent.input(memoInput, { target: { value: "invalid-evm" } });
      expect(memoInput).toHaveValue("invalid-evm");

      expect(
        await findByText("Invalid EVM address format")
      ).toBeInTheDocument();
      expect(nextButtonAmountStep).toBeDisabled();

      // Enter a valid EVM address as memo
      const validEvmAddress = "0x9876543210987654321098765432109876543210";

      await fireEvent.input(memoInput, {
        target: { value: validEvmAddress },
      });
      expect(memoInput).toHaveValue(validEvmAddress);

      // Error banners should disappear
      expect(
        queryByText("Memo required for bridge operation")
      ).not.toBeInTheDocument();
      expect(queryByText("Invalid EVM address format")).not.toBeInTheDocument();

      await fireEvent.input(amountInput, { target: { value: "10" } });

      expect(nextButtonAmountStep).toBeEnabled();
    });

    it("should make memo optional and not require EVM format if not sending to BEP20 bridge", async () => {
      const { getByRole, queryByText, container } = render(Send, {
        ...baseProps,
        availableBalance: 1_000_000_000_000_000n,
      });
      const addressInput = getByRole("textbox");
      const nextButtonAddressStep = getByRole("button", { name: "Next" });

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(nextButtonAddressStep);

      const nextButtonAmountStep = getByRole("button", { name: "Next" });
      const amountInput = getByRole("spinbutton");
      const memoSwitch = getByRole("switch");

      expect(memoSwitch).toBeInTheDocument();
      expect(
        queryByText("Memo required for bridge operation")
      ).not.toBeInTheDocument();
      expect(queryByText("Invalid EVM address format")).not.toBeInTheDocument();

      await fireEvent.input(amountInput, { target: { value: "10" } });
      expect(nextButtonAmountStep).toBeEnabled();

      // Show memo field
      await fireEvent.click(memoSwitch);

      const memoInput = getAsHTMLElement(container, ".operation__send-memo");

      expect(memoInput).toBeInTheDocument();

      await fireEvent.input(memoInput, {
        target: { value: "not-an-evm-address" },
      });
      expect(memoInput).toHaveValue("not-an-evm-address");

      expect(queryByText("Invalid EVM address format")).not.toBeInTheDocument();
      expect(nextButtonAmountStep).toBeEnabled();
    });
  });

  describe("Review step", () => {
    it("should render the Send component Review step", async () => {
      const amount = 2345;
      const { container, getByRole } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("switch"));

      const amountInput = getByRole("spinbutton");
      const memoInput = getByRole("textbox");

      await fireEvent.input(amountInput, { target: { value: amount } });
      await fireEvent.input(memoInput, {
        target: { value: "abc-example-memo" },
      });

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const value = getAsHTMLElement(
        container,
        ".operation__review-amount span"
      );
      const key = getAsHTMLElement(
        container,
        ".operation__review-address span"
      );
      const memo = getAsHTMLElement(container, ".operation__review-memo span");

      expect(value.textContent).toBe(baseProps.formatter(amount));
      expect(key.textContent).toBe(shieldedAddress);
      expect(memo.textContent).toBe("abc-example-memo");
      expect(container.firstElementChild).toMatchSnapshot();
    });
  });

  describe("Send operation", () => {
    vi.useFakeTimers();

    const amount = 567;
    const expectedExplorerLink = `/explorer/transactions/transaction?id=${lastTxId}`;

    afterAll(() => {
      vi.useRealTimers();
    });

    it("should perform a transfer for the desired amount, give a success message and supply a link to see the transaction in the explorer", async () => {
      const { getByRole, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      const amountInput = getByRole("spinbutton");

      await fireEvent.input(amountInput, { target: { value: amount } });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));

      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(getByText("Transaction created")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should perform a transfer for the desired amount, with a memo, give a success message and supply a link to see the transaction in the explorer", async () => {
      const { getByRole, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");
      const memo = " abc-example-memo ";

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("switch"));

      const amountInput = getByRole("spinbutton");
      const memoInput = getByRole("textbox");

      await fireEvent.input(amountInput, { target: { value: amount } });
      await fireEvent.input(memoInput, {
        target: { value: memo },
      });

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));

      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(amount),
        memo,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(getByText("Transaction created")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should trim a BEP20 bridge memo before review and execution", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const evmAddress = "0x9876543210987654321098765432109876543210";

      await fireEvent.input(getByRole("textbox"), {
        target: { value: bep20BridgeAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.input(
        getAsHTMLElement(container, ".operation__send-memo"),
        { target: { value: ` \n${evmAddress}\t ` } }
      );
      await fireEvent.click(getByRole("button", { name: "Next" }));

      const reviewMemo = getAsHTMLElement(
        container,
        ".operation__review-memo span"
      );

      expect(reviewMemo).toHaveTextContent(evmAddress);

      await fireEvent.click(getByRole("button", { name: "SEND" }));
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        bep20BridgeAddress,
        duskToLux(amount),
        evmAddress,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it("should show an error message if the transfer fails", async () => {
      const errorMessage = "Some error message";

      baseProps.execute.mockRejectedValueOnce(new Error(errorMessage));

      const { getByRole, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      const amountInput = getByRole("spinbutton");

      await fireEvent.input(amountInput, { target: { value: amount } });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
      expect(getByText("Transaction failed")).toBeInTheDocument();
      expect(getByText(errorMessage)).toBeInTheDocument();
    });

    it("should show the success message, but no explorer link, if the execution promise doesn't resolve with an hash", async () => {
      baseProps.execute.mockResolvedValueOnce(void 0);

      const { getByRole, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      const amountInput = getByRole("spinbutton");

      await fireEvent.input(amountInput, { target: { value: amount } });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
      expect(getByText("Transaction created")).toBeInTheDocument();
      expect(() => getByRole("link", { name: /explorer/i })).toThrow();
    });
  });

  describe("Dusk Domains names", () => {
    const amount = 567;
    const nameAccount =
      "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";
    const nameAddress =
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM";

    it("should send to the account a name resolves to, after showing both", async () => {
      /** @type {(value: DuskNameResolution) => void} */
      let finishLookup = () => {};

      baseProps.resolveName.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLookup = resolve;
        })
      );

      const { container, findByText, getByRole, getByText, queryByRole } =
        render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: " Alice.dusk " },
      });

      expect(baseProps.resolveName).toHaveBeenCalledExactlyOnceWith(
        "Alice.dusk"
      );
      expect(getByText("Looking up Alice.dusk…")).toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeDisabled();

      finishLookup({ account: nameAccount, name: "alice.dusk" });

      expect(await findByText("alice.dusk points to")).toBeInTheDocument();
      expect(getByText(nameAccount)).toBeInTheDocument();
      expect(getByText("Public account detected")).toBeInTheDocument();
      expect(queryByRole("radiogroup")).not.toBeInTheDocument();

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toBeInTheDocument();
      expect(
        getAsHTMLElement(container, ".operation__review-address span")
      ).toHaveTextContent(nameAccount);

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAccount,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it("should send a shielded transfer to a name with only a shielded address", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const {
        container,
        findByText,
        getByRole,
        getByText,
        queryByRole,
        queryByText,
      } = render(Send, { events: { keyChange }, props: baseProps });
      const shownAddress = () =>
        getAsHTMLElement(container, ".operation__review-address span");

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("alice.dusk points to")).toBeInTheDocument();
      expect(shownAddress()).toHaveTextContent(nameAddress);
      expect(queryByText("Public account detected")).not.toBeInTheDocument();
      expect(queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toBeInTheDocument();
      expect(shownAddress()).toHaveTextContent(nameAddress);

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it("should send to the public account of a name with both addresses, unless the user picks its shielded address", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce({
        account: nameAccount,
        address: nameAddress,
        name: "alice.dusk",
      });

      const { container, findByRole, getByRole, getByText, queryByText } =
        render(Send, { events: { keyChange }, props: baseProps });
      const shownAddress = () =>
        getAsHTMLElement(container, ".operation__review-address span");

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      expect(
        await findByRole("radiogroup", { name: "Address to send to" })
      ).toBeInTheDocument();
      expect(getByRole("radio", { name: "Public" })).toBeChecked();
      expect(shownAddress()).toHaveTextContent(nameAccount);
      expect(getByText("Public account detected")).toBeInTheDocument();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "account" } })
      );

      await fireEvent.click(getByRole("radio", { name: "Shielded" }));

      expect(shownAddress()).toHaveTextContent(nameAddress);
      expect(queryByText("Public account detected")).not.toBeInTheDocument();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toBeInTheDocument();
      expect(shownAddress()).toHaveTextContent(nameAddress);

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it.each([
      ["expired", "alice.dusk has expired"],
      ["invalid", "alice.dusk isn't a valid name"],
      ["lookup-failed", "Couldn't look up alice.dusk"],
      ["no-address", "alice.dusk has no address to send to"],
      ["not-registered", "alice.dusk isn't registered"],
      ["unsupported-network", ".dusk names aren't available on this network"],
    ])(
      "should explain the %s error inline and keep Next disabled",
      async (error, title) => {
        baseProps.resolveName.mockResolvedValueOnce({
          error,
          name: "alice.dusk",
        });

        const { findByText, getByRole } = render(Send, baseProps);

        await fireEvent.input(getByRole("textbox"), {
          target: { value: "alice.dusk" },
        });

        expect(await findByText(title)).toBeInTheDocument();
        expect(getByRole("button", { name: "Next" })).toBeDisabled();
      }
    );

    it("should look the name up again after a failed lookup", async () => {
      baseProps.resolveName
        .mockResolvedValueOnce({ error: "lookup-failed", name: "alice.dusk" })
        .mockResolvedValueOnce({ account: nameAccount, name: "alice.dusk" });

      const { findByRole, findByText, getByRole } = render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(await findByRole("button", { name: "TRY AGAIN" }));

      expect(await findByText(nameAccount)).toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("should ignore the lookup of a name that is no longer entered", async () => {
      /** @type {(value: DuskNameResolution) => void} */
      let finishFirstLookup = () => {};

      baseProps.resolveName
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishFirstLookup = resolve;
          })
        )
        .mockResolvedValueOnce({ error: "not-registered", name: "bob.dusk" });

      const { findByText, getByRole, queryByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, { target: { value: "alice.dusk" } });
      await fireEvent.input(addressInput, { target: { value: "bob.dusk" } });
      finishFirstLookup({ account: nameAccount, name: "alice.dusk" });
      await tick();

      expect(await findByText("bob.dusk isn't registered")).toBeInTheDocument();
      expect(queryByText(nameAccount)).not.toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeDisabled();
    });

    it("should block a name that resolves to a blocked address", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        account: DEFAULT_BLOCKLISTED_ADDRESSES[0].address,
        name: "alice.dusk",
      });

      const { findByText, getByRole } = render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("Blocked recipient address")).toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeDisabled();
    });
  });
});
