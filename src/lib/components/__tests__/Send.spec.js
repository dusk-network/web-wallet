import { settingsStore } from "$lib/stores";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import {
  duskToLux,
  formatDuskExact,
  formatDuskPlain,
} from "$lib/dusk/currency";
import { timeLabel } from "$lib/activity/present";
import { BALANCE_MASK } from "$lib/constants";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { shortenAddress } from "$lib/dusk/string";
import { afterConfirmDelay, getAsHTMLElement } from "$lib/dusk/test-helpers";
import { page } from "$app/stores";
import { addBasePath } from "$lib/navigation";
import { outcomeUnknown } from "$lib/transactions";
import { networks } from "@dusk-network/networks";
import {
  contactsWritten,
  getContact,
  listContacts,
  removeContact,
  saveContact,
} from "$lib/contacts";
import { walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { openTestContacts, stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, unlockWallets } from "$lib/wallets";

import { Send } from "..";

// Each wallet's profiles their own accounts, as on the network.
// The accounts here are made up, so none is a key: a test says when it matters.
vi.mock("@dusk-network/networks/account", async (importOriginal) => ({
  ...(await importOriginal()),
  isAccount: vi.fn(() => true),
}));

vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

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

/** What the scanner made last calls with a code it reads. */
const qr = vi.hoisted(() => ({
  /** @type {(result: { data: string }) => void} */
  read: () => {},
}));

vi.mock("qr-scanner", () => ({
  default: class {
    static hasCamera = hasCamera;

    /**
     * @param {HTMLVideoElement} _video
     * @param {(result: { data: string }) => void} onDecode
     */
    constructor(_video, onDecode) {
      qr.read = onDecode;
    }

    destroy() {}

    start() {}

    stop() {}
  },
}));

/** @param {string} data */
const scanned = (data) => qr.read({ data });

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

// The contacts open with a wallet, as when it unlocks.
beforeAll(() => openTestContacts());

// The page's history state, as the tests move it.
vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  return { page: writable({ state: {} }) };
});

const historyAt = (/** @type {{ sendReview?: boolean }} */ state) =>
  /** @type {import("svelte/store").Writable<any>} */ (
    /** @type {unknown} */ (page)
  ).set({ state });

// Another wallet's addresses here are made up: none of them is two keys.
const madeUpAddresses = vi.hoisted(() => new Set());

