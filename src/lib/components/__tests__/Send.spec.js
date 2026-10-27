import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import {
  duskToLux,
  formatDuskExact,
  formatDuskPlain,
} from "$lib/dusk/currency";
import { shortenAddress } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import { addBasePath } from "$lib/navigation";
import { DEFAULT_BLOCKLISTED_ADDRESSES } from "$lib/security/addressBlocklist";
import {
  getContact,
  listContacts,
  removeContact,
  saveContact,
} from "$lib/contacts";

import { Send } from "..";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

// The transaction sent stays pending, unless a test ends it.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

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
 * The summary's rows, as their labels and values.
 *
 * @param {HTMLElement} container
 */
const getSummary = (container) =>
  Array.from(
    container.querySelectorAll(".send__summary .send__rows > div"),
    (row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim(),
    ]
  );

describe("Send", () => {
  const lastTxId =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
  const publicAddress =
    "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
  const shieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const otherAccount =
    "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
  const otherShielded =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM";

  // The BEP20 bridge's account on Dusk.
  const bep20BridgeAddress =
    "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
  const baseProps = {
    availableBalance: 1_000_000_000_000n,
    bep20BridgeAddress,
    execute: vi.fn().mockResolvedValue(lastTxId),
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
  const { gasLimit, gasPrice } = baseProps.gasSettings;
  const fee = gasLimit * gasPrice;

  const invalidAddress =
    "aB5rL7yC2zK9eV3xH1gQ6fP4jD8sM0iU2oX7wG9nZ8lT3hU4jP5mK8nS6qJ3wF4aA9bB2cC5dD8eE7";

  /** @param {(role: string, options: object) => HTMLElement} getByRole */
  const fieldsOf = (getByRole) => ({
    amount: () => getByRole("textbox", { name: "Amount" }),
    memo: () => getByRole("textbox", { name: /^Memo/ }),
    review: () => getByRole("button", { name: "Review" }),
    send: () => getByRole("button", { name: /^Send/ }),
    to: () => getByRole("textbox", { name: "To" }),
  });

  beforeEach(() => {
    followTransaction.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.resolveName.mockReset();
    followTransaction.mockReset();
    hasCamera.mockClear();

    for (const contact of listContacts()) {
      removeContact(contact.id);
    }
  });

  describe("Recipient", () => {
    it("should render the one-page Send form, with its summary", () => {
      const { container, getByRole } = render(Send, baseProps);

      expect(getByRole("link", { name: "Home" })).toHaveAttribute(
        "href",
        "/some-base-path/dashboard"
      );

      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should keep Send and Review disabled while the recipient is empty or isn't valid", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      expect(fields.to()).toHaveValue("");
      expect(fields.send()).toBeDisabled();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress },
      });

      expect(fields.send()).toBeDisabled();
      expect(fields.review()).toBeDisabled();
    });

    it("should take Enter after an address to the amount, instead of adding anything", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });

      const enter = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });

      fields.to().dispatchEvent(enter);
      await tick();

      expect(enter.defaultPrevented).toBe(true);
      expect(fields.amount()).toHaveFocus();
    });

    it("should say why on Enter while the address isn't valid", async () => {
      const { getByRole, getByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress },
      });
      await fireEvent.keyDown(fields.to(), { key: "Enter" });

      expect(fields.amount()).not.toHaveFocus();
      expect(fields.send()).toBeDisabled();
      expect(getByText("Not a valid address.")).toBeInTheDocument();
      expect(fields.to()).toHaveAccessibleDescription(
        "Not a valid address. Check it, or paste it again."
      );
      expect(fields.to()).toHaveAttribute("aria-invalid", "true");
    });

    it("should remove the spaces and line breaks a pasted address brings", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.paste(fields.to());
      await fireEvent.input(fields.to(), {
        target: {
          value: ` ${shieldedAddress.slice(0, 40)}\n${shieldedAddress.slice(40)}\n`,
        },
      });

      expect(fields.to()).toHaveValue(shieldedAddress);
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fields.send()).toBeEnabled();
    });

    it("should point out an invalid address once it is pasted or left, not while it is typed", async () => {
      const { getByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress.slice(0, 20) },
      });

      expect(queryByText("Not a valid address.")).toBeNull();
      expect(fields.to()).toHaveAttribute("aria-invalid", "false");

      await fireEvent.blur(fields.to());

      expect(queryByText("Not a valid address.")).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: "" } });

      expect(queryByText("Not a valid address.")).toBeNull();

      await fireEvent.paste(fields.to());
      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress },
      });

      expect(queryByText("Not a valid address.")).toBeInTheDocument();

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });

      expect(queryByText("Not a valid address.")).toBeNull();
    });

    it("should offer no QR scan without a camera", async () => {
      const { queryByRole } = render(Send, baseProps);

      expect(hasCamera).toHaveBeenCalledOnce();

      await hasCamera.mock.results[0].value;
      await tick();

      expect(queryByRole("button", { name: "Scan a QR code" })).toBeNull();
    });

    it("should offer a QR scan with a camera", async () => {
      hasCamera.mockResolvedValueOnce(true);

      const { findByRole } = render(Send, baseProps);

      expect(
        await findByRole("button", { name: "Scan a QR code" })
      ).toBeEnabled();
    });

    it.each([
      [
        "a public account",
        otherAccount,
        "A public account",
        "Public: the amount and both accounts are visible on chain.",
      ],
      [
        "a shielded address",
        otherShielded,
        "A shielded address",
        "Shielded: not shown on the public chain. The person you pay sees what you send them.",
      ],
    ])(
      "should show %s in full, and what the chain shows of the transfer",
      async (_, address, title, privacy) => {
        const { container, getByRole } = render(Send, baseProps);

        await fireEvent.input(fieldsOf(getByRole).to(), {
          target: { value: address },
        });

        const card = getAsHTMLElement(container, ".send__card");

        expect(card).toHaveTextContent(title);
        expect(getAsHTMLElement(card, ".full-address")).toHaveTextContent(
          address
        );
        expect(getAsHTMLElement(card, ".full-address__tail")).toHaveTextContent(
          address.slice(-6)
        );
        expect(card).toHaveTextContent(privacy);
        expect(container.querySelector(".banner")).toBeNull();
      }
    );

    it("should display only a one-line warning if the address input is the user's own public account", async () => {
      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: publicAddress },
      });

      const banners = container.querySelectorAll(".banner");

      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveClass("banner--warning");
      expect(banners[0]).toHaveTextContent(/^This is your own address\.$/);
    });

    it("should display a notice if the address input is the BEP20 bridge address", async () => {
      const { findByText, getByRole, getByText } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: bep20BridgeAddress },
      });

      expect(await findByText("BEP20 bridge address")).toBeInTheDocument();
      expect(
        getByText(
          "In the memo, enter the EVM address that receives the tokens."
        )
      ).toBeInTheDocument();
    });

    it("should start from the recipient it opens with, as from Send again", () => {
      const { container, getByRole } = render(Send, {
        ...baseProps,
        initialRecipient: otherAccount,
      });

      expect(fieldsOf(getByRole).to()).toHaveValue(otherAccount);
      expect(getAsHTMLElement(container, ".send__card")).toHaveTextContent(
        "A public account"
      );
    });
  });

  describe("Amount and memo", () => {
    it("should take new gas settings while the form shows, unless the gas was edited here", async () => {
      const { container, getByLabelText, getByRole, rerender } = render(
        Send,
        baseProps
      );
      const maxFee = () =>
        container.querySelector(".gas-fee__amount-value")?.textContent;

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: shieldedAddress },
      });
      await rerender({
        gasLimits: { ...baseProps.gasLimits, gasLimitLower: 30_000_000n },
        gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      });

      expect(maxFee()).toBe("0.05");
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fieldsOf(getByRole).send()).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Edit" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "40000000" },
      });
      await tick();
      await rerender({ gasSettings: { gasLimit: 60_000_000n, gasPrice: 1n } });

      expect(maxFee()).toBe("0.04");
    });

    it("should keep Send disabled, and say why, while the balance can't pay the fee", async () => {
      const { getByRole, getByText } = render(Send, {
        ...baseProps,
        gasSettings: { gasLimit: 40000000n, gasPrice: 40000000n },
        initialRecipient: shieldedAddress,
      });

      await tick();

      expect(fieldsOf(getByRole).send()).toBeDisabled();
      expect(getByText("Not enough for the network fee.")).toBeInTheDocument();
    });

    it("should take an amount typed with a decimal comma, or with its thousands grouped", async () => {
      const { container, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);
      const amount = () =>
        getSummary(container).find(([label]) => label === "Amount")?.[1];

      await fireEvent.input(fields.amount(), { target: { value: "1,5" } });

      expect(amount()).toBe("1.5 DUSK");
      expect(fields.send()).toBeEnabled();
      expect(queryByRole("alert")).toBeNull();

      await fireEvent.input(fields.amount(), { target: { value: "1,000" } });

      expect(amount()).toBe("1,000 DUSK");

      await fireEvent.input(fields.amount(), {
        target: { value: "0,0000000001" },
      });

      expect(getByRole("alert")).toHaveTextContent(
        "DUSK has 9 decimals at most."
      );
    });

    it("should set the most it can send with Max, leaving room for the fee", async () => {
      const { getByRole } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(fields.amount()).toHaveValue(
        formatDuskPlain(baseProps.availableBalance - fee)
      );
      expect(fields.send()).toBeEnabled();
    });

    it("should never show a Total at Max that reads more than the balance", async () => {
      const availableBalance = 173_901_884_001n;
      const { container, getByRole } = render(Send, {
        ...baseProps,
        availableBalance,
        initialRecipient: shieldedAddress,
      });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getSummary(container).at(-1)).toStrictEqual([
        "Total",
        "Up to 173.901884001 DUSK",
      ]);
    });

    it.each([
      ["the balance is zero", { availableBalance: 0n }],
      [
        "the gas settings aren't valid",
        { gasSettings: { gasLimit: 40000000n, gasPrice: 40000000n } },
      ],
    ])("should keep the amount on Max while %s", async (_, props) => {
      const { getByRole } = render(Send, { ...baseProps, ...props });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(fields.amount()).toHaveValue("1");
    });

    it("should keep Send disabled for an amount that isn't valid, and say when it's more than there is", async () => {
      const { getByRole, getByText } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      // Nothing is filled in: the button offers only what is typed.
      expect(fields.amount()).toHaveValue("");
      expect(fields.send()).toBeDisabled();
      expect(fields.send()).toHaveAccessibleName("Send");

      await fireEvent.input(fields.amount(), { target: { value: "1" } });

      expect(fields.send()).toBeEnabled();

      await fireEvent.input(fields.amount(), { target: { value: "0" } });

      expect(fields.send()).toBeDisabled();
      expect(getByText("Enter an amount greater than 0.")).toBeInTheDocument();

      // Below one LUX: kept as typed, and refused.
      await fireEvent.input(fields.amount(), {
        target: { value: "0.0000000001" },
      });

      expect(fields.amount()).toHaveValue("0.0000000001");
      expect(fields.send()).toBeDisabled();
      expect(getByText("DUSK has 9 decimals at most.")).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "1e2" } });

      expect(
        getByText("Enter an amount such as 10 or 10.5.")
      ).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "100000" } });

      expect(fields.send()).toBeDisabled();
      expect(
        getByText(
          `More than your ${formatDuskExact(baseProps.availableBalance, "en")} DUSK.`
        )
      ).toBeInTheDocument();
    });

    it("should require a valid EVM address in memo if sending to BEP20 bridge", async () => {
      const { getByRole, queryByText } = render(Send, {
        ...baseProps,
        availableBalance: 1_000_000_000_000_000n,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: bep20BridgeAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: "10" } });

      expect(getByRole("textbox", { name: "Memo" })).toBeInTheDocument();
      expect(
        queryByText("Enter the EVM address that receives the tokens.")
      ).toBeInTheDocument();
      expect(fields.send()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "invalid-evm" },
      });

      expect(queryByText("Not an EVM address.")).toBeInTheDocument();
      expect(fields.send()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "0x9876543210987654321098765432109876543210" },
      });

      expect(queryByText("Not an EVM address.")).not.toBeInTheDocument();
      expect(fields.send()).toBeEnabled();
    });

    it("should take any memo, and say it stays on chain, for a transfer not to the BEP20 bridge", async () => {
      const { getByRole, getByText, queryByText } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.memo(), {
        target: { value: "not-an-evm-address" },
      });

      expect(getByRole("textbox", { name: "Memo (optional)" })).toHaveValue(
        "not-an-evm-address"
      );
      expect(
        getByText(
          "Visible on chain, for good: don't put personal details in it."
        )
      ).toBeInTheDocument();
      expect(queryByText("Not an EVM address.")).not.toBeInTheDocument();
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fields.send()).toBeEnabled();
    });
  });

  describe("Summary", () => {
    it("should sum the transfer up, the amount exactly and the fee and total as the most they cost", async () => {
      const amount = 2345.5;
      const { container, getByRole, getByText } = render(Send, {
        ...baseProps,
        availableBalance: 10_000_000_000_000n,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await fireEvent.input(fields.memo(), {
        target: { value: "abc-example-memo" },
      });

      expect(getSummary(container)).toStrictEqual([
        ["From", "Your shielded balance"],
        ["To", shortenAddress(shieldedAddress)],
        ["Amount", "2,345.5 DUSK"],
        ["Memo", "abc-example-memo"],
        ["Total", "Up to 2,345.52 DUSK"],
      ]);
      expect(
        container.querySelector(".send__summary .gas-fee")
      ).toHaveTextContent("Network fee (at most) 0.02 DUSK");
      expect(fields.send()).toHaveTextContent("Send 2,345.5 DUSK");
      expect(getByText("Sends can't be undone.")).toBeInTheDocument();
    });
  });

  describe("Send operation", () => {
    vi.useFakeTimers();

    const amount = 567;
    const expectedExplorerLink = `/explorer/transactions/transaction?id=${lastTxId}`;

    afterAll(() => {
      vi.useRealTimers();
    });

    /**
     * Fills the form in and sends, as on a laptop.
     *
     * @param {(role: string, options: object) => HTMLElement} getByRole
     * @param {{ memo?: string, to?: string, value?: number }} [values]
     */
    const sendWith = async (
      getByRole,
      { memo, to = shieldedAddress, value = amount } = {}
    ) => {
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: to } });
      await fireEvent.input(fields.amount(), { target: { value } });

      if (memo !== undefined) {
        await fireEvent.input(fields.memo(), { target: { value: memo } });
      }

      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();
    };

    it("should send the amount from the summary, with no review on a laptop, and say it was sent with a link to the explorer", async () => {
      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        shieldedAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      // What went to whom, and where the history has it.
      expect(getByRole("status")).toHaveTextContent(
        `Sent 567 DUSK to ${shortenAddress(shieldedAddress)} Pending. This usually takes under a minute.`
      );
      expect(getByRole("link", { name: "See in History" })).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${lastTxId}`
      );
      expect(getByText("8dcf6f8a...993db55e")).toBeInTheDocument();
      expect(followTransaction).toHaveBeenCalledWith(
        lastTxId,
        expect.anything()
      );
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should review a transfer on a phone before it sends it, and go back to the form", async () => {
      const { container, getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.click(fields.review());

      expect(container.querySelector(".send")).toHaveClass("send--review");
      expect(queryByRole("button", { name: "Review" })).toBeNull();

      await fireEvent.click(getByRole("button", { name: "Back" }));

      expect(container.querySelector(".send")).not.toHaveClass("send--review");

      await fireEvent.click(fields.review());
      await fireEvent.click(fields.send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
    });

    it("should follow the transaction until its block is final, then show it completed with the fee it was charged", async () => {
      /** @type {PromiseWithResolvers<any>} */
      const following = Promise.withResolvers();

      followTransaction.mockReturnValue(following.promise);

      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(getByRole("status")).toHaveTextContent(
        /^Sent 567 DUSK to .+ Pending/
      );
      expect(getByText("Network fee (at most)")).toBeInTheDocument();
      expect(getByText("0.02 DUSK")).toBeInTheDocument();

      following.resolve({
        blockHeight: 4_687_200n,
        error: null,
        fee: 1_854_795n,
      });
      await vi.advanceTimersToNextTimerAsync();

      expect(getByRole("status")).toHaveTextContent(
        /^Completed 567 DUSK to .+ In block 4,687,200\.$/
      );
      // The fee charged, to the nearest of four decimals.
      expect(getByText("0.0019 DUSK")).toBeInTheDocument();
    });

    it("should perform the transfer with the gas limit the user sets", async () => {
      const { getByLabelText, getByRole } = render(Send, baseProps);

      await fireEvent.click(getByRole("button", { name: "Edit" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "30000000" },
      });
      await tick();
      await sendWith(getByRole, { value: 1 });

      expect(baseProps.execute).toHaveBeenCalledWith(
        shieldedAddress,
        duskToLux(1),
        "",
        gasPrice,
        30_000_000n
      );
    });

    it("should not send again when new gas settings arrive after sending", async () => {
      const { getByRole, rerender } = render(Send, baseProps);

      await sendWith(getByRole);
      await rerender({ gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n } });
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
    });

    it("should send a memo as typed", async () => {
      const memo = " abc-example-memo ";
      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole, { memo });

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        shieldedAddress,
        duskToLux(amount),
        memo,
        gasPrice,
        gasLimit
      );
      expect(getByText("Sent")).toBeInTheDocument();
    });

    it("should trim a BEP20 bridge memo in the summary and the transfer", async () => {
      const evmAddress = "0x9876543210987654321098765432109876543210";
      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: bep20BridgeAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await fireEvent.input(fields.memo(), {
        target: { value: ` \n${evmAddress}\t ` },
      });

      expect(getSummary(container)).toContainEqual(["Memo", evmAddress]);

      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        bep20BridgeAddress,
        duskToLux(amount),
        evmAddress,
        gasPrice,
        gasLimit
      );
    });

    it("should show an error message if the transfer fails", async () => {
      const errorMessage = "Some error message";

      baseProps.execute.mockRejectedValueOnce(new Error(errorMessage));

      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(getByText("Transaction failed")).toBeInTheDocument();
      expect(getByText(errorMessage)).toBeInTheDocument();
    });

    it("should show the success message, but no explorer link, if the execution promise doesn't resolve with an hash", async () => {
      baseProps.execute.mockResolvedValueOnce(void 0);

      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(getByText("Sent")).toBeInTheDocument();
      expect(followTransaction).not.toHaveBeenCalled();
      expect(() => getByRole("link", { name: /explorer/i })).toThrow();
    });
  });

  describe("Dusk Domains names", () => {
    const amount = 567;
    const nameAccount =
      "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";
    const nameAddress =
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM";

    // The least a balance must hold to pay for a transfer is one Lux more.
    const maxGasFee = fee;

    /** @param {string} name */
    const withBothAddresses = (name) => ({
      account: nameAccount,
      address: nameAddress,
      name,
    });

    /**
     * Sends what the form holds, as on a laptop.
     *
     * @param {(role: string, options: object) => HTMLElement} getByRole
     */
    const sendIt = async (getByRole) => {
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await fireEvent.click(fields.send());
    };

    it("should send to the account a name resolves to, with its name and address shown", async () => {
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

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: " Alice.dusk " },
      });

      expect(baseProps.resolveName).toHaveBeenCalledExactlyOnceWith(
        "Alice.dusk"
      );
      expect(getByText("Looking up Alice.dusk…")).toBeInTheDocument();
      expect(fieldsOf(getByRole).send()).toBeDisabled();

      finishLookup({ account: nameAccount, name: "alice.dusk" });

      expect(
        await findByText("alice.dusk points to a public account")
      ).toBeInTheDocument();
      expect(getByText("Name found")).toBeInTheDocument();
      expect(container.querySelector("[role='radiogroup']")).toBeNull();
      expect(
        getAsHTMLElement(container, ".send__card .full-address")
      ).toHaveTextContent(nameAccount);
      expect(getSummary(container)[1]).toStrictEqual([
        "To",
        `alice.dusk ${shortenAddress(nameAccount)}`,
      ]);

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAccount,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk"
      );
    });

    it("should send a shielded transfer to a name with only a shielded address", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { findByText, getByRole, queryByText } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      expect(
        await findByText("alice.dusk points to a shielded address")
      ).toBeInTheDocument();
      expect(queryByText(/Not enough shielded DUSK/)).not.toBeInTheDocument();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk"
      );
    });

    it("should keep Send disabled for a name with only a shielded address while the shielded balance can't pay for a transfer", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { findByText, getByRole, getByText } = render(Send, {
        ...baseProps,
        shieldedBalance: maxGasFee,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      expect(
        await findByText("alice.dusk points to a shielded address")
      ).toBeInTheDocument();
      expect(getByText(/Not enough shielded DUSK ·/)).toHaveTextContent(
        /^Not enough shielded DUSK · Shield first$/
      );
      expect(getByRole("link", { name: "Shield first" })).toHaveAttribute(
        "href",
        addBasePath("/dashboard/allocate")
      );
      expect(fieldsOf(getByRole).send()).toBeDisabled();
    });

    it("should offer both addresses of a name with both, a short line each, and send to the one picked", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { container, findByRole, getByRole } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      const options = await findByRole("radiogroup", {
        name: "alice.dusk points to two addresses",
      });
      const publicOption = getByRole("radio", { name: "Public account" });
      const shieldedOption = getByRole("radio", { name: "Shielded address" });

      expect(options).toContainElement(publicOption);
      expect(options).toContainElement(shieldedOption);
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
      expect(shieldedOption).toHaveAccessibleDescription(
        `Not shown on the public chain ${nameAddress}`
      );
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "account" } })
      );

      await fireEvent.click(shieldedOption);

      expect(shieldedOption).toBeChecked();
      expect(publicOption).not.toBeChecked();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } })
      );
      expect(
        getAsHTMLElement(container, ".send__card .full-address")
      ).toHaveTextContent(nameAddress);

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk"
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

      await fireEvent.input(fieldsOf(getByRole).to(), {
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

      await fireEvent.click(shieldedOption);
      await fireEvent.keyDown(publicOption, { key: "ArrowDown" });
      await fireEvent.keyDown(shieldedOption, { key: " " });

      expect(publicOption).toBeChecked();
      expect(shieldedOption).not.toBeChecked();
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fieldsOf(getByRole).send()).toBeEnabled();
    });

    it("should keep the address picked when the balances change, even once the shielded one can't pay, until the user picks another", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { findByRole, getByRole, getAllByText, queryByText, rerender } =
        render(Send, { ...baseProps, shieldedBalance: maxGasFee + 1n });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      const shieldedOption = await findByRole("radio", {
        name: "Shielded address",
      });

      await fireEvent.click(shieldedOption);
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "0.000000001" },
      });
      await rerender({ availableBalance: maxGasFee + 1n });

      expect(shieldedOption).toBeChecked();
      expect(queryByText(/Not enough shielded DUSK/)).not.toBeInTheDocument();
      expect(fieldsOf(getByRole).send()).toBeEnabled();

      await rerender({ shieldedBalance: maxGasFee });

      expect(shieldedOption).toBeChecked();
      expect(shieldedOption).toHaveAttribute("aria-disabled", "true");
      expect(getAllByText(/Not enough shielded DUSK/).length).toBeGreaterThan(
        0
      );
      expect(fieldsOf(getByRole).send()).toBeDisabled();

      await fireEvent.click(getByRole("radio", { name: "Public account" }));

      expect(shieldedOption).not.toBeChecked();
      expect(fieldsOf(getByRole).send()).toBeEnabled();
    });

    it("should move the pick between a name's addresses with the arrow keys, and make it with Space", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk")
      );

      const { findByRole, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
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

    it("should keep the address picked for a name when it is entered again, and start any other name at its public account", async () => {
      baseProps.resolveName.mockImplementation((input) =>
        Promise.resolve(withBothAddresses(input.toLowerCase()))
      );

      const { findByRole, getByRole, queryByRole } = render(Send, baseProps);

      /** @param {string} value */
      const enter = (value) =>
        fireEvent.input(fieldsOf(getByRole).to(), { target: { value } });

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
        fireEvent.input(fieldsOf(getByRole).to(), { target: { value } });

      /** @param {"account" | "address" | undefined} type */
      const lastReported = (type) =>
        expect(keyChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ detail: { type } })
        );

      lastReported(undefined);

      await enter("alice.dusk");

      expect(
        await findByText("alice.dusk points to a shielded address")
      ).toBeInTheDocument();
      lastReported("address");

      await enter("bob.dusk");

      expect(
        await findByText("bob.dusk isn't registered.")
      ).toBeInTheDocument();
      lastReported(undefined);

      await enter(shieldedAddress);

      lastReported("address");

      await enter("");

      lastReported(undefined);
    });

    it.each([
      [
        "expired",
        "alice.dusk has expired.",
        "An expired name can't receive DUSK.",
      ],
      [
        "invalid",
        "alice.dusk isn't a valid name.",
        "Names use only letters, digits and hyphens.",
      ],
      [
        "lookup-failed",
        "Couldn't look up alice.dusk.",
        "Check your connection.",
      ],
      [
        "no-address",
        "alice.dusk has no address to send to.",
        "Its owner needs to add one first.",
      ],
      [
        "not-registered",
        "alice.dusk isn't registered.",
        "Check the name, or paste the recipient's address instead.",
      ],
      [
        "unsupported-network",
        ".dusk names aren't available on this network.",
        "They work on mainnet and testnet. Paste the recipient's address instead.",
      ],
    ])(
      "should explain the %s error inline and keep Send disabled",
      async (error, title, text) => {
        baseProps.resolveName.mockResolvedValueOnce({
          error,
          name: "alice.dusk",
        });

        const { findByText, getByRole } = render(Send, baseProps);

        await fireEvent.input(fieldsOf(getByRole).to(), {
          target: { value: "alice.dusk" },
        });

        const shown = await findByText(title);

        expect(shown.parentElement).toHaveTextContent(`${title} ${text}`);
        expect(fieldsOf(getByRole).send()).toBeDisabled();
      }
    );

    it("should look the name up again after a failed lookup", async () => {
      baseProps.resolveName
        .mockResolvedValueOnce({ error: "lookup-failed", name: "alice.dusk" })
        .mockResolvedValueOnce({ account: nameAccount, name: "alice.dusk" });

      const { findByRole, findByText, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(await findByRole("button", { name: "Try again" }));

      expect(
        await findByText("alice.dusk points to a public account")
      ).toBeInTheDocument();
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fieldsOf(getByRole).send()).toBeEnabled();
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

      const { container, findByText, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "bob.dusk" } });
      finishFirstLookup({ account: nameAccount, name: "alice.dusk" });
      await tick();

      expect(
        await findByText("bob.dusk isn't registered.")
      ).toBeInTheDocument();
      expect(container.querySelector(".send__card")).toBeNull();
      expect(fields.send()).toBeDisabled();
    });

    it("should block a name that resolves to a blocked address", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        account: DEFAULT_BLOCKLISTED_ADDRESSES[0].address,
        name: "alice.dusk",
      });

      const { findByText, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("Blocked recipient address")).toBeInTheDocument();
      expect(fieldsOf(getByRole).send()).toBeDisabled();
    });

    it("should suggest a known name for one that isn't registered, from the contacts and past payments only", async () => {
      saveContact({
        address: nameAccount,
        duskName: "alice-shop.dusk",
        name: "Alice's shop",
      });
      baseProps.resolveName.mockImplementation(async (input) =>
        input === "bram.dusk"
          ? { account: otherAccount, name: input }
          : { error: "not-registered", name: input }
      );

      const { findByRole, findByText, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        knownNames: ["bram.dusk"],
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: "alice-shpo.dusk" },
      });

      expect(
        await findByRole("button", { name: "Did you mean alice-shop.dusk?" })
      ).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: "brma.dusk" } });
      await fireEvent.click(
        await findByRole("button", { name: "Did you mean bram.dusk?" })
      );

      expect(fields.to()).toHaveValue("bram.dusk");
      expect(
        await findByText("bram.dusk points to a public account")
      ).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: "zed.dusk" } });
      await findByText("zed.dusk isn't registered.");

      expect(queryByRole("button", { name: /^Did you mean/ })).toBeNull();
    });
  });

  describe("Contacts", () => {
    const nameAccount =
      "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";

    it("should save a recipient to the contacts, with the .dusk name it came from", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        account: nameAccount,
        name: "alice.dusk",
      });

      const { container, findByRole, getByRole, getByText, queryByRole } =
        render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(
        await findByRole("button", { name: "Save to contacts" })
      );

      expect(getByText("Saved only on this device.")).toBeInTheDocument();

      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "Alice" },
      });
      await fireEvent.click(getByRole("button", { name: "Save" }));

      expect(listContacts()).toStrictEqual([
        expect.objectContaining({
          address: nameAccount,
          duskName: "alice.dusk",
          name: "Alice",
          type: "account",
        }),
      ]);
      expect(
        getAsHTMLElement(container, ".send__card-title")
      ).toHaveTextContent("Alice · alice.dusk");
      expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();
    });

    it("should name the contact of the address picked, of a .dusk name saved twice", async () => {
      saveContact({
        address: nameAccount,
        duskName: "alice.dusk",
        name: "Alice",
      });
      saveContact({
        address: otherShielded,
        duskName: "alice.dusk",
        name: "Alice (shielded)",
      });
      baseProps.resolveName.mockResolvedValueOnce({
        account: nameAccount,
        address: otherShielded,
        name: "alice.dusk",
      });

      const { container, findByRole, getByRole } = render(Send, baseProps);
      const title = () =>
        getAsHTMLElement(container, ".send__card-title").textContent?.trim();

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(
        await findByRole("radio", { name: "Shielded address" })
      );

      expect(title()).toBe("Alice (shielded) · alice.dusk");

      await fireEvent.click(getByRole("radio", { name: "Public account" }));

      expect(title()).toBe("Alice · alice.dusk");
    });

    it("should name one of the wallet's own accounts, and not offer to save it as a contact", async () => {
      const { container, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        ownAccounts: [
          { address: otherAccount, label: "Profile 2 · wallet-both.dusk" },
        ],
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: otherAccount },
      });

      expect(
        getAsHTMLElement(container, ".send__card-title")
      ).toHaveTextContent("Your Profile 2 · wallet-both.dusk");
      expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();
    });

    it("should say which account it sends from", async () => {
      const { container } = render(Send, {
        ...baseProps,
        ownAccounts: [
          { address: publicAddress, label: "Profile 1 · wallet-both.dusk" },
        ],
      });

      expect(getSummary(container)[0]).toStrictEqual([
        "From",
        `Profile 1 · wallet-both.dusk ${shortenAddress(publicAddress)}`,
      ]);
    });

    it("should send to a contact picked from the list", async () => {
      saveContact({ address: otherAccount, name: "Cold storage" });

      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.change(
        getByRole("combobox", { name: "Send to a contact" }),
        { target: { value: listContacts()[0].id } }
      );

      expect(fieldsOf(getByRole).to()).toHaveValue(otherAccount);
      expect(
        getAsHTMLElement(container, ".send__card-title")
      ).toHaveTextContent("Cold storage");
      expect(getSummary(container)[1]).toStrictEqual([
        "To",
        `Cold storage ${shortenAddress(otherAccount)}`,
      ]);
    });

    it("should say when a picked contact's .dusk name points elsewhere now, and send to the saved address", async () => {
      const tdi = saveContact({
        address: nameAccount,
        duskName: "tdi.dusk",
        name: "TDI",
      });

      baseProps.resolveName.mockResolvedValueOnce({
        account: otherAccount,
        name: "tdi.dusk",
      });

      const { findByRole, getByRole } = render(Send, baseProps);
      const picker = getByRole("combobox", { name: "Send to a contact" });

      expect(picker).toHaveTextContent("TDI · tdi.dusk");

      await fireEvent.change(picker, { target: { value: tdi.id } });

      expect(await findByRole("status")).toHaveTextContent(
        "tdi.dusk now points to a different address. You're sending to the address saved for TDI."
      );
      expect(baseProps.resolveName).toHaveBeenCalledWith("tdi.dusk");
      expect(getContact(tdi.id)?.movedTo).toBe(otherAccount);
      expect(fieldsOf(getByRole).to()).toHaveValue(nameAccount);
      expect(picker).toHaveTextContent(`TDI · ${shortenAddress(nameAccount)}`);
    });

    it("should note a contact's .dusk name still points to the address saved", async () => {
      const alice = saveContact({
        address: nameAccount,
        checkedAt: 1,
        duskName: "alice.dusk",
        name: "Alice",
      });

      baseProps.resolveName.mockResolvedValueOnce({
        account: nameAccount,
        name: "alice.dusk",
      });

      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      await waitFor(() =>
        expect(container.querySelector(".send__card-title")).toHaveTextContent(
          "Alice · alice.dusk"
        )
      );
      expect(getContact(alice.id)?.checkedAt).toBeGreaterThan(1);
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fieldsOf(getByRole).send()).toBeEnabled();
    });

    it("should take a .dusk name's contact of the kind of address picked, and ask when that one moved", async () => {
      // A name with a contact for each address, the shielded one moved since.
      saveContact({
        address: nameAccount,
        duskName: "alice.dusk",
        name: "Alice",
      });
      saveContact({
        address: shieldedAddress,
        duskName: "alice.dusk",
        name: "Alice (shielded)",
      });
      baseProps.resolveName.mockResolvedValue({
        account: nameAccount,
        address: otherShielded,
        name: "alice.dusk",
      });

      const { findByRole, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk" } });
      await fireEvent.click(
        await findByRole("radio", { name: "Shielded address" })
      );

      expect(await findByRole("alert")).toHaveTextContent(
        "alice.dusk now points to a different address from the one saved for Alice (shielded)."
      );

      await fireEvent.click(getByRole("button", { name: "The saved address" }));

      expect(fields.to()).toHaveValue(shieldedAddress);
    });

    it("should ask before it sends to a new address of a contact's .dusk name", async () => {
      const alice = saveContact({
        address: otherAccount,
        duskName: "alice.dusk",
        name: "Alice",
      });

      baseProps.resolveName.mockResolvedValue({
        account: nameAccount,
        name: "alice.dusk",
      });

      const { container, findByRole, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk" } });

      expect(await findByRole("alert")).toHaveTextContent(
        "alice.dusk now points to a different address from the one saved for Alice. Which do you want to send to?"
      );
      expect(fields.send()).toBeDisabled();
      expect(container.querySelector(".send__card")).toBeNull();

      await fireEvent.click(getByRole("button", { name: "The new address" }));

      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fields.send()).toBeEnabled();
      expect(
        getAsHTMLElement(container, ".send__card .full-address")
      ).toHaveTextContent(nameAccount);
      expect(getContact(alice.id)?.address).toBe(otherAccount);

      // Or the saved one, which the field then holds.
      cleanup();

      const again = render(Send, baseProps);

      await fireEvent.input(fieldsOf(again.getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(
        await again.findByRole("button", { name: "The saved address" })
      );

      expect(fieldsOf(again.getByRole).to()).toHaveValue(otherAccount);
      expect(
        getAsHTMLElement(again.container, ".send__card-title")
      ).toHaveTextContent("Alice");

      await fireEvent.input(fieldsOf(again.getByRole).amount(), {
        target: { value: "1" },
      });

      expect(fieldsOf(again.getByRole).send()).toBeEnabled();
    });
  });
});
