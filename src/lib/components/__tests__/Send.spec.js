import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import {
  createCurrencyFormatter,
  duskToLux,
  luxToDusk,
} from "$lib/dusk/currency";
import { shortenAddress } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import { addBasePath } from "$lib/navigation";
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

// No camera, as in jsdom, unless a test finds one.
const { hasCamera } = vi.hoisted(() => ({
  hasCamera: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("qr-scanner", () => ({
  default: class {
    static hasCamera = hasCamera;

    destroy() {}

    start() {}

    stop() {}
  },
}));

/**
 * The Review step's amounts, as their labels and values.
 *
 * @param {HTMLElement} container
 */
const getReviewAmounts = (container) =>
  Array.from(container.querySelectorAll(".review-amount"), (row) => [
    row.querySelector("dt")?.textContent,
    row.querySelector("dd")?.textContent?.trim(),
  ]);

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
    shieldedBalance: 500_000_000_000n,
  };

  const invalidAddress =
    "aB5rL7yC2zK9eV3xH1gQ6fP4jD8sM0iU2oX7wG9nZ8lT3hU4jP5mK8nS6qJ3wF4aA9bB2cC5dD8eE7";

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.resolveName.mockReset();
    hasCamera.mockClear();
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

    it("should take Enter after an address as Next, instead of adding a line break", async () => {
      const { getByRole } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });

      const enter = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });

      addressInput.dispatchEvent(enter);
      await tick();

      expect(enter.defaultPrevented).toBe(true);
      expect(getByRole("spinbutton", { name: "Amount" })).toBeInTheDocument();
    });

    it("should stay on the address step on Enter while the address is invalid, and say why", async () => {
      const { getByRole, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: invalidAddress },
      });
      await fireEvent.keyDown(addressInput, { key: "Enter" });

      expect(addressInput).toHaveValue(invalidAddress);
      expect(getByRole("button", { name: "Next" })).toBeDisabled();
      expect(getByText("Not a valid address")).toBeInTheDocument();
      expect(addressInput).toHaveAccessibleDescription(
        "Not a valid address Check it, or paste it again."
      );
      expect(addressInput).toHaveAttribute("aria-invalid", "true");
    });

    it("should remove the spaces and line breaks a pasted address brings", async () => {
      const { getByRole } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.paste(addressInput);
      await fireEvent.input(addressInput, {
        target: {
          value: ` ${shieldedAddress.slice(0, 40)}\n${shieldedAddress.slice(40)}\n`,
        },
      });

      expect(addressInput).toHaveValue(shieldedAddress);
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("should point out an invalid address once it is pasted or left, not while it is typed", async () => {
      const { getByRole, queryByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: invalidAddress.slice(0, 20) },
      });

      expect(queryByText("Not a valid address")).toBeNull();
      expect(addressInput).toHaveAttribute("aria-invalid", "false");

      await fireEvent.blur(addressInput);

      expect(queryByText("Not a valid address")).toBeInTheDocument();

      await fireEvent.input(addressInput, { target: { value: "" } });

      expect(queryByText("Not a valid address")).toBeNull();

      await fireEvent.paste(addressInput);
      await fireEvent.input(addressInput, {
        target: { value: invalidAddress },
      });

      expect(queryByText("Not a valid address")).toBeInTheDocument();

      await fireEvent.input(addressInput, {
        target: { value: shieldedAddress },
      });

      expect(queryByText("Not a valid address")).toBeNull();
    });

    it("should offer no QR scan without a camera", async () => {
      const { queryByRole } = render(Send, baseProps);

      expect(hasCamera).toHaveBeenCalledOnce();

      await hasCamera.mock.results[0].value;
      await tick();

      expect(queryByRole("button", { name: "SCAN QR" })).toBeNull();
    });

    it("should offer a QR scan with a camera", async () => {
      hasCamera.mockResolvedValueOnce(true);

      const { findByRole } = render(Send, baseProps);

      expect(await findByRole("button", { name: "SCAN QR" })).toBeEnabled();
    });

    it("should show no banner for a public account, as the page's spendable balance says which one pays", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const sendToAddress =
        "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: sendToAddress },
      });

      expect(addressInput).toHaveValue(sendToAddress);
      expect(container.querySelector(".banner")).toBeNull();
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should display only a one-line warning if the address input is the user's own public account", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: publicAddress },
      });

      const banners = container.querySelectorAll(".banner");

      expect(addressInput).toHaveValue(publicAddress);
      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveClass("banner--warning");
      expect(banners[0]).toHaveTextContent(/^This is your own address\.$/);
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should display a notice if the address input is the BEP20 bridge address", async () => {
      const { getByRole, findByText, getByText } = render(Send, baseProps);
      const addressInput = getByRole("textbox");

      await fireEvent.input(addressInput, {
        target: { value: bep20BridgeAddress },
      });

      expect(addressInput).toHaveValue(bep20BridgeAddress);
      expect(await findByText("BEP20 bridge address")).toBeInTheDocument();
      expect(
        getByText(
          "In the memo, enter the EVM address that receives the tokens."
        )
      ).toBeInTheDocument();
    });
  });

  describe("Amount step", () => {
    it("should start over from the gas settings it gets in the address step", async () => {
      const { container, getByRole, rerender } = render(Send, baseProps);
      const maxFee = () =>
        container.querySelector(".gas-fee__amount-value")?.textContent;

      await fireEvent.input(getByRole("textbox"), {
        target: { value: shieldedAddress },
      });
      await rerender({
        gasLimits: { ...baseProps.gasLimits, gasLimitLower: 30_000_000n },
        gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(maxFee()).toBe(formatter(luxToDusk(50_000_000n)));
      expect(getByRole("button", { name: "Next" })).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Back" }));
      await rerender({
        gasLimits: { ...baseProps.gasLimits, gasLimitLower: 60_000_000n },
        gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByRole("button", { name: "Next" })).toBeDisabled();
    });

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
      const { getByRole, getByText } = render(Send, props);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const next = getByRole("button", { name: "Next" });

      await tick();

      expect(next).toBeDisabled();
      expect(
        getByText("Insufficient balance for gas fees")
      ).toBeInTheDocument();
      expect(
        getByText("Add funds or lower the gas limit.")
      ).toBeInTheDocument();
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
      const { getByRole, getByText } = render(Send, baseProps);

      await fireEvent.click(getByRole("button", { name: "Next" }));

      const nextButton = getByRole("button", { name: "Next" });
      const amountInput = getByRole("spinbutton");

      expect(nextButton).toBeEnabled();

      await fireEvent.input(amountInput, { target: { value: 0 } });

      expect(amountInput).toHaveValue(0);
      expect(nextButton).toBeDisabled();

      await fireEvent.input(amountInput, { target: { value: 1000 } });

      expect(nextButton).toBeDisabled();
      expect(getByText("Amount exceeds available balance")).toBeInTheDocument();
      expect(
        getByText("Lower the amount to leave room for the fee.")
      ).toBeInTheDocument();
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
      expect(
        await findByText("Enter the EVM address that receives the tokens.")
      ).toBeInTheDocument();
      expect(nextButtonAmountStep).toBeDisabled();

      // Enter an invalid EVM address as memo
      await fireEvent.input(memoInput, { target: { value: "invalid-evm" } });
      expect(memoInput).toHaveValue("invalid-evm");

      expect(
        await findByText("Invalid EVM address format")
      ).toBeInTheDocument();
      expect(
        await findByText(
          'EVM addresses are 40 hexadecimal characters, optionally prefixed with "0x".'
        )
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
      const { container, getAllByRole, getByRole, queryByText } = render(
        Send,
        baseProps
      );
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

      const fee =
        baseProps.gasSettings.gasLimit * baseProps.gasSettings.gasPrice;
      const key = getAsHTMLElement(
        container,
        ".operation__review-address span"
      );
      const memo = getAsHTMLElement(container, ".operation__review-memo span");

      expect(getReviewAmounts(container)).toStrictEqual([
        ["Amount", formatter(amount)],
        ["Network fee (max)", formatter(luxToDusk(fee))],
        ["Total (max)", formatter(luxToDusk(duskToLux(amount) + fee))],
      ]);
      expect(container.querySelector("dt .dusk-icon")).toBeNull();
      expect(getAllByRole("img", { name: "DUSK" })).toHaveLength(3);
      expect(container.querySelector(".gas-fee")).toBeNull();
      expect(key.textContent).toBe(shieldedAddress);
      expect(key.parentElement).not.toHaveClass(
        "operation__review-address--with-name"
      );
      expect(container.querySelector(".operation__review-name")).toBeNull();
      expect(memo.textContent).toBe("abc-example-memo");

      // The stepper names the step: no banner repeats it.
      expect(
        getAsHTMLElement(
          container,
          ".dusk-stepper__step-label:not(.dusk-stepper__step-label--invisible)"
        )
      ).toHaveTextContent(/^Review$/);
      expect(queryByText("REVIEW TRANSACTION")).not.toBeInTheDocument();
      expect(
        container.querySelector(".dusk-badge--variant-warning")
      ).toBeNull();
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it.each([
      [
        "a public account",
        "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
        /^PUBLIC Visible on chain$/,
      ],
      ["a shielded address", shieldedAddress, /^SHIELDED Private$/],
    ])(
      "should show the type of a transfer to %s in one short line",
      async (_, address, type) => {
        const { container, getByRole, getByText } = render(Send, baseProps);

        await fireEvent.input(getByRole("textbox"), {
          target: { value: address },
        });
        await fireEvent.click(getByRole("button", { name: "Next" }));
        await fireEvent.click(getByRole("button", { name: "Next" }));

        expect(getByText("Type")).toBeInTheDocument();
        expect(
          getAsHTMLElement(container, ".operation__review-type")
        ).toHaveTextContent(type);
      }
    );
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
      expect(
        getByText("Waiting for confirmation. The wallet updates automatically.")
      ).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should perform the transfer with the gas limit the user sets", async () => {
      const { getByLabelText, getByRole } = render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "EDIT" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "30000000" },
      });
      await tick();
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));

      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(1),
        "",
        baseProps.gasSettings.gasPrice,
        30_000_000n
      );
    });

    it("should not send again when new gas settings arrive after sending", async () => {
      const { getByRole, rerender } = render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "SEND" }));
      await vi.advanceTimersToNextTimerAsync();
      await rerender({ gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n } });
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
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
    const { gasLimit, gasPrice } = baseProps.gasSettings;

    // The least a balance must hold to pay for a transfer is one Lux more.
    const maxGasFee = gasLimit * gasPrice;

    /** @param {string} name */
    const withBothAddresses = (name) => ({
      account: nameAccount,
      address: nameAddress,
      name,
    });

    /** @param {HTMLElement} container */
    const getShownAddress = (container) =>
      getAsHTMLElement(container, ".operation__review-address span");

    /** @param {HTMLElement} container */
    const getReviewType = (container) =>
      getAsHTMLElement(container, ".operation__review-type");

    /**
     * Checks that a name's one address shows as the two do, in an option
     * card, but picked and with no radio or radio mark, and with no full
     * address or banner besides.
     *
     * @param {HTMLElement} container
     * @param {string} title
     * @param {string} address
     * @param {string} line The option's line under its title.
     */
    const expectOnlyOption = (container, title, address, line) => {
      const option = getAsHTMLElement(container, ".operation__name-option");

      expect(
        container.querySelectorAll(".operation__name-option")
      ).toHaveLength(1);
      expect(option).toHaveClass(
        "operation__name-option--picked",
        "operation__name-option--single"
      );
      expect(option.querySelector(".operation__name-option-mark")).toBeNull();
      expect(option).toHaveTextContent(
        `${title} ${shortenAddress(address)} ${address} ${line}`
      );
      expect(getAsHTMLElement(option, "samp")).toHaveAttribute(
        "title",
        address
      );
      expect(
        container.querySelector(
          "[role='radiogroup'], [role='radio'], .operation__review-address, .banner"
        )
      ).toBeNull();

      return option;
    };

    it("should send to the account a name resolves to, after showing both", async () => {
      /** @type {(value: DuskNameResolution) => void} */
      let finishLookup = () => {};

      baseProps.resolveName.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLookup = resolve;
        })
      );

      const { container, findByText, getByRole, getByText } = render(
        Send,
        baseProps
      );

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
      expectOnlyOption(
        container,
        "Public account",
        nameAccount,
        "Visible on chain"
      );

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toHaveClass("operation__review-name");
      expect(getShownAddress(container)).toHaveTextContent(nameAccount);
      expect(getShownAddress(container).parentElement).toHaveClass(
        "operation__review-address--with-name"
      );
      expect(getReviewType(container)).toHaveTextContent(
        "PUBLIC Visible on chain"
      );

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAccount,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit
      );
    });

    it("should send a shielded transfer to a name with only a shielded address", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { container, findByText, getByRole, getByText, queryByText } =
        render(Send, { events: { keyChange }, props: baseProps });

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("alice.dusk points to")).toBeInTheDocument();
      expectOnlyOption(container, "Shielded address", nameAddress, "Private");
      expect(queryByText(/Not enough shielded DUSK/)).not.toBeInTheDocument();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toBeInTheDocument();
      expect(getShownAddress(container)).toHaveTextContent(nameAddress);
      expect(getReviewType(container)).toHaveTextContent("SHIELDED Private");

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit
      );
    });

    it("should keep Next disabled for a name with only a shielded address while the shielded balance can't pay for a transfer", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { container, findByText, getByRole, getByText } = render(Send, {
        ...baseProps,
        shieldedBalance: maxGasFee,
      });

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("alice.dusk points to")).toBeInTheDocument();
      expect(
        expectOnlyOption(
          container,
          "Shielded address",
          nameAddress,
          "Not enough shielded DUSK · Shield first"
        )
      ).toHaveClass("operation__name-option--disabled");
      expect(getByText(/Not enough shielded DUSK ·/)).toHaveTextContent(
        /^Not enough shielded DUSK · Shield first$/
      );
      expect(getByRole("link", { name: "Shield first" })).toHaveAttribute(
        "href",
        addBasePath("/dashboard/allocate")
      );
      expect(getByRole("button", { name: "Next" })).toBeDisabled();
    });

    it("should offer both addresses of a name with both, a short line each, and send to the one picked", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { container, findByRole, getByRole, getByText } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      const options = await findByRole("radiogroup", {
        name: "alice.dusk points to",
      });
      const publicOption = getByRole("radio", { name: "Public account" });
      const shieldedOption = getByRole("radio", { name: "Shielded address" });

      expect(options).toContainElement(publicOption);
      expect(options).toContainElement(shieldedOption);
      // A choice: each option has its radio mark.
      expect(
        options.querySelectorAll(".operation__name-option-mark")
      ).toHaveLength(2);
      expect(
        options.querySelector(".operation__name-option--single")
      ).toBeNull();
      expect(publicOption).toHaveAttribute("aria-checked", "true");
      expect(publicOption).toHaveTextContent(shortenAddress(nameAccount));
      expect(getAsHTMLElement(publicOption, "samp")).toHaveAttribute(
        "title",
        nameAccount
      );
      expect(publicOption).toHaveAccessibleDescription(
        `Visible on chain ${nameAccount}`
      );
      expect(shieldedOption).toHaveAttribute("aria-checked", "false");
      expect(shieldedOption).toHaveAttribute("aria-disabled", "false");
      expect(shieldedOption).toHaveTextContent(shortenAddress(nameAddress));
      expect(getAsHTMLElement(shieldedOption, "samp")).toHaveAttribute(
        "title",
        nameAddress
      );
      expect(shieldedOption).toHaveAccessibleDescription(
        `Private ${nameAddress}`
      );

      // No balances or banner, and the full address is left to Review.
      expect(options).not.toHaveTextContent("DUSK");
      expect(
        container.querySelector(".operation__review-address, .banner")
      ).toBeNull();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "account" } })
      );

      await fireEvent.click(shieldedOption);

      expect(shieldedOption).toBeChecked();
      expect(publicOption).not.toBeChecked();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.input(getByRole("spinbutton"), {
        target: { value: amount },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getByText("alice.dusk")).toHaveClass("operation__review-name");
      expect(getShownAddress(container)).toHaveTextContent(nameAddress);
      expect(getShownAddress(container).parentElement).toHaveClass(
        "operation__review-address--with-name"
      );
      expect(getReviewType(container)).toHaveTextContent("SHIELDED Private");

      await fireEvent.click(getByRole("button", { name: "SEND" }));

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit
      );
    });

    it("should keep a name's shielded address from being picked while the shielded balance can't pay for a transfer", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { findByRole, getByRole } = render(Send, {
        ...baseProps,
        shieldedBalance: maxGasFee,
      });

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      const shieldedOption = await findByRole("radio", {
        name: "Shielded address",
      });
      const publicOption = getByRole("radio", { name: "Public account" });

      expect(shieldedOption).toHaveAttribute("aria-disabled", "true");
      expect(shieldedOption).toHaveAccessibleDescription(
        `Not enough shielded DUSK · Shield first ${nameAddress}`
      );
      expect(shieldedOption).not.toHaveTextContent("Private");
      expect(getByRole("link", { name: "Shield first" })).toHaveAttribute(
        "href",
        addBasePath("/dashboard/allocate")
      );

      await fireEvent.click(shieldedOption);
      await fireEvent.keyDown(publicOption, { key: "ArrowDown" });
      await fireEvent.keyDown(shieldedOption, { key: " " });

      expect(publicOption).toBeChecked();
      expect(shieldedOption).not.toBeChecked();
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("should keep the address picked when the balances change, even once the shielded one can't pay, until the user picks another", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { findByRole, getByRole, getByText, queryByText, rerender } =
        render(Send, { ...baseProps, shieldedBalance: maxGasFee + 1n });

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      const shieldedOption = await findByRole("radio", {
        name: "Shielded address",
      });

      await fireEvent.click(shieldedOption);
      await rerender({ availableBalance: maxGasFee + 1n });

      expect(shieldedOption).toBeChecked();
      expect(queryByText(/Not enough shielded DUSK/)).not.toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeEnabled();

      await rerender({ shieldedBalance: maxGasFee });

      expect(shieldedOption).toBeChecked();
      expect(shieldedOption).toHaveAttribute("aria-disabled", "true");
      expect(getByText(/Not enough shielded DUSK/)).toBeInTheDocument();
      expect(getByRole("button", { name: "Next" })).toBeDisabled();

      await fireEvent.click(getByRole("radio", { name: "Public account" }));

      expect(shieldedOption).not.toBeChecked();
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("should move the pick between a name's addresses with the arrow keys, and make it with Space", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { findByRole, getByRole } = render(Send, baseProps);

      await fireEvent.input(getByRole("textbox"), {
        target: { value: "alice.dusk" },
      });

      const publicOption = await findByRole("radio", {
        name: "Public account",
      });
      const shieldedOption = getByRole("radio", { name: "Shielded address" });

      expect(publicOption).toHaveAttribute("tabindex", "0");
      expect(shieldedOption).toHaveAttribute("tabindex", "-1");

      /** @type {Array<[HTMLElement, string, HTMLElement]>} */
      const moves = [
        [publicOption, "ArrowDown", shieldedOption],
        [shieldedOption, "ArrowUp", publicOption],
        [publicOption, "ArrowRight", shieldedOption],
        [shieldedOption, "ArrowLeft", publicOption],
        [publicOption, "ArrowUp", shieldedOption],
      ];

      for (const [focused, key, picked] of moves) {
        await fireEvent.keyDown(focused, { key });
        await waitFor(() => expect(picked).toHaveFocus());

        expect(picked).toBeChecked();
        expect(picked).toHaveAttribute("tabindex", "0");
        expect(focused).not.toBeChecked();
        expect(focused).toHaveAttribute("tabindex", "-1");
      }

      await fireEvent.keyDown(shieldedOption, { key: "Enter" });
      await fireEvent.keyDown(publicOption, { key: "Tab" });

      expect(shieldedOption).toBeChecked();

      await fireEvent.keyDown(publicOption, { key: " " });

      expect(publicOption).toBeChecked();
    });

    it("should keep the address picked for a name when it is entered again or the user steps back, and start any other name at its public account", async () => {
      baseProps.resolveName.mockImplementation((input) =>
        Promise.resolve(withBothAddresses(input.toLowerCase()))
      );

      const { findByRole, getByRole, queryByRole } = render(Send, baseProps);

      /** @param {string} value */
      const enter = (value) =>
        fireEvent.input(getByRole("textbox"), { target: { value } });

      /** @param {string} name */
      const findPicked = async (name) => {
        const option = await findByRole("radio", { name });

        await waitFor(() => expect(option).toBeChecked());
      };

      await enter("alice.dusk");
      await fireEvent.click(
        await findByRole("radio", { name: "Shielded address" })
      );
      await findPicked("Shielded address");

      await enter("alice.dus");

      expect(queryByRole("radiogroup")).not.toBeInTheDocument();

      await enter("alice.dusk");
      await findPicked("Shielded address");
      await enter("Alice.dusk");
      await findPicked("Shielded address");

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.click(getByRole("button", { name: "Back" }));
      await findPicked("Shielded address");

      await enter("bob.dusk");
      await findPicked("Public account");
      await enter("alice.dusk");
      await findPicked("Shielded address");

      expect(baseProps.resolveName).toHaveBeenCalledTimes(5);
    });

    it("should report no recipient type, for the page to show the public balance, while the name entered doesn't resolve", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName
        .mockResolvedValueOnce({ address: nameAddress, name: "alice.dusk" })
        .mockResolvedValueOnce({ error: "not-registered", name: "bob.dusk" });

      const { findByText, getByRole } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      /** @param {string} value */
      const enter = (value) =>
        fireEvent.input(getByRole("textbox"), { target: { value } });

      /** @param {"account" | "address" | undefined} type */
      const lastReported = (type) =>
        expect(keyChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ detail: { type } })
        );

      lastReported(undefined);

      await enter("alice.dusk");

      expect(await findByText("Shielded address")).toBeInTheDocument();
      lastReported("address");

      await enter("bob.dusk");

      expect(await findByText("bob.dusk isn't registered")).toBeInTheDocument();
      lastReported(undefined);

      await enter(shieldedAddress);

      lastReported("address");

      await enter("");

      lastReported(undefined);
    });

    it.each([
      [
        "expired",
        "alice.dusk has expired",
        "An expired name can't receive DUSK.",
      ],
      [
        "invalid",
        "alice.dusk isn't a valid name",
        "Names use only letters, digits and hyphens.",
      ],
      [
        "lookup-failed",
        "Couldn't look up alice.dusk",
        "Check your connection.",
      ],
      [
        "no-address",
        "alice.dusk has no address to send to",
        "Its owner needs to add one first.",
      ],
      [
        "not-registered",
        "alice.dusk isn't registered",
        "Check the name, or paste the recipient's address instead.",
      ],
      [
        "unsupported-network",
        ".dusk names aren't available on this network",
        "They work on mainnet and testnet. Paste the recipient's address instead.",
      ],
    ])(
      "should explain the %s error inline and keep Next disabled",
      async (error, title, text) => {
        baseProps.resolveName.mockResolvedValueOnce({
          error,
          name: "alice.dusk",
        });

        const { findByText, getByRole, getByText } = render(Send, baseProps);

        await fireEvent.input(getByRole("textbox"), {
          target: { value: "alice.dusk" },
        });

        expect(await findByText(title)).toBeInTheDocument();
        expect(getByText(text)).toBeInTheDocument();
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