vi.mock("$lib/wallet/isShieldedAddress", async (importOriginal) => {
  const { default: isShieldedAddress } =
    /** @type {typeof import("$lib/wallet/isShieldedAddress")} */ (
      await importOriginal()
    );

  return {
    default: (/** @type {unknown} */ address) =>
      madeUpAddresses.has(address) || isShieldedAddress(address),
  };
});

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
    "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6";

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

  describe("A link asking for a payment", () => {
    const duskLink = `dusk:public-${otherAccount}@dusk:2?amount=0.15&memo=Factura+33`;
    const httpsLink = `https://apps.testnet.dusk.network/wallet/dashboard/send?to=${otherAccount}&amount=0.15&memo=Factura+33&network=testnet`;

    // Send takes a click half a second after it shows: on this clock.
    beforeEach(() => {
      setNodeNetwork(networks.testnet);
      vi.useFakeTimers({ toFake: ["performance"] });
    });

    afterEach(() => {
      setNodeNetwork(null);
      settingsStore.reset();
    });

    /**
     * What's in Send's three fields.
     *
     * @param {ReturnType<typeof fieldsOf>} fields
     */
    const filled = ({ amount, memo, to }) =>
      [to(), amount(), memo()].map(
        (field) => /** @type {HTMLInputElement} */ (field).value
      );

    /**
     * What's put in To at once, as a paste, and read.
     *
     * @param {ReturnType<typeof fieldsOf>} fields
     * @param {string} value
     */
    const paste = async ({ to }, value) => {
      await fireEvent.input(to(), { target: { value } });
      await tick();
      await tick();
    };

    /** @param {ReturnType<typeof fieldsOf>} fields */
    const sendIt = async ({ review, send }) => {
      await fireEvent.click(review());
      await afterConfirmDelay();
      await fireEvent.click(send());
    };

    it.each([
      ["a dusk: link", duskLink],
      ["an https link to the web wallet's Send", httpsLink],
    ])(
      "should fill in the recipient, the amount and the memo from %s pasted into To, for the review as if typed",
      async (_, link) => {
        const { getByRole, getByText } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(fields, link);

        expect(filled(fields)).toStrictEqual([
          otherAccount,
          "0.15",
          "Factura 33",
        ]);
        expect(getByText(/^Filled in from the link/)).toBeInTheDocument();

        await sendIt(fields);

        expect(baseProps.execute).toHaveBeenCalledWith(
          otherAccount,
          150_000_000n,
          "Factura 33",
          gasPrice,
          gasLimit
        );
      }
    );

    it("should read the amount in the language of the amount field", async () => {
      settingsStore.update((store) => ({ ...store, language: "es-ES" }));

      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, duskLink);

      expect(filled(fields)[1]).toBe("0,15");

      await sendIt(fields);

      expect(baseProps.execute).toHaveBeenCalledWith(
        otherAccount,
        150_000_000n,
        "Factura 33",
        gasPrice,
        gasLimit
      );
    });

    it("should say so plainly and fill in nothing for a link for another network, keeping what's typed", async () => {
      const { getByRole, getByText, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "2" } });
      await paste(
        fields,
        `dusk:public-${otherAccount}@dusk:1?amount=0.15&memo=Factura+33`
      );

      expect(
        getByText("This request is for Mainnet. You are on Testnet.")
      ).toBeInTheDocument();
      expect(filled(fields)).toStrictEqual(["", "2", ""]);
      expect(queryByText("Not a valid address.")).toBeNull();
      expect(fields.review()).toBeDisabled();

      // What's given next is on its own.
      await paste(fields, otherAccount);

      expect(
        queryByText("This request is for Mainnet. You are on Testnet.")
      ).toBeNull();
    });

    it.each([
      ["a dusk: link of no known form", "dusk:nothing-at-all"],
      [
        "a link to the web wallet's Send without a recipient",
        `https://apps.testnet.dusk.network/wallet/dashboard/send?amount=1`,
      ],
    ])("should say %s can't be read", async (_, value) => {
      const { getByRole, getByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, value);

      expect(getByText(/^That link can't be read/)).toBeInTheDocument();
      expect(filled(fields)).toStrictEqual(["", "", ""]);
    });

    it("should refuse a link's recipient as it refuses one typed", async () => {
      const { getByRole, getByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, `dusk:public-${invalidAddress}?amount=1`);

      expect(getByText("Not a valid address.")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();
    });

    it("should read a link typed out as it's finished, not at each key on the way", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const to = /** @type {HTMLInputElement} */ (fields.to());

      for (const value of ["d", "du", "dus", "dusk", "dusk:", "dusk:p"]) {
        await fireEvent.input(to, { target: { value } });
      }

      expect(to.value).toBe("dusk:p");
      expect(filled(fields).slice(1)).toStrictEqual(["", ""]);

      // The rest as keys, and leaving the field.
      to.value = duskLink;
      await fireEvent.input(to, { target: { value: duskLink.slice(0, 7) } });
      await fireEvent.input(to, { target: { value: duskLink.slice(0, 8) } });
      await fireEvent.input(to, { target: { value: duskLink } });
      await tick();
      await tick();

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.15",
        "Factura 33",
      ]);
    });

    it("should leave the amount and memo typed when a plain recipient is pasted", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "2" } });
      await fireEvent.input(fields.memo(), { target: { value: "rent" } });
      await paste(fields, otherAccount);

      expect(filled(fields)).toStrictEqual([otherAccount, "2", "rent"]);
    });

    it("should let a contact picked after a refused link be sent to, and say no more of that link or of one that filled it in", async () => {
      saveContact({ address: otherAccount, name: "Rent" });

      const { getByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const contacts = getByRole("combobox", { name: "Send to a contact" });

      await paste(fields, `dusk:public-${otherAccount}@dusk:1?amount=9`);
      await fireEvent.change(contacts, {
        target: { value: listContacts()[0].id },
      });
      await tick();

      expect(queryByText(/^This request is for/)).toBeNull();
      expect(filled(fields)[0]).toBe(otherAccount);

      await paste(fields, duskLink);

      expect(queryByText(/^Filled in from the link/)).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: publicAddress } });
      await tick();
      await tick();

      expect(queryByText(/^Filled in from the link/)).toBeNull();
    });

    it("should read a scanned code as it reads what's pasted: a link fills the form in, another network's says so", async () => {
      hasCamera.mockResolvedValueOnce(true);

      const { findByRole, getByRole, getByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const scan = await findByRole("button", { name: "Scan a QR code" });

      await fireEvent.click(scan);
      scanned(duskLink);
      await vi.waitFor(() =>
        expect(filled(fields)).toStrictEqual([
          otherAccount,
          "0.15",
          "Factura 33",
        ])
      );

      await fireEvent.click(scan);
      scanned(`dusk:public-${otherAccount}@dusk:1?amount=9`);
      await vi.waitFor(() =>
        expect(
          getByText("This request is for Mainnet. You are on Testnet.")
        ).toBeInTheDocument()
      );
      expect(filled(fields)[0]).toBe("");

      await fireEvent.click(scan);
      scanned(invalidAddress);
      await vi.waitFor(() =>
        expect(getByText("Not a valid address.")).toBeInTheDocument()
      );
    });

    it("should start with what a link opened the page with, or say why it fills in nothing, and say what's wrong with its recipient at once", () => {
      const opened = render(Send, {
        ...baseProps,
        initialAmount: "0.15",
        initialMemo: "Factura 33",
        initialRecipient: otherAccount,
      });

      expect(filled(fieldsOf(opened.getByRole))).toStrictEqual([
        otherAccount,
        "0.15",
        "Factura 33",
      ]);
      expect(opened.getByText(/^Filled in from the link/)).toBeInTheDocument();
      opened.unmount();

      const refused = render(Send, {
        ...baseProps,
        initialProblem: "This request is for Mainnet. You are on Testnet.",
      });

      expect(
        refused.getByText("This request is for Mainnet. You are on Testnet.")
      ).toBeInTheDocument();
      refused.unmount();

      const wrong = render(Send, {
        ...baseProps,
        initialRecipient: invalidAddress,
      });

      expect(wrong.getByText("Not a valid address.")).toBeInTheDocument();
    });
  });

  describe("Recipient", () => {
    it("should render the one-page Send form, with its summary", () => {
      const { getByRole } = render(Send, baseProps);

      expect(getByRole("link", { name: "Home" })).toHaveAttribute(
        "href",
        "/some-base-path/dashboard"
      );
    });

    it("should keep Send and Review disabled while the recipient is empty or isn't valid", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      expect(fields.to()).toHaveValue("");
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress },
      });

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
      expect(fields.review()).toBeDisabled();
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
      expect(fields.review()).toBeEnabled();
    });

    it("should point out an invalid address once it is pasted or left, not while it is typed", async () => {
      const { getByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      // A key at a time.
      for (const end of [1, 2, 3, 4, 5]) {
        await fireEvent.input(fields.to(), {
          target: { value: invalidAddress.slice(0, end) },
        });
      }

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

  describe("What the recipient field says", () => {
    it("names an EVM address, and turns nothing red without saying why", async () => {
      const { getByRole, getByText, queryByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();

      // Typed, it's on its way to being something.
      await fireEvent.input(to, { target: { value: "0" } });

      expect(to).not.toHaveClass("send__to-input--invalid");
      expect(queryByRole("alert")).toBeNull();

      // All of it at once, as a paste is, however the keyboard does it.
      await fireEvent.input(to, {
        target: { value: `0x${"ab".repeat(20)}` },
      });

      expect(getByText("That's an EVM address.")).toBeInTheDocument();
      expect(to).toHaveClass("send__to-input--invalid");

      await fireEvent.input(to, { target: { value: "not-an-address!" } });

      expect(getByText("Not a valid address.")).toBeInTheDocument();
      expect(to).toHaveClass("send__to-input--invalid");
    });

    it("offers contacts one way at a time: links for what's typed, or the list", async () => {
      const contact = saveContact({
        address: otherAccount,
        name: "Estudio Marta",
      });

      try {
        const { getByRole, queryByRole } = render(Send, baseProps);
        const to = fieldsOf(getByRole).to();

        expect(
          queryByRole("combobox", { name: "Send to a contact" })
        ).toBeInTheDocument();

        await fireEvent.input(to, { target: { value: "estu" } });

        expect(
          getByRole("button", { name: /^Your contact Estudio Marta/ })
        ).toBeInTheDocument();
        expect(
          queryByRole("combobox", { name: "Send to a contact" })
        ).toBeNull();
        expect(to).not.toHaveClass("send__to-input--invalid");
      } finally {
        removeContact(contact.id);
      }
    });

    it("calls a profile with a name by its name, and one without 'your' profile", async () => {
      const ownAccount = otherAccount;
      /** @param {string} label */
      const card = async (label) => {
        const { container } = render(Send, {
          ...baseProps,
          initialRecipient: ownAccount,
          ownAccounts: [{ address: ownAccount, label }],
        });
        const title = container.querySelector(".send__card-title");

        return title?.textContent?.trim();
      };

      expect(await card("Estudio Sofía, S.L.")).toBe("Estudio Sofía, S.L.");
      cleanup();
      expect(await card("Profile 2")).toBe("Your Profile 2");
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
      expect(fieldsOf(getByRole).review()).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Edit" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "40000000" },
      });
      await tick();
      await rerender({ gasSettings: { gasLimit: 60_000_000n, gasPrice: 1n } });

      expect(maxFee()).toBe("0.04");
    });

    it("should say nothing false of an amount filled in as the page opens, as from a link or a draft", async () => {
      const { getByRole, queryByRole } = render(Send, {
        ...baseProps,
        initialAmount: "0.03",
        initialRecipient: otherAccount,
      });

      await tick();

      expect(queryByRole("alert")).toBeNull();
      expect(fieldsOf(getByRole).review()).toBeEnabled();
    });

    it("should check an amount against the balance once it's read, and say nothing against a balance not read yet", async () => {
      const { getByRole, getByText, queryByRole, rerender } = render(Send, {
        ...baseProps,
        availableBalance: 0n,
        balanceKnown: false,
        initialAmount: "0.03",
        initialRecipient: otherAccount,
      });

      await tick();

      expect(queryByRole("alert")).toBeNull();

      await rerender({ availableBalance: 1_000_000_000n, balanceKnown: true });

      expect(queryByRole("alert")).toBeNull();
      expect(fieldsOf(getByRole).review()).toBeEnabled();

      await rerender({ availableBalance: 25_000_000n });

      expect(getByText("More than your 0.025 DUSK.")).toBeInTheDocument();
      expect(fieldsOf(getByRole).review()).toBeDisabled();

      await rerender({ availableBalance: 40_000_000n });

      expect(getByRole("alert")).toHaveTextContent(
        "That leaves too little for the network fee: send up to 0.02 DUSK."
      );
    });

    it("should keep Send disabled, and say why, while the balance can't pay the fee", async () => {
      const { getByRole, getByText } = render(Send, {
        ...baseProps,
        gasSettings: { gasLimit: 40000000n, gasPrice: 40000000n },
        initialRecipient: shieldedAddress,
      });

      await tick();

      expect(fieldsOf(getByRole).review()).toBeDisabled();
      expect(getByText("Not enough for the network fee.")).toBeInTheDocument();
    });

    it("should offer to lower the fee only where it can get low enough, then with its Edit in the form on a phone", async () => {
      const { container, getByRole, rerender } = render(Send, {
        ...baseProps,
        availableBalance: 10_000_000n - 1n,
      });
      const short = () => container.querySelector(".send--fee-short");

      await tick();

      expect(getByRole("alert")).toHaveTextContent(
        "Not enough for the network fee. Add DUSK."
      );
      expect(short()).toBeNull();

      await rerender({ availableBalance: 10_000_000n });

      expect(getByRole("alert")).toHaveTextContent(
        "Not enough for the network fee. Add DUSK, or lower the fee under Edit."
      );
      expect(short()).toBeInTheDocument();

      await rerender({ availableBalance: fee });

      expect(short()).toBeNull();
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
      expect(fields.review()).toBeEnabled();
      expect(queryByRole("alert")).toBeNull();

      await fireEvent.input(fields.amount(), { target: { value: "1,000.5" } });

      expect(amount()).toBe("1,000.5 DUSK");

      // A lone comma before three digits could mean 1 or 1000.
      await fireEvent.input(fields.amount(), { target: { value: "1,000" } });

      expect(getByRole("alert")).toHaveTextContent(
        "Is that 1000 or 1.000? Write the one you mean."
      );
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.amount(), {
        target: { value: "0,0000000001" },
      });

      expect(getByRole("alert")).toHaveTextContent(
        "DUSK has 9 decimals at most."
      );
    });

    it("should hide what Max fills in while balances are hidden, send it all the same, and show what's typed", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { container, getByRole } = render(Send, {
          ...baseProps,
          initialRecipient: shieldedAddress,
        });
        const fields = fieldsOf(getByRole);
        const max = baseProps.availableBalance - fee;
        const exact = formatDuskExact(max, "en");
        const shown = () => container.textContent;

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(fields.amount()).toHaveValue("••••");
        expect(shown()).not.toContain(exact);
        expect(shown()).not.toContain(
          formatDuskExact(baseProps.availableBalance, "en")
        );
        await fireEvent.click(fields.review());

        expect(fields.send()).toHaveAccessibleName("Send •••• DUSK");

        await afterConfirmDelay();
        await fireEvent.click(fields.send());

        expect(baseProps.execute).toHaveBeenCalledWith(
          shieldedAddress,
          max,
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
    });

    it("should fill in Max as this language writes decimals, so it's never taken for a thousands group", async () => {
      settingsStore.update((store) => ({ ...store, language: "nl-NL" }));

      try {
        const { getByRole, getByText } = render(Send, baseProps);

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          /** @type {HTMLInputElement} */ (fieldsOf(getByRole).amount()).value
        ).not.toContain(".");

        // Nor does what it asks for instead write them another way, and it
        // says why what can mean two amounts is refused.
        await fireEvent.input(fieldsOf(getByRole).amount(), {
          target: { value: "1.001" },
        });

        expect(
          getByText("Is that 1001 or 1,001? Write the one you mean.")
        ).toBeTruthy();

        await fireEvent.input(fieldsOf(getByRole).amount(), {
          target: { value: "ten" },
        });

        expect(getByText("Enter an amount such as 10 or 10,5.")).toBeTruthy();
      } finally {
        settingsStore.update((store) => ({ ...store, language: "en" }));
      }
    });

    it("should read a language's own groups, as the page writes them, and say more than your balance rather than talk of gas", async () => {
      settingsStore.update((store) => ({ ...store, language: "fr-FR" }));

      try {
        const { container, getByRole, getByText, queryByText, rerender } =
          render(Send, {
            ...baseProps,
            availableBalance: 2_000_000_000_000n,
            initialRecipient: shieldedAddress,
          });
        const fields = fieldsOf(getByRole);

        for (const typed of ["1 000", "1\u00a0000", "1\u202f000"]) {
          await fireEvent.input(fields.amount(), { target: { value: typed } });

          expect(
            getSummary(container).find(([label]) => label === "Amount")?.[1]
          ).toMatch(/^1\s000 DUSK$/);
          expect(fields.review()).toBeEnabled();
        }

        // With no coins, the amount is the trouble: no gas limit to lower.
        await rerender({ availableBalance: 0n, shieldedBalance: 0n });

        expect(queryByText(/network fee/)).toBeNull();

        await fireEvent.input(fields.amount(), { target: { value: "0,5" } });

        expect(getByText("More than your 0 DUSK.")).toBeTruthy();
        expect(queryByText(/gas limit/)).toBeNull();
      } finally {
        settingsStore.update((store) => ({ ...store, language: "en" }));
      }
    });

    it("should show an amount typed over what Max filled in, with balances hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { getByRole } = render(Send, {
          ...baseProps,
          initialRecipient: shieldedAddress,
        });
        const fields = fieldsOf(getByRole);

        await fireEvent.click(getByRole("button", { name: "Max" }));
        await fireEvent.input(fields.amount(), { target: { value: "1" } });

        expect(fields.amount()).toHaveValue("1");

        await fireEvent.click(fields.review());

        expect(fields.send()).toHaveAccessibleName("Send 1 DUSK");

        await fireEvent.click(getByRole("button", { name: "Back" }));

        // Deleting the dots clears it, on a keyboard that only says so by
        // changing the field.
        await fireEvent.click(getByRole("button", { name: "Max" }));
        await fireEvent.input(fields.amount(), { target: { value: "•••" } });

        expect(fields.amount()).toHaveValue("");
        expect(fields.review()).toBeDisabled();
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
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
      expect(fields.review()).toBeEnabled();
    });

    it("should never show a Total at Max that reads more than the balance", async () => {
      const availableBalance = 173_901_884_001n;
      const { container, getByRole } = render(Send, {
        ...baseProps,
        availableBalance,
        initialRecipient: shieldedAddress,
      });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // Not "Up to 173.901884001 DUSK" beside "Available 173.9018 DUSK":
      // the balance as it shows there, rounded down.
      expect(container.querySelector(".send__hint")).toHaveTextContent(
        /^Available 173\.9018 DUSK/
      );
      expect(getSummary(container).at(-1)).toStrictEqual([
        "Total",
        "Up to 173.9018 DUSK",
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
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.amount(), { target: { value: "1" } });

      expect(fields.review()).toBeEnabled();

      await fireEvent.input(fields.amount(), { target: { value: "0" } });

      expect(fields.review()).toBeDisabled();
      expect(getByText("Enter an amount greater than 0.")).toBeInTheDocument();

      // Below one LUX: kept as typed, and refused.
      await fireEvent.input(fields.amount(), {
        target: { value: "0.0000000001" },
      });

      expect(fields.amount()).toHaveValue("0.0000000001");
      expect(fields.review()).toBeDisabled();
      expect(getByText("DUSK has 9 decimals at most.")).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "1e2" } });

      expect(
        getByText("Enter an amount such as 10 or 10.5.")
      ).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "100000" } });

      expect(fields.review()).toBeDisabled();
      expect(
        getByText(
          `More than your ${formatDuskExact(baseProps.availableBalance, "en")} DUSK.`
        )
      ).toBeInTheDocument();
    });

    describe("with something elsewhere only the public balance can pay to get at", () => {
      const keepForLater = { lux: 50_000_000n, why: "to unstake later" };
      /** The most this form's fee can be. */
      const fee =
        baseProps.gasSettings.gasLimit * baseProps.gasSettings.gasPrice;
      const allOfIt = baseProps.availableBalance - fee;

      /** @param {string} value */
      const decimal = (value) => value.replace(",", ".");

      it("keeps the fee for it on Max, and says so", async () => {
        const { getByRole, getByText } = render(Send, {
          ...baseProps,
          keepForLater,
        });
        const fields = fieldsOf(getByRole);

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          decimal(/** @type {HTMLInputElement} */ (fields.amount()).value)
        ).toBe(formatDuskPlain(allOfIt - keepForLater.lux));
        expect(
          getByText("Max keeps 0.05 DUSK to unstake later.")
        ).toBeInTheDocument();
      });

      it("lets an amount over that go, and says what it leaves too little for", async () => {
        const { getByRole, getByText, queryByText } = render(Send, {
          ...baseProps,
          initialRecipient: otherAccount,
          keepForLater,
        });
        const fields = fieldsOf(getByRole);

        await fireEvent.input(fields.amount(), {
          target: { value: formatDuskPlain(allOfIt - keepForLater.lux) },
        });

        expect(queryByText(/leaves too little to unstake/)).toBeNull();

        await fireEvent.input(fields.amount(), {
          target: { value: formatDuskPlain(allOfIt) },
        });

        expect(
          getByText("That leaves too little to unstake later.")
        ).toBeInTheDocument();
        expect(fields.review()).toBeEnabled();
      });

      it("empties it on Max where there's nothing for it to keep otherwise, and warns", async () => {
        const { getByRole, getByText } = render(Send, {
          ...baseProps,
          keepForLater: { ...keepForLater, lux: allOfIt },
        });

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          decimal(
            /** @type {HTMLInputElement} */ (fieldsOf(getByRole).amount()).value
          )
        ).toBe(formatDuskPlain(allOfIt));
        expect(
          getByText("That leaves too little to unstake later.")
        ).toBeInTheDocument();
      });

      it("keeps nothing of a shielded send: the public balance isn't touched", async () => {
        const { getByRole, queryByText } = render(Send, {
          ...baseProps,
          initialRecipient: otherShielded,
          keepForLater,
        });

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(queryByText(/Max keeps/)).toBeNull();
        expect(queryByText(/too little to unstake/)).toBeNull();
      });

      it("hides the figure with the balances", async () => {
        settingsStore.update((store) => ({ ...store, hideBalances: true }));

        try {
          const { getByRole, getByText } = render(Send, {
            ...baseProps,
            keepForLater,
          });

          await fireEvent.click(getByRole("button", { name: "Max" }));

          expect(
            getByText("Max keeps the fee to unstake later.")
          ).toBeInTheDocument();
        } finally {
          settingsStore.update((store) => ({ ...store, hideBalances: false }));
        }
      });
    });

    it("should say in characters how much of a memo has to go, and how much room is left near the limit", async () => {
      const { findByText, getByRole, queryByText } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);
      const memo = (/** @type {string} */ value) =>
        fireEvent.input(fields.memo(), { target: { value } });

      await memo("x".repeat(400));

      expect(queryByText(/more character/)).toBeNull();

      await memo("x".repeat(500));

      expect(await findByText(/Room for 12 more characters\./)).toBeTruthy();

      await memo("x".repeat(511));

      expect(await findByText(/Room for 1 more character\./)).toBeTruthy();

      await memo("x".repeat(515));

      expect(await findByText(/Take out 3 characters\./)).toBeTruthy();

      // What goes is characters, however many bytes each takes: 171 of these
      // are 513 bytes, and one less fits.
      await memo("€".repeat(171));

      expect(await findByText(/Take out 1 character\./)).toBeTruthy();
      expect(queryByText(/bytes/)).toBeNull();
    });

    it("should show a memo's hidden characters as codes on its review, and send it as it was typed", async () => {
      const { container, getByRole, getByText } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await fireEvent.input(fields.memo(), {
        target: { value: "pay \u202E0001\u202C" },
      });

      expect(container.querySelector(".send__summary-memo")).toHaveTextContent(
        "pay \\u202e0001\\u202c"
      );
      expect(
        getByText("It has hidden characters, shown here as codes.")
      ).toBeTruthy();
    });

    it("should say when a memo is over the network's limit, counting bytes, and keep Send off", async () => {
      const { findByText, getByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: otherAccount } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });

      await fireEvent.input(fields.memo(), {
        target: { value: "x".repeat(513) },
      });
      expect(await findByText("That memo is too long.")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "€".repeat(171) },
      });
      expect(await findByText("That memo is too long.")).toBeInTheDocument();

      await fireEvent.input(fields.memo(), {
        target: { value: "x".repeat(512) },
      });
      expect(queryByText("That memo is too long.")).not.toBeInTheDocument();
      expect(fields.review()).toBeEnabled();
    });

    it("should keep the balance out of what it says about the amount while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { container, findByText, getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await fireEvent.input(fields.to(), { target: { value: otherAccount } });
        await fireEvent.input(fields.amount(), {
          target: { value: "99999999" },
        });

        expect(await findByText("More than you have.")).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/More than your/);
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
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
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "invalid-evm" },
      });

      expect(queryByText("Not an EVM address.")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "0x9876543210987654321098765432109876543210" },
      });

      expect(queryByText("Not an EVM address.")).not.toBeInTheDocument();
      expect(fields.review()).toBeEnabled();
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
      expect(fields.review()).toBeEnabled();
    });
  });

  describe("What the profile sent", () => {
    /**
     * A transfer in the profile's history, as the history gives it.
     *
     * @param {Partial<ActivityRow>} fields
     * @returns {ActivityRow}
     */
    const sentRow = (fields) =>
      /** @type {ActivityRow} */ (
        /** @type {unknown} */ ({
          counterparty: otherAccount,
          direction: "out",
          hash: lastTxId,
          kind: "transfer",
          memo: null,
          source: "sent",
          status: "pending",
          time: Date.now() - 20_000,
          toName: null,
          value: 1_900_000n,
          ...fields,
        })
      );

    it("should say what's on its way from this profile, as after a reload while it went", () => {
      const { getByRole } = render(Send, {
        ...baseProps,
        historyRows: [sentRow({})],
      });

      expect(getByRole("status")).toHaveTextContent(
        `Your 0.0019 DUSK to ${shortenAddress(otherAccount)} is on its way.`
      );
      expect(getByRole("link", { name: "See in History" })).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${lastTxId}`
      );
    });

    it("should say what's on its way, with no amount while the balances are hidden", () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { getByRole } = render(Send, {
          ...baseProps,
          historyRows: [sentRow({})],
        });

        expect(getByRole("status")).toHaveTextContent(
          `Your ${BALANCE_MASK} DUSK to ${shortenAddress(otherAccount)} is on its way.`
        );
      } finally {
        settingsStore.reset();
      }
    });

    it("should warn of the same payment made moments ago, or with the same memo before, and let it go all the same", async () => {
      const sent = Date.now() - 20_000;
      const { getByRole } = render(Send, {
        ...baseProps,
        historyRows: [sentRow({ status: "executed", time: sent })],
        initialAmount: "0.0019",
        initialRecipient: otherAccount,
      });

      expect(getByRole("alert")).toHaveTextContent(
        `You sent 0.0019 DUSK to ${shortenAddress(otherAccount)} at ${timeLabel(sent, "en")}.`
      );

      // It can be meant: it goes.
      await fireEvent.click(fieldsOf(getByRole).review());
      await afterConfirmDelay();
      await fireEvent.click(fieldsOf(getByRole).send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
      cleanup();

      // Another amount, or the same long ago without a memo, is no repeat.
      const other = render(Send, {
        ...baseProps,
        historyRows: [
          sentRow({ status: "executed", time: Date.now() - 11 * 60_000 }),
          sentRow({ status: "failed", value: 3_000_000n }),
        ],
        initialAmount: "0.0019",
        initialRecipient: otherAccount,
      });

      expect(other.queryByRole("alert")).toBeNull();

      await fireEvent.input(fieldsOf(other.getByRole).amount(), {
        target: { value: "0.003" },
      });

      expect(other.queryByRole("alert")).toBeNull();
      cleanup();

      // The same memo, as a request paid once already, is one whenever.
      const paid = Date.UTC(2026, 9, 29, 9, 30);
      const request = render(Send, {
        ...baseProps,
        historyRows: [
          sentRow({ memo: "Factura 044", status: "executed", time: paid }),
        ],
        initialAmount: "0.0019",
        initialMemo: "Factura 044",
        initialRecipient: otherAccount,
      });

      expect(request.getByRole("alert")).toHaveTextContent(
        `You sent 0.0019 DUSK to ${shortenAddress(otherAccount)} with this memo on Thu 29 Oct at ${timeLabel(paid, "en")}.`
      );
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
      expect(container.querySelector(".send__visible")).toBeNull();

      // Sending, and what it means, are for the review.
      await fireEvent.click(fields.review());

      expect(fields.send()).toHaveTextContent("Send 2,345.5 DUSK");
      expect(getByText("Sends can't be undone.")).toBeInTheDocument();
    });

    it("should say what a public transfer shows everyone, where it's sent from, and on the review", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const visible = () =>
        container.querySelector(".send__summary .send__visible");

      // Nothing to send yet: nothing said.
      expect(visible()).toBeNull();

      await fireEvent.input(fields.to(), { target: { value: otherAccount } });
      await fireEvent.input(fields.amount(), { target: { value: "0.1" } });

      expect(visible()).toHaveTextContent(
        "Visible to everyone: the amount and both accounts."
      );

      await fireEvent.input(fields.memo(), {
        target: { value: "Invoice 118" },
      });

      expect(visible()).toHaveTextContent(
        "Visible to everyone: the amount, both accounts and the memo."
      );

      // The review it's sent from is the summary, the line in it.
      await fireEvent.click(fields.review());

      expect(container.querySelector(".send--review")).not.toBeNull();
      expect(visible()).toHaveTextContent(/^Visible to everyone/);
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
     * Fills the form in, reviews it and sends.
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

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();
    };

    it("should send nothing on the first press, only from the review, and say it was sent with a link to the explorer", async () => {
      const { container, getByRole, getByText, queryByRole } = render(
        Send,
        baseProps
      );
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await afterConfirmDelay();

      // One button beside the form, and it doesn't send.
      expect(queryByRole("button", { name: /^Send/ })).toBeNull();

      await fireEvent.click(fields.review());

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(container.querySelector(".send")).toHaveClass("send--review");
      expect(queryByRole("button", { name: "Review" })).toBeNull();
      expect(getByRole("heading", { name: /Review/ })).toHaveFocus();

      await afterConfirmDelay();
      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();

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
        `Sending… 567 DUSK to ${shortenAddress(shieldedAddress)} This usually takes under a minute.`
      );
      expect(getByRole("link", { name: "See in History" })).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${lastTxId}`
      );
      expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
      expect(followTransaction).toHaveBeenCalledWith(
        lastTxId,
        expect.anything()
      );
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should review a transfer before it sends it, and go back to the form", async () => {
      const { container, getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await fireEvent.click(fields.review());

      expect(container.querySelector(".send")).toHaveClass("send--review");
      expect(queryByRole("button", { name: "Review" })).toBeNull();
      // The address in full, on the last it shows before it goes.
      expect(container.querySelector(".send__summary")).toHaveTextContent(
        shieldedAddress
      );

      await fireEvent.click(getByRole("button", { name: "Back" }));

      expect(container.querySelector(".send")).not.toHaveClass("send--review");

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
    });

    it("should follow the browser's Back and Forward between the filled form and its review", async () => {
      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const isReview = () =>
        container.querySelector(".send")?.classList.contains("send--review");

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await fireEvent.click(fields.review());

      expect(isReview()).toBe(true);

      // The history at the form again, as Back leaves it.
      historyAt({});
      await tick();

      expect(isReview()).toBe(false);
      expect(fields.to()).toHaveValue(shieldedAddress);
      expect(fields.amount()).toHaveValue("1");

      // And at the review, as Forward does.
      historyAt({ sendReview: true });
      await tick();

      expect(isReview()).toBe(true);

      historyAt({});
    });

    it("should stay on the form when the history is at a review of a form it no longer has", async () => {
      historyAt({ sendReview: true });

      const { container } = render(Send, baseProps);

      expect(container.querySelector(".send")).not.toHaveClass("send--review");

      historyAt({});
    });

    it("should take no click on Send for half a second once the review shows, so a double click on Review can't send", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: shieldedAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await afterConfirmDelay();

      // Review's second tap lands where Send now is, and so does Enter.
      await fireEvent.click(fields.review());
      await fireEvent.click(fields.send());
      await fireEvent.click(fields.send(), { detail: 0 });
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
      await fireEvent.click(fields.send());

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(fields.send()).toBeEnabled();

      await vi.advanceTimersByTimeAsync(1);
      await fireEvent.click(fields.send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
    });

    it("should follow the transaction until its block is final, then say when it was sent, with the fee it was charged", async () => {
      /** @type {PromiseWithResolvers<any>} */
      const following = Promise.withResolvers();

      followTransaction.mockReturnValue(following.promise);

      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(getByRole("status")).toHaveTextContent(
        /^Sending… 567 DUSK to .+ This usually takes under a minute\.$/
      );
      expect(getByText("Network fee (at most)")).toBeInTheDocument();
      expect(getByText("0.02 DUSK")).toBeInTheDocument();

      const blockTime = Date.UTC(2026, 9, 28, 0, 34);

      following.resolve({
        blockHeight: 4_687_200n,
        error: null,
        fee: 1_854_795n,
        timestamp: blockTime,
      });
      await vi.advanceTimersToNextTimerAsync();

      // Sent, at its block's time.
      expect(getByRole("status")).toHaveTextContent(
        `Sent at ${timeLabel(blockTime, "en")} 567 DUSK to ${shortenAddress(shieldedAddress)} In block 4,687,200.`
      );
      // The fee charged, to the last digit.
      expect(getByText("0.001854795 DUSK")).toBeInTheDocument();
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
      expect(getByText("Sending…")).toBeInTheDocument();
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

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
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

    describe("once it failed", () => {
      const filled = { memo: "Invoice 118", to: otherAccount, value: 2 };

      /** Back in the browser, from the screen the failure shows on. */
      const pressBack = async () => {
        historyAt({});
        await tick();
      };

      /** @param {HTMLElement} container */
      const expectReview = (container) => {
        expect(container.querySelector(".send")).toHaveClass("send--review");
        expect(container.querySelector(".send__summary")).toHaveTextContent(
          otherAccount
        );
        expect(getSummary(container)).toContainEqual(["Amount", "2 DUSK"]);
        expect(getSummary(container)).toContainEqual(["Memo", "Invoice 118"]);
      };

      afterEach(() => {
        historyAt({});
      });

      it("should go back to the review with Try again, the address, the amount and the memo kept, when nothing went out", async () => {
        baseProps.execute.mockRejectedValueOnce(
          new TypeError("Failed to fetch")
        );

        const { container, getByRole, queryByText } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await sendWith(getByRole, filled);

        expect(baseProps.execute).toHaveBeenCalledOnce();
        expect(getByRole("link", { name: "Home" })).toBeInTheDocument();

        await fireEvent.click(getByRole("button", { name: "Try again" }));

        expect(queryByText("Transaction failed")).toBeNull();
        expectReview(container);
        expect(fields.to()).toHaveValue(otherAccount);
        expect(fields.amount()).toHaveValue("2");
        expect(fields.memo()).toHaveValue("Invoice 118");
        expect(getByRole("heading", { name: /Review/ })).toHaveFocus();

        // Nothing goes until it's pressed again.
        expect(baseProps.execute).toHaveBeenCalledOnce();

        await afterConfirmDelay();
        await fireEvent.click(fields.send());
        await vi.advanceTimersToNextTimerAsync();

        expect(baseProps.execute).toHaveBeenCalledTimes(2);
        expect(baseProps.execute).toHaveBeenLastCalledWith(
          otherAccount,
          duskToLux(2),
          "Invoice 118",
          gasPrice,
          gasLimit
        );
        expect(getByRole("status")).toHaveTextContent(/^Sending… 2 DUSK/);
      });

      it("should go back to the form with Back in the browser, as typed, when nothing went out", async () => {
        baseProps.execute.mockRejectedValueOnce(
          new TypeError("Failed to fetch")
        );
        historyAt({ sendReview: true });

        const { container, getByRole, getByText } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await sendWith(getByRole, filled);

        expect(getByText("Transaction failed")).toBeInTheDocument();

        await pressBack();

        expect(container.querySelector(".send")).not.toHaveClass(
          "send--review"
        );
        expect(fields.to()).toHaveValue(otherAccount);
        expect(fields.amount()).toHaveValue("2");
        expect(fields.memo()).toHaveValue("Invoice 118");
        expect(baseProps.execute).toHaveBeenCalledOnce();
      });

      it("should offer no Try again, and no way back to the form, when it may have gone out", async () => {
        baseProps.execute.mockRejectedValueOnce(
          outcomeUnknown(new TypeError("Failed to fetch"))
        );

        const { container, getByRole, getByText, queryByRole } = render(
          Send,
          baseProps
        );

        await sendWith(getByRole, filled);

        expect(getByText("Not confirmed")).toBeInTheDocument();
        expect(
          getByText(
            "It may have reached the network. Check History before you send it again."
          )
        ).toBeInTheDocument();
        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(getByRole("link", { name: "Open History" })).toBeInTheDocument();

        await pressBack();

        expect(container.querySelector(".send")).toBeNull();
        expect(baseProps.execute).toHaveBeenCalledOnce();
      });

      it("should stay on what it says once it was sent, whatever Back does", async () => {
        const { container, getByRole } = render(Send, baseProps);

        await sendWith(getByRole, filled);
        await pressBack();

        expect(container.querySelector(".send")).toBeNull();
        expect(getByRole("status")).toHaveTextContent(/^Sending… 2 DUSK/);
      });
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
      "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6";

    // The least a balance must hold to pay for a transfer is one Lux more.
    const maxGasFee = fee;

    /** @param {string} name */
    const withBothAddresses = (name) => ({
      account: nameAccount,
      address: nameAddress,
      name,
    });

    /**
     * Reviews what the form holds, and sends it.
     *
     * @param {(role: string, options: object) => HTMLElement} getByRole
     */
    const sendIt = async (getByRole) => {
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: amount } });
      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());
    };

    // Send takes a click half a second after it shows: on this clock.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["performance"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should drop the recipient at once when another name replaces a resolved one, and send only to the new one", async () => {
      /** @type {(answer: object) => void} */
      let answerNewName = () => {};

      baseProps.resolveName.mockImplementation((input) =>
        input === "first.dusk"
          ? Promise.resolve({ account: nameAccount, name: input })
          : new Promise((resolve) => {
              answerNewName = resolve;
            })
      );

      const { container, findByText, getByRole, queryByText } = render(
        Send,
        baseProps
      );
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await findByText("first.dusk points to a public account");
      expect(fields.review()).toBeEnabled();

      // While the new name is looked up, nothing can go to the old address,
      // and nothing says the new name points to it.
      await fireEvent.input(fields.to(), { target: { value: "second.dusk" } });
      expect(fields.review()).toBeDisabled();
      expect(
        queryByText("second.dusk points to a public account")
      ).not.toBeInTheDocument();
      expect(container.textContent).not.toContain(nameAccount);
      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      await fireEvent.click(fields.review());
      expect(container.querySelector(".send")).not.toHaveClass("send--review");
      expect(baseProps.execute).not.toHaveBeenCalled();

      answerNewName({ account: otherAccount, name: "second.dusk" });
      await findByText("second.dusk points to a public account");
      expect(fields.review()).toBeEnabled();
      expect(getSummary(container)[1][1]).toContain(
        shortenAddress(otherAccount)
      );
    });

    it("should look a name up afresh when it's entered again, and keep Send off until the answer comes", async () => {
      /** @type {((answer: object) => void)[]} */
      const answers = [];

      baseProps.resolveName.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve))
      );

      const { container, findByText, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      answers[0]({ account: nameAccount, name: "first.dusk" });
      await findByText("first.dusk points to a public account");
      expect(fields.review()).toBeEnabled();

      // Cleared and entered again: the old answer doesn't come back.
      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      expect(fields.review()).toBeDisabled();
      expect(container.textContent).not.toContain(shortenAddress(nameAccount));

      // Moved meanwhile: the new answer is the one that counts.
      answers[1]({ account: otherAccount, name: "first.dusk" });
      await findByText("first.dusk points to a public account");
      expect(fields.review()).toBeEnabled();
      expect(getSummary(container)[1][1]).toContain(
        shortenAddress(otherAccount)
      );
    });

    it("should leave out an older answer for the same name when it comes after a newer one", async () => {
      /** @type {((answer: object) => void)[]} */
      const answers = [];

      baseProps.resolveName.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve))
      );

      const { container, findByText, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });

      answers[1]({ account: otherAccount, name: "first.dusk" });
      await findByText("first.dusk points to a public account");

      answers[0]({ account: nameAccount, name: "first.dusk" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      expect(getSummary(container)[1][1]).toContain(
        shortenAddress(otherAccount)
      );
    });

    it("should leave out a late answer for a name that has been replaced", async () => {
      /** @type {(answer: object) => void} */
      let answerFirst = () => {};

      baseProps.resolveName.mockImplementation((input) =>
        input === "first.dusk"
          ? new Promise((resolve) => {
              answerFirst = resolve;
            })
          : Promise.resolve({ account: otherAccount, name: input })
      );

      const { container, findByText, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "second.dusk" } });
      await findByText("second.dusk points to a public account");

      answerFirst({ account: nameAccount, name: "first.dusk" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      expect(getSummary(container)[1][1]).toContain(
        shortenAddress(otherAccount)
      );
    });

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
      expect(fieldsOf(getByRole).review()).toBeDisabled();

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
      expect(fieldsOf(getByRole).review()).toBeDisabled();
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
      expect(fieldsOf(getByRole).review()).toBeEnabled();
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
      expect(fieldsOf(getByRole).review()).toBeEnabled();

      await rerender({ shieldedBalance: maxGasFee });

      expect(shieldedOption).toBeChecked();
      expect(shieldedOption).toHaveAttribute("aria-disabled", "true");
      expect(getAllByText(/Not enough shielded DUSK/).length).toBeGreaterThan(
        0
      );
      expect(fieldsOf(getByRole).review()).toBeDisabled();

      await fireEvent.click(getByRole("radio", { name: "Public account" }));

      expect(shieldedOption).not.toBeChecked();
      expect(fieldsOf(getByRole).review()).toBeEnabled();
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
        expect(fieldsOf(getByRole).review()).toBeDisabled();
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
      expect(fieldsOf(getByRole).review()).toBeEnabled();
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
      expect(fields.review()).toBeDisabled();
    });

    it("should block a name that resolves to a blocked address", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        account: networks.mainnet.display.blocklist[0].account,
        name: "alice.dusk",
      });

      const { findByText, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      expect(await findByText("Blocked recipient address")).toBeInTheDocument();
      expect(fieldsOf(getByRole).review()).toBeDisabled();
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

    it("should offer the .dusk name of a name typed without it, or with a dot after it, and look it up once taken", async () => {
      baseProps.resolveName.mockImplementation(async (input) => ({
        account: otherAccount,
        name: input,
      }));

      const { findByText, getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice" } });
      await fireEvent.blur(fields.to());

      // Nothing looked up for an offer.
      expect(baseProps.resolveName).not.toHaveBeenCalled();

      await fireEvent.click(
        getByRole("button", { name: "Did you mean alice.dusk?" })
      );

      expect(fields.to()).toHaveValue("alice.dusk");
      expect(
        await findByText("alice.dusk points to a public account")
      ).toBeInTheDocument();
      expect(baseProps.resolveName).toHaveBeenCalledWith("alice.dusk");

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk." } });
      await fireEvent.blur(fields.to());

      expect(
        getByRole("button", { name: "Did you mean alice.dusk?" })
      ).toBeInTheDocument();

      // Part of an address gets no offer.
      await fireEvent.input(fields.to(), {
        target: { value: invalidAddress.slice(0, 20) },
      });
      await fireEvent.blur(fields.to());

      expect(queryByRole("button", { name: /^Did you mean/ })).toBeNull();
    });

    it("should offer the .dusk name as a name without it is typed, without calling it a wrong address", async () => {
      const { getByRole, queryByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      // Typed, still in the field: no blur, no Enter.
      await fireEvent.input(fields.to(), { target: { value: "alice" } });

      expect(
        getByRole("button", { name: "Did you mean alice.dusk?" })
      ).toBeInTheDocument();
      expect(fields.to()).not.toHaveClass("send__to-input--invalid");
      expect(fields.to()).not.toHaveAttribute("aria-invalid", "true");

      // Nor once it's left.
      await fireEvent.blur(fields.to());

      expect(queryByText("Not a valid address.")).toBeNull();
      expect(
        getByRole("button", { name: "Did you mean alice.dusk?" })
      ).toBeInTheDocument();

      // Anything else that isn't an address still is a wrong one.
      await fireEvent.input(fields.to(), { target: { value: "alice_shop" } });

      expect(queryByRole("button", { name: /^Did you mean/ })).toBeNull();
      expect(queryByText("Not a valid address.")).toBeInTheDocument();
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

      expect(
        getByText("Saved only in this wallet, on this device.")
      ).toBeInTheDocument();

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

    it("should note nothing when the network has no names to check a picked contact's against", async () => {
      const tdi = saveContact({
        address: nameAccount,
        duskName: "tdi.dusk",
        name: "TDI",
      });

      baseProps.resolveName.mockResolvedValueOnce({
        error: "unsupported-network",
        name: "tdi.dusk",
      });

      const { getByRole, queryByRole } = render(Send, baseProps);

      await fireEvent.change(
        getByRole("combobox", { name: "Send to a contact" }),
        { target: { value: tdi.id } }
      );
      await waitFor(() =>
        expect(baseProps.resolveName).toHaveBeenCalledWith("tdi.dusk")
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getContact(tdi.id)).not.toHaveProperty("movedTo");
      expect(queryByRole("status")).toBeNull();
    });

    it("should close the contact form when the recipient becomes one of the wallet's own accounts", async () => {
      const { getByRole, queryByRole } = render(Send, {
        ...baseProps,
        ownAccounts: [{ address: otherAccount, label: "Profile 2" }],
      });
      const to = fieldsOf(getByRole).to();

      await fireEvent.input(to, { target: { value: nameAccount } });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "Mine" },
      });
      await fireEvent.input(to, { target: { value: otherAccount } });

      expect(queryByRole("textbox", { name: "Contact name" })).toBeNull();
      expect(listContacts()).toStrictEqual([]);
    });

    it("should drop a contact's name half typed when the recipient changes", async () => {
      const { findByRole, getByRole, queryByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();

      await fireEvent.input(to, { target: { value: nameAccount } });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "Mum" },
      });
      await fireEvent.input(to, { target: { value: otherAccount } });

      expect(queryByRole("textbox", { name: "Contact name" })).toBeNull();

      await fireEvent.click(
        await findByRole("button", { name: "Save to contacts" })
      );

      expect(getByRole("textbox", { name: "Contact name" })).toHaveValue("");
    });

    it("should refuse a contact's name that passes for a .dusk name the recipient isn't", async () => {
      const { getByRole, getByText } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: otherAccount },
      });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "alice.dusk" },
      });

      expect(getByText(/looks like a \.dusk name/)).toBeInTheDocument();
      expect(getByRole("button", { name: "Save" })).toBeDisabled();
      expect(listContacts()).toStrictEqual([]);
    });

    it("should offer a contact by name before a .dusk name, which would be somebody else's", async () => {
      saveContact({ address: otherAccount, name: "Alice" });
      saveContact({ address: otherAccount, name: "Jan (flour)" });

      const { getByRole, queryByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      /** @param {string} name */
      const offer = (name) =>
        `Your contact ${name} · ${shortenAddress(otherAccount)}`;

      await fireEvent.input(fields.to(), { target: { value: "alice" } });
      await fireEvent.blur(fields.to());

      expect(getByRole("button", { name: offer("Alice") })).toBeInTheDocument();
      expect(
        queryByRole("button", { name: "Did you mean alice.dusk?" })
      ).not.toBeInTheDocument();
      expect(queryByText("Not a valid address.")).not.toBeInTheDocument();

      // The field takes out spaces, and a word further in counts too.
      await fireEvent.input(fields.to(), { target: { value: "Jan (flour)" } });
      expect(
        getByRole("button", { name: offer("Jan (flour)") })
      ).toBeInTheDocument();
      await fireEvent.input(fields.to(), { target: { value: "flour" } });
      expect(
        getByRole("button", { name: offer("Jan (flour)") })
      ).toBeInTheDocument();

      // With no contact by that name, the guess is still offered.
      await fireEvent.input(fields.to(), { target: { value: "bob" } });
      expect(
        getByRole("button", { name: "Did you mean bob.dusk?" })
      ).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: "alice" } });
      await fireEvent.click(getByRole("button", { name: offer("Alice") }));
      expect(fields.to()).toHaveValue(otherAccount);
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
      expect(fieldsOf(getByRole).review()).toBeEnabled();
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

    it("should take a shielded contact's .dusk name as moved only once its lookup says where it points", async () => {
      const alice = saveContact({
        address: otherShielded,
        checkedAt: 1,
        duskName: "alice.dusk",
        name: "Alice",
      });

      /** @type {(value: DuskNameResolution) => void} */
      let finishLookup = () => {};

      baseProps.resolveName.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLookup = resolve;
        })
      );

      const { container, getByRole, getByText, queryByRole } = render(
        Send,
        baseProps
      );

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      // Still looked up: nothing asked, and nothing noted.
      expect(getByText("Looking up alice.dusk…")).toBeInTheDocument();
      expect(queryByRole("alert")).toBeNull();
      expect(getContact(alice.id)).not.toHaveProperty("movedTo");

      finishLookup({ address: otherShielded, name: "alice.dusk" });

      await waitFor(() =>
        expect(container.querySelector(".send__card-title")).toHaveTextContent(
          "Alice · alice.dusk"
        )
      );
      expect(queryByRole("alert")).toBeNull();
      expect(getContact(alice.id)).not.toHaveProperty("movedTo");
      expect(getContact(alice.id)?.checkedAt).toBeGreaterThan(1);
    });

    it("should note each contact of a .dusk name that points elsewhere now, in one lookup", async () => {
      const alice = saveContact({
        address: otherAccount,
        duskName: "alice.dusk",
        name: "Alice",
      });
      const aliceShielded = saveContact({
        address: shieldedAddress,
        duskName: "alice.dusk",
        name: "Alice (shielded)",
      });

      baseProps.resolveName.mockResolvedValueOnce({
        account: nameAccount,
        address: otherShielded,
        name: "alice.dusk",
      });

      const { findByRole, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      expect(await findByRole("alert")).toHaveTextContent(
        "alice.dusk now points to a different address from the one saved for Alice."
      );
      // Each with the new address of its kind, for Contacts and the list here.
      expect(getContact(alice.id)?.movedTo).toBe(nameAccount);
      expect(getContact(aliceShielded.id)?.movedTo).toBe(otherShielded);
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
      expect(fields.review()).toBeDisabled();
      expect(container.querySelector(".send__card")).toBeNull();
      // Noted on the contact, for Contacts and the list here.
      expect(getContact(alice.id)?.movedTo).toBe(nameAccount);

      await fireEvent.click(getByRole("button", { name: "The new address" }));

      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });
      expect(fields.review()).toBeEnabled();
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

      expect(fieldsOf(again.getByRole).review()).toBeEnabled();
    });

    it("should ask before it sends to a contact's .dusk name that points to another contact's address now", async () => {
      const alice = saveContact({
        address: otherAccount,
        duskName: "alice.dusk",
        name: "Alice",
      });

      saveContact({ address: nameAccount, name: "Bob" });
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
      expect(fields.review()).toBeDisabled();
      expect(container.querySelector(".send__card")).toBeNull();
      expect(getContact(alice.id)?.movedTo).toBe(nameAccount);

      await fireEvent.click(getByRole("button", { name: "The saved address" }));

      expect(fields.to()).toHaveValue(otherAccount);
    });
  });

  describe("Other wallets here", () => {
    stubWalletNetwork();

    afterEach(async () => {
      // The contacts a test saved are kept before everything goes.
      await contactsWritten();
      walletStore.reset();
      await vault.clear();
      localStorage.clear();
      await openTestContacts();
    });

    /**
     * Two wallets here, the one added open: Wallet 1's first profile, its
     * public account and its shielded address.
     */
    const holdOtherWallet = async () => {
      // Public BIP39 test phrases, never a real wallet's.
      await vault.setUp(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "password123"
      );
      await unlockWallets("password123");

      const [{ account, address }] = get(walletStore).profiles;

      // The wallet added is the one open: Wallet 1 is the other.
      await addWallet(
        "scheme spot photo card baby mountain device kick cradle pact join borrow",
        "password123"
      );

      return { account: String(account), address: String(address) };
    };

    /** @param {HTMLElement} container */
    const cardTitle = (container) =>
      container.querySelector(".send__card-title")?.textContent?.trim();

    /**
     * Reviews 1 DUSK to the address entered, and sends it.
     *
     * @param {(role: string, options: object) => HTMLElement} getByRole
     */
    const sendOne = async (getByRole) => {
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());
    };

    // Send takes a click half a second after it shows: on this clock.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["performance"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should name a profile of the other wallet on the To line as the From line names its own, after a contact or a .dusk name", async () => {
      const { account } = await holdOtherWallet();

      baseProps.resolveName.mockResolvedValue({ account, name: "alice.dusk" });

      const { container, getByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();
      const toLine = () => getSummary(container)[1];

      await fireEvent.input(to, { target: { value: account } });

      expect(toLine()).toStrictEqual([
        "To",
        `Wallet 1 · Profile 1 ${shortenAddress(account)}`,
      ]);

      await fireEvent.input(to, { target: { value: "alice.dusk" } });

      await waitFor(() =>
        expect(toLine()).toStrictEqual([
          "To",
          `alice.dusk ${shortenAddress(account)}`,
        ])
      );

      saveContact({ address: account, name: "Rent" });
      await fireEvent.input(to, { target: { value: account } });

      expect(toLine()).toStrictEqual(["To", `Rent ${shortenAddress(account)}`]);
    });

    it("should name a profile of the other wallet on the address card, after a .dusk name", async () => {
      const { account, address } = await holdOtherWallet();

      madeUpAddresses.add(address);
      baseProps.resolveName.mockResolvedValue({ account, name: "alice.dusk" });

      const { container, getByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();

      await fireEvent.input(to, { target: { value: account } });

      expect(cardTitle(container)).toBe("Wallet 1 · Profile 1");

      await fireEvent.input(to, { target: { value: address } });

      expect(cardTitle(container)).toBe("Wallet 1 · Profile 1, shielded");

      await fireEvent.input(to, { target: { value: "alice.dusk" } });

      await waitFor(() =>
        expect(cardTitle(container)).toBe(
          "alice.dusk points to a public account"
        )
      );
    });

    it("should name the profile of the other wallet sent to on the Done screen", async () => {
      const { account } = await holdOtherWallet();
      const { getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: account },
      });

      await sendOne(getByRole);

      await waitFor(() =>
        expect(getByRole("status")).toHaveTextContent(
          "Sending… 1 DUSK to Wallet 1 · Profile 1 This usually takes under a minute."
        )
      );
    });

    it("should offer no Save to contacts for the other wallet's profile, and name a contact saved for it first, on the card and the Done screen", async () => {
      const { account } = await holdOtherWallet();
      const { container, getByRole, queryByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();

      await fireEvent.input(to, { target: { value: account } });

      expect(cardTitle(container)).toBe("Wallet 1 · Profile 1");
      expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();

      saveContact({ address: account, name: "Rent" });
      await fireEvent.input(to, { target: { value: account } });

      expect(cardTitle(container)).toBe("Rent");

      await sendOne(getByRole);

      await waitFor(() =>
        expect(getByRole("status")).toHaveTextContent(
          "Sending… 1 DUSK to Rent This usually takes under a minute."
        )
      );
    });
  });
});
