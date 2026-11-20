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
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { shortenAddress } from "$lib/dusk/string";
import { afterConfirmDelay, getAsHTMLElement } from "$lib/dusk/test-helpers";
import { page } from "$app/stores";
import {
  cancelWaitingSends,
  dropUnsent,
  keepWaiting,
  outcomeUnknown,
  sendGate,
  sendUnsentAgain,
  unsentSends,
} from "$lib/transactions";
import WalletChangedError from "$lib/errors/wallet-changed-error";
import { networks } from "@dusk-network/networks";
import {
  contactsWritten,
  findContact,
  getContact,
  listContacts,
  removeContact,
  saveContact,
} from "$lib/contacts";
import { networkStore, walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { getBlocklistedRecipient } from "$lib/security/addressBlocklist";
import {
  LINK_DISAGREES,
  LINK_SEVERAL,
  requestText,
} from "$lib/payment-requests";
import { LINK_UNCLEAR } from "@dusk-network/app-core/payment-links";
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
 * The summary's rows, in order, as their values: what each row says, not
 * what it's called.
 *
 * @param {HTMLElement} container
 */
const getSummary = (container) =>
  Array.from(
    container.querySelectorAll(".send__summary .send__rows > div"),
    (row) => row.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim(),
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

/** A send that can be called off until it goes out, as Send gives each. */
const aGate = expect.objectContaining({
  cancel: expect.any(Function),
  handOver: expect.any(Function),
});

describe("Send", () => {
  const lastTxId =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
  const publicAddress =
    "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
  const shieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const otherAccount =
    "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
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
        (field) => /** @type {HTMLInputElement} */ (field).value,
      );

    /**
     * What's put in To at once, as a paste, and read.
     *
     * @param {ReturnType<typeof fieldsOf>} fields
     * @param {string} value
     */
    const paste = async ({ to }, value) => {
      await fireEvent.input(to(), { target: { value } });
      // A request's .dusk names are looked up before it fills anything in.
      await new Promise((resolve) => setTimeout(resolve, 0));
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
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(fields, link);

        expect(filled(fields)).toStrictEqual([
          otherAccount,
          "0.15",
          "Factura 33",
        ]);

        await sendIt(fields);

        expect(baseProps.execute).toHaveBeenCalledWith(
          otherAccount,
          150_000_000n,
          "Factura 33",
          gasPrice,
          gasLimit,
          undefined,
          aGate,
        );
      },
    );

    it.each([
      ["a dusk: link", duskLink],
      ["an https link to the web wallet's Send", httpsLink],
    ])(
      "should fill in the recipient, the amount and the memo from what Copy gives of a request with %s, pasted into To, as from its link alone",
      async (_, link) => {
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(
          fields,
          requestText(
            { link, lux: 150_000_000n, memo: "Factura 33" },
            { language: "en", name: "sofiadesign.dusk", net: networks.testnet },
          ),
        );

        expect(filled(fields)).toStrictEqual([
          otherAccount,
          "0.15",
          "Factura 33",
        ]);

        await sendIt(fields);

        expect(baseProps.execute).toHaveBeenCalledWith(
          otherAccount,
          150_000_000n,
          "Factura 33",
          gasPrice,
          gasLimit,
          undefined,
          aGate,
        );
      },
    );

    /**
     * Pasted as a browser pastes it: the clipboard's text, line breaks and
     * all, which a one-line field then holds without its line breaks.
     *
     * @param {ReturnType<typeof fieldsOf>} fields
     * @param {string} text
     */
    const pasteAsBrowser = async (fields, text) => {
      await fireEvent.paste(fields.to(), {
        clipboardData: { getData: () => text },
      });
      await paste(fields, text.replace(/[\r\n]/g, ""));
    };

    /**
     * What To keeps of a paste refused whole: what was pasted, on its one
     * line; Amount and Memo empty.
     *
     * @param {string} text
     */
    const refusedAs = (text) => [
      text.replace(/\s*[\r\n]+\s*/g, " ").trim(),
      "",
      "",
    ];

    /**
     * An account as a refusal names it, cut as app-core cuts it.
     *
     * @param {string} account
     */
    const cut = (account) => `${account.slice(0, 6)}…${account.slice(-6)}`;

    // Lena's, in both wallets: her own link with " danke!" after it said
    // "This link's network can't be read", and her link whose memo came
    // last filled the memo "Lena r35 odd danke!", the word on the next line
    // glued on as "odddanke!" where the field dropped the line break.
    it("should refuse a pasted link with words after it, whatever field it ends with, saying so, and never take them into its memo", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const memoLast = `https://apps.testnet.dusk.network/wallet/dashboard/send?to=${otherAccount}&amount=0.01&network=testnet&memo=Lena+r35+odd`;

      for (const link of [httpsLink, memoLast]) {
        for (const after of [" danke!", "\ndanke!", "\r\ndanke!"]) {
          await pasteAsBrowser(fields, `${link}${after}`);

          // What was pasted stays in To, to see what it said.
          expect(filled(fields)).toStrictEqual(refusedAs(`${link}${after}`));
          expect(getByRole("alert")).toHaveTextContent(LINK_UNCLEAR);
          expect(fields.review()).toBeDisabled();
        }
      }

      // Alone, it fills in what it asks, as ever.
      await pasteAsBrowser(fields, memoLast);

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.01",
        "Lena r35 odd",
      ]);
    });

    // Marek's: the wallet's own message with only its link's amount changed
    // filled the link's 0.15 under a line saying 0.002, "Filled in from the
    // link".
    it("should refuse what Copy gives of a request whose line says another amount or memo than its link, filling in nothing", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const copied = requestText(
        { link: httpsLink, lux: 2_000_000n, memo: "Factura 33" },
        { language: "en", name: "", net: networks.testnet },
      ).replace("amount=0.15", "amount=0.002");

      // As Copy gave it: it agrees with its link.
      await pasteAsBrowser(fields, copied);

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.002",
        "Factura 33",
      ]);

      // Nandini's, Lena's and Amélie's: it said what disagreed with nothing
      // but "The message and its link don't agree.", and emptied To. Now it
      // names both: what the message says, and what its link asks.
      for (const [forged, says, asks] of [
        [
          copied.replace("amount=0.002", "amount=0.15"),
          "0.002 DUSK",
          "0.15 DUSK",
        ],
        [
          copied.replace("0.002 DUSK", "0.001 DUSK"),
          "0.001 DUSK",
          "0.002 DUSK",
        ],
        [copied.replace("· Factura 33", "· coffee"), "coffee", "Factura 33"],
      ]) {
        await pasteAsBrowser(fields, forged);

        expect(filled(fields)).toStrictEqual(refusedAs(forged));
        expect(getByRole("alert")).toHaveTextContent(says);
        expect(getByRole("alert")).toHaveTextContent(asks);
        expect(fields.review()).toBeDisabled();
      }
    });

    // Then a line naming a .dusk name over someone else's link: its names
    // are looked up first, nothing filled in, nor said wrong, meanwhile.
    it("should look a request's .dusk name up before it fills anything in, and refuse it where the name pays another account than its link", async () => {
      const { getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const copied = requestText(
        { link: httpsLink, lux: 150_000_000n, memo: "Factura 33" },
        { language: "en", name: "sofiadesign.dusk", net: networks.testnet },
      );
      const lookup = Promise.withResolvers();

      baseProps.resolveName.mockImplementationOnce(() => lookup.promise);
      await fireEvent.paste(fields.to(), {
        clipboardData: { getData: () => copied },
      });
      await fireEvent.input(fields.to(), {
        target: { value: copied.replace("\n", "") },
      });
      await tick();

      expect(baseProps.resolveName).toHaveBeenLastCalledWith(
        "sofiadesign.dusk",
      );
      expect(filled(fields).slice(1)).toStrictEqual(["", ""]);
      expect(queryByRole("alert")).toBeNull();
      expect(fields.review()).toBeDisabled();

      // Another account's: refused, saying whose the link is.
      lookup.resolve({
        account: bep20BridgeAddress,
        address: "",
        name: "sofiadesign.dusk",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await tick();
      await tick();

      expect(filled(fields)).toStrictEqual(refusedAs(copied));
      expect(getByRole("alert")).toHaveTextContent("sofiadesign.dusk");
      expect(getByRole("alert")).toHaveTextContent(cut(otherAccount));

      // The link's own: filled in.
      baseProps.resolveName.mockResolvedValueOnce({
        account: otherAccount,
        address: "",
        name: "sofiadesign.dusk",
      });
      await pasteAsBrowser(fields, copied);

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.15",
        "Factura 33",
      ]);
    });

    // Nandini's, in both wallets: "You're asked to pay 0.012 DUSK to
    // alice.dusk on Testnet …" over a link to Amélie filled in Amélie and
    // never said a word of alice.dusk, nor of alice·dusk.
    it("should look up a .dusk name anywhere in a pasted message, and refuse the message where it pays another account than its link", async () => {
      const { getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const link = `https://apps.testnet.dusk.network/wallet/dashboard/send?to=${otherAccount}&amount=0.012&memo=Invoice+NOV-17c+r37&network=testnet`;
      /** @param {string} to */
      const message = (to) =>
        `You're asked to pay 0.012 DUSK${to} on Testnet · Invoice NOV-17c r37\nPay here: ${link}`;

      for (const name of ["alice.dusk", "alice·dusk"]) {
        const lookup = Promise.withResolvers();

        baseProps.resolveName.mockImplementationOnce(() => lookup.promise);
        await fireEvent.paste(fields.to(), {
          clipboardData: { getData: () => message(` to ${name}`) },
        });
        await fireEvent.input(fields.to(), {
          target: { value: message(` to ${name}`).replace("\n", "") },
        });
        await tick();

        // Looked up first: nothing filled in, nor said wrong, meanwhile.
        expect(baseProps.resolveName).toHaveBeenLastCalledWith("alice.dusk");
        expect(filled(fields).slice(1)).toStrictEqual(["", ""]);
        expect(queryByRole("alert")).toBeNull();

        // Someone else's: refused, nothing filled in, saying what.
        lookup.resolve({
          account: bep20BridgeAddress,
          address: "",
          name: "alice.dusk",
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await tick();
        await tick();

        expect(filled(fields)).toStrictEqual(refusedAs(message(` to ${name}`)));
        expect(getByRole("alert")).toHaveTextContent("alice.dusk");
        expect(getByRole("alert")).toHaveTextContent(cut(otherAccount));
        expect(fields.review()).toBeDisabled();
      }

      // Naming no one, it fills in what its link asks.
      await pasteAsBrowser(fields, message(""));

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.012",
        "Invoice NOV-17c r37",
      ]);
    });

    // Marek's, in both wallets: one character switched the check off, the
    // link's 0.15 filled in under his line saying 0.002. The web wallet
    // already refused a line apart from its link.
    describe("Marek's line, changed", () => {
      /**
       * What Copy gives of his request for `amount`, as Lux too.
       *
       * @param {string} amount
       * @param {bigint} lux
       */
      const line = (amount, lux) =>
        requestText(
          {
            link: httpsLink
              .replace("amount=0.15", `amount=${amount}`)
              .replace("memo=Factura+33", "memo=r37+marek+T2"),
            lux,
            memo: "r37 marek T2",
          },
          { language: "en", name: "", net: networks.testnet },
        );
      const own = line("0.002", 2_000_000n);
      const [ownLine] = own.split("\n");
      const theirs = line("0.15", 150_000_000n);
      const theirLink = theirs.split("Pay here: ")[1];

      it.each([
        ["with a zero-width space after You're", "You're", "You're\u200b"],
        ["with a Cyrillic о in to pay", "to pay", "t\u043e pay"],
        ["with a Cyrillic К in DUSK", "DUSK on", "DUS\u041a on"],
        ["as You are asked", "You're asked", "You are asked"],
      ])(
        "should refuse it %s over a link asking another amount, and fill it in over its own",
        async (_, was, is) => {
          const { getByRole } = render(Send, baseProps);
          const fields = fieldsOf(getByRole);
          const changed = own.replace(was, is);

          expect(changed).not.toBe(own);

          await pasteAsBrowser(
            fields,
            changed.replace("amount=0.002", "amount=0.15"),
          );

          expect(filled(fields)).toStrictEqual(
            refusedAs(changed.replace("amount=0.002", "amount=0.15")),
          );
          expect(getByRole("alert")).toHaveTextContent("0.15 DUSK");
          expect(fields.review()).toBeDisabled();

          await pasteAsBrowser(fields, changed);

          expect(filled(fields)).toStrictEqual([
            otherAccount,
            "0.002",
            "r37 marek T2",
          ]);
        },
      );

      it.each([
        [
          "Thanks! between it and Pay here",
          `${ownLine}\nThanks!\nPay here: ${theirLink}`,
        ],
        [
          "a blank line between it and Pay here",
          `${ownLine}\n\nPay here: ${theirLink}`,
        ],
        ["Pay me here", `${ownLine}\nPay me here: ${theirLink}`],
        ["a second line saying the link's amount", `${ownLine}\n${theirs}`],
      ])(
        "should refuse it with %s over a link asking another amount",
        async (_, pasted) => {
          const { getByRole } = render(Send, baseProps);
          const fields = fieldsOf(getByRole);

          await pasteAsBrowser(fields, pasted);

          expect(filled(fields)).toStrictEqual(refusedAs(pasted));
          expect(getByRole("alert")).toHaveTextContent("0.002 DUSK");
          expect(getByRole("alert")).toHaveTextContent("0.15 DUSK");
          expect(fields.review()).toBeDisabled();
        },
      );

      // Marek's of round 39, which still filled in: a request line naming
      // the .dusk payee with a spaced dot over a link to someone else (z60),
      // a bare "Total 0.15" with no unit (W19), and someone else's raw
      // address in the text (W31).
      it.each([
        [
          "z60, a spaced dot in the name who asks",
          () => own.replace(/^You're asked/, "sofiadesign . dusk asks you"),
          "sofiadesign.dusk",
          cut(otherAccount),
        ],
        [
          "W19, a bare Total over it",
          () => `Total 0.15\n${own}`,
          "0.15",
          "0.002 DUSK",
        ],
        [
          "W31, another's address over it",
          () => `Pay to ${bep20BridgeAddress}\n${own}`,
          cut(bep20BridgeAddress),
          cut(otherAccount),
        ],
      ])(
        "should refuse his paste with %s, saying what disagrees, To keeping it",
        async (_, pastedOf, says, asks) => {
          const { getByRole } = render(Send, baseProps);
          const fields = fieldsOf(getByRole);
          const pasted = pastedOf();

          // sofiadesign.dusk is Sofía's, not whom the link pays.
          baseProps.resolveName.mockResolvedValue({
            account: bep20BridgeAddress,
            address: "",
            name: "sofiadesign.dusk",
          });

          try {
            await pasteAsBrowser(fields, pasted);

            expect(filled(fields)).toStrictEqual(refusedAs(pasted));
            // Both of what disagrees: what the message says, and its link.
            expect(getByRole("alert")).toHaveTextContent(says);
            expect(getByRole("alert")).toHaveTextContent(asks);
            expect(fields.review()).toBeDisabled();
          } finally {
            baseProps.resolveName.mockReset();
          }
        },
      );
    });

    // Anything put in To while a request's names are looked up comes first:
    // a contact picked, a recipient typed, To cleared. The lookup's answer,
    // when it comes, fills in nothing.
    it("should fill in nothing of a pasted request whose names are still looked up once another recipient is put in To", async () => {
      const contact = saveContact({ address: publicAddress, name: "Rent" });
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const copied = requestText(
        { link: httpsLink, lux: 150_000_000n, memo: "Factura 33" },
        { language: "en", name: "sofiadesign.dusk", net: networks.testnet },
      );
      /** @type {Array<PromiseWithResolvers<any>>} */
      const lookups = [];

      baseProps.resolveName.mockImplementation(() => {
        const lookup = Promise.withResolvers();

        lookups.push(lookup);

        return lookup.promise;
      });

      /** The request's name answers as the link's own account's. */
      const answer = async () => {
        lookups.forEach(({ resolve }) =>
          resolve({ account: otherAccount, address: "", name: "x" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        await tick();
        await tick();
      };

      try {
        // A contact picked meanwhile.
        await fireEvent.input(fields.to(), { target: { value: copied } });
        await fireEvent.change(
          getByRole("combobox", { name: "Send to a contact" }),
          { target: { value: contact.id } },
        );
        await tick();
        await answer();

        expect(filled(fields)).toStrictEqual([publicAddress, "", ""]);

        // To cleared meanwhile.
        await fireEvent.input(fields.to(), { target: { value: "" } });
        await fireEvent.input(fields.to(), { target: { value: copied } });
        await fireEvent.input(fields.to(), { target: { value: "" } });
        await answer();

        expect(filled(fields)).toStrictEqual(["", "", ""]);
      } finally {
        baseProps.resolveName.mockReset();
        removeContact(contact.id);
      }
    });

    // 0.12 typed in Amount while a request's name was looked up went back to
    // its 0.15 as the answer came. What's put in Amount or Memo meanwhile
    // comes first; left alone, they show as being filled in, not to be typed
    // in, until the answer comes.
    it("should fill in nothing over what's put in Amount or Memo while a pasted request's names are looked up, and keep them from being typed in meanwhile", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const copied = requestText(
        { link: httpsLink, lux: 150_000_000n, memo: "Factura 33" },
        { language: "en", name: "sofiadesign.dusk", net: networks.testnet },
      );
      /** @type {Array<PromiseWithResolvers<any>>} */
      const lookups = [];

      baseProps.resolveName.mockImplementation(() => {
        const lookup = Promise.withResolvers();

        lookups.push(lookup);

        return lookup.promise;
      });

      /** The request's name answers as the link's own account's. */
      const answer = async () => {
        lookups.forEach(({ resolve }) =>
          resolve({ account: otherAccount, address: "", name: "x" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        await tick();
        await tick();
      };

      // 0.12 put in Amount meanwhile, and a memo: they stay.
      await fireEvent.input(fields.to(), { target: { value: copied } });
      await tick();
      await fireEvent.input(fields.amount(), { target: { value: "0.12" } });
      await answer();

      expect(filled(fields).slice(1)).toStrictEqual(["0.12", ""]);

      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: copied } });
      await tick();
      await fireEvent.input(fields.memo(), { target: { value: "partial" } });
      await answer();

      expect(filled(fields).slice(1)).toStrictEqual(["0.12", "partial"]);

      // Left alone, they show as being filled in, not to be typed in, until
      // the answer comes.
      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: copied } });
      await tick();

      expect(fields.amount()).toBeDisabled();
      expect(getByRole("button", { name: "Max" })).toBeDisabled();
      expect(fields.memo()).toBeDisabled();

      await answer();

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.15",
        "Factura 33",
      ]);
      expect(fields.amount()).toBeEnabled();
      expect(fields.memo()).toBeEnabled();
    });

    // A space inside a link pasted alone is words after it too: the link
    // ends at its first space, as app-core reads it.
    it("should refuse a link pasted alone with a space in its amount, as words after it, filling in nothing", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, httpsLink.replace("amount=0.15", "amount=1 000"));

      expect(filled(fields)).toStrictEqual(
        refusedAs(httpsLink.replace("amount=0.15", "amount=1 000")),
      );
      expect(getByRole("alert")).toHaveTextContent(LINK_UNCLEAR);
      expect(fields.review()).toBeDisabled();
    });

    // Marek's: a pasted link's "1" + NBSP + "000" filled 1000, as the spaces
    // were joined out of what was pasted before it was read.
    it.each([
      ["a no-break space", "\u00a0"],
      ["a thin space", "\u2009"],
      ["an ideographic space", "\u3000"],
      ["a tab", "\t"],
    ])(
      "should refuse a pasted link with %s in its amount, filling in nothing, alone, in what Copy gives or typed",
      async (_, space) => {
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);
        const link = httpsLink.replace("amount=0.15", `amount=1${space}000`);

        // Pasted alone: the link ends at the space.
        await paste(fields, link);

        expect(filled(fields)).toStrictEqual(refusedAs(link));
        expect(getByRole("alert")).toHaveTextContent(LINK_UNCLEAR);
        expect(fields.review()).toBeDisabled();

        // In what Copy gives: the words after the space may be the link's.
        await paste(
          fields,
          `You're asked to pay 1000 DUSK on Testnet\nPay here: ${link}`,
        );

        // Put in as a keyboard puts it, its line break gone.
        expect(filled(fields)).toStrictEqual(
          refusedAs(
            `You're asked to pay 1000 DUSK on TestnetPay here: ${link}`,
          ),
        );
        expect(getByRole("alert")).toHaveTextContent(LINK_UNCLEAR);

        // Put in a key at a time, as a phone's keyboard can, then left: its
        // spaces aren't joined out of it either. On the way, its host reads
        // as a .dusk name, which no one has.
        baseProps.resolveName.mockResolvedValue(null);

        for (let end = 1; end <= link.length; end += 1) {
          await fireEvent.input(fields.to(), {
            target: { value: link.slice(0, end) },
          });
        }

        await fireEvent.blur(fields.to());
        await tick();
        await tick();

        expect(filled(fields)).toStrictEqual(refusedAs(link));
        expect(getByRole("alert")).toHaveTextContent(LINK_UNCLEAR);
        expect(fields.review()).toBeDisabled();
      },
    );

    it("should refuse pasted text with two payment links in it, filling in nothing, as which is meant can't be told", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, `Pay here: ${httpsLink}\nOr here: ${duskLink}`);

      expect(filled(fields)).toStrictEqual(
        // Put in as a keyboard puts it, its line break gone.
        refusedAs(`Pay here: ${httpsLink}Or here: ${duskLink}`),
      );
      expect(getByRole("alert")).toHaveTextContent(LINK_SEVERAL);
      expect(fields.review()).toBeDisabled();
    });

    it("should refuse a link whose amount in lux isn't the one it says, filling in nothing", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(
        fields,
        `${httpsLink.replace("amount=0.15", "amount=0.01")}&amountLux=150000000`,
      );

      expect(getByRole("alert")).toBeInTheDocument();
      expect(filled(fields)).toStrictEqual(
        refusedAs(
          `${httpsLink.replace("amount=0.15", "amount=0.01")}&amountLux=150000000`,
        ),
      );

      // The same amount both ways is the one asked.
      await paste(fields, `${httpsLink}&amountLux=150000000`);

      expect(filled(fields)).toStrictEqual([
        otherAccount,
        "0.15",
        "Factura 33",
      ]);
    });

    it.each([
      ["its memo said twice", `${httpsLink}&memo=Factura+34`],
      ["its amount said twice, another", `${httpsLink}&amount=150`],
      [
        "a user part before the host",
        httpsLink.replace(
          "https://apps.testnet.dusk.network",
          "https://apps.testnet.dusk.network@apps.dusk.network",
        ),
      ],
      [
        "the test wallet's address saying Mainnet",
        httpsLink.replace("network=testnet", "network=mainnet"),
      ],
      [
        "its network written dusk:02",
        httpsLink.replace("network=testnet", "network=dusk:02"),
      ],
    ])(
      "should refuse a link with %s, saying why and filling in nothing",
      async (_, link) => {
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(fields, link);

        expect(getByRole("alert")).toBeInTheDocument();
        expect(filled(fields)).toStrictEqual(refusedAs(link));
      },
    );

    it("should say a mainnet wallet's link is for Mainnet, on testnet, and offer the same request on Mainnet's wallet", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      // A mainnet account, as a request for Mainnet asks to be paid at.
      const account = bep20BridgeAddress;

      await paste(
        fields,
        `${networks.mainnet.apps.wallet}/dashboard/send?to=${account}&amount=0.15&memo=Factura+33&network=mainnet`,
      );

      expect(getByRole("alert")).toHaveTextContent("Mainnet");
      expect(filled(fields)).toStrictEqual(
        refusedAs(
          `${networks.mainnet.apps.wallet}/dashboard/send?to=${account}&amount=0.15&memo=Factura+33&network=mainnet`,
        ),
      );
      expect(getByRole("link", { name: "Switch to Mainnet" })).toHaveAttribute(
        "href",
        `https://apps.dusk.network/wallet/dashboard/send?to=${account}&amount=0.15&memo=Factura+33&network=mainnet`,
      );

      // Nothing to switch for once something else is given.
      await paste(fields, otherAccount);

      expect(() => getByRole("link", { name: "Switch to Mainnet" })).toThrow();
    });

    // A request for Mainnet naming alice.dusk, pasted on Testnet, was refused
    // as its line and link not agreeing, Switch to Mainnet gone: its name was
    // looked up on Testnet, where it's someone else's.
    it("should say a request for Mainnet naming a .dusk name is for Mainnet, on testnet, and offer it on Mainnet's wallet, its name not looked up on testnet", async () => {
      const { getByRole, queryByText } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const link = `${networks.mainnet.apps.wallet}/dashboard/send?to=${bep20BridgeAddress}&amount=0.15&memo=Factura+33&network=mainnet`;

      // On Testnet, alice.dusk is another account's.
      baseProps.resolveName.mockResolvedValue({
        account: otherAccount,
        address: "",
        name: "alice.dusk",
      });

      const message = requestText(
        { link, lux: 150_000_000n, memo: "Factura 33" },
        { language: "en", name: "alice.dusk", net: networks.mainnet },
      );

      await pasteAsBrowser(fields, message);

      expect(getByRole("alert")).toHaveTextContent("Mainnet");
      expect(queryByText(LINK_DISAGREES)).toBeNull();
      expect(filled(fields)).toStrictEqual(refusedAs(message));
      expect(getByRole("link", { name: "Switch to Mainnet" })).toHaveAttribute(
        "href",
        link,
      );
      expect(baseProps.resolveName).not.toHaveBeenCalled();
    });

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
        gasLimit,
        undefined,
        aGate,
      );
    });

    it.each([
      ["its chain ID", "@dusk:1?amount=0.15&memo=Factura+33"],
      ["network=", "?amount=0.15&memo=Factura+33&network=mainnet"],
    ])(
      "should say so plainly for a dusk: link for another network by %s, emptying what an earlier link filled in",
      async (_, rest) => {
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(fields, httpsLink.replace("Factura+33", "Chicken+rice"));
        await paste(fields, `dusk:public-${otherAccount}${rest}`);

        expect(getByRole("alert")).toHaveTextContent("Mainnet");
        expect(filled(fields)).toStrictEqual(
          refusedAs(`dusk:public-${otherAccount}${rest}`),
        );
        expect(fields.review()).toBeDisabled();
      },
    );

    it("should empty what's typed for a link refused, and take what's given next on its own", async () => {
      const { getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "2" } });
      await fireEvent.input(fields.memo(), { target: { value: "Lunch" } });
      await paste(
        fields,
        `dusk:public-${otherAccount}@dusk:1?amount=0.15&memo=Factura+33`,
      );

      expect(getByRole("alert")).toHaveTextContent("Mainnet");
      expect(filled(fields)).toStrictEqual(
        refusedAs(
          `dusk:public-${otherAccount}@dusk:1?amount=0.15&memo=Factura+33`,
        ),
      );

      // What's given next is on its own.
      await paste(fields, otherAccount);

      expect(queryByRole("alert")).toBeNull();
    });

    it.each([
      ["a dusk: link of no known form", "dusk:nothing-at-all"],
      [
        "a link to the web wallet's Send without a recipient",
        `https://apps.testnet.dusk.network/wallet/dashboard/send?amount=1`,
      ],
      [
        "a dusk:shielded- link to a public account",
        `dusk:shielded-${otherAccount}?amount=0.001`,
      ],
      [
        "a dusk: link with a # after it, which can say more than it shows",
        `dusk:${otherAccount}?amount=0.001#to=${bep20BridgeAddress}`,
      ],
    ])("should say why %s can't be read", async (_, value) => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await paste(fields, value);

      expect(getByRole("alert")).toBeInTheDocument();
      expect(filled(fields)).toStrictEqual(refusedAs(value));
    });

    it.each([
      ["isn't one", () => `dusk:public-${invalidAddress}?amount=1`],
      [
        "was cut short on its way",
        () => httpsLink.replace(otherAccount, otherAccount.slice(0, -6)),
      ],
    ])(
      "should refuse a link whose address %s, as the link's, filling in nothing",
      async (_, link) => {
        const { getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await paste(fields, link());

        expect(getByRole("alert")).toBeInTheDocument();
        expect(filled(fields)).toStrictEqual(refusedAs(link()));
        expect(fields.review()).toBeDisabled();
      },
    );

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

    it("should read a scanned code as it reads what's pasted: a link fills the form in, another network's says so", async () => {
      hasCamera.mockResolvedValueOnce(true);

      const { container, findByRole, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const scan = await findByRole("button", { name: "Scan a QR code" });

      await fireEvent.click(scan);
      scanned(duskLink);
      await vi.waitFor(() =>
        expect(filled(fields)).toStrictEqual([
          otherAccount,
          "0.15",
          "Factura 33",
        ]),
      );

      await fireEvent.click(scan);
      scanned(`dusk:public-${otherAccount}@dusk:1?amount=9`);
      await vi.waitFor(() =>
        expect(getByRole("alert")).toHaveTextContent("Mainnet"),
      );
      expect(filled(fields)[0]).toBe("");

      // Anything else isn't put in To: the scanner says so, and reads on.
      for (const code of [
        "hello from the canteen menu",
        invalidAddress,
        "0x2222222222222222222222222222222222222222",
      ]) {
        await fireEvent.click(scan);
        scanned(code);
        await vi.waitFor(() =>
          expect(
            container.querySelector(".scan [role='alert']"),
          ).toBeInTheDocument(),
        );
        expect(filled(fields)[0]).toBe("");
      }

      scanned(otherAccount);
      await vi.waitFor(() => expect(filled(fields)[0]).toBe(otherAccount));
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
      opened.unmount();

      const refused = render(Send, {
        ...baseProps,
        initialProblem: "This request is for Mainnet. You are on Testnet.",
      });

      expect(refused.getByRole("alert")).toBeInTheDocument();
      refused.unmount();

      const wrong = render(Send, {
        ...baseProps,
        initialRecipient: invalidAddress,
      });
      const to = fieldsOf(wrong.getByRole).to();

      expect(to).toHaveAttribute("aria-invalid", "true");
      expect(to).toHaveAccessibleDescription(/\S/);
    });
  });

  describe("Recipient", () => {
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

    it("should display only a one-line warning if the address input is the user's own public account", async () => {
      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: publicAddress },
      });

      const banners = container.querySelectorAll(".banner");

      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveClass("banner--warning");
    });

    it("should display a notice if the address input is the BEP20 bridge address", async () => {
      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: bep20BridgeAddress },
      });

      const banners = container.querySelectorAll(".banner");

      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveClass("banner--info");
    });
  });

  describe("What the recipient field says", () => {
    // Sofía's and Marek's: "sofiadesign·dusk" typed in To said only "Not a
    // valid address.", and only once the box was left.
    it("says at once, as it's typed, that what only looks like a .dusk name isn't one, naming the one it looks like, and looks nothing up", async () => {
      const { getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      const to = fields.to();

      baseProps.resolveName.mockClear();

      for (const typed of [
        "sofiadesign·dusk",
        "sofiadesign˙dusk",
        "sofiadesign⠄dusk",
        "sofiadesign · dusk",
        // A Cyrillic ѕ.
        "\u0455ofiadesign.dusk",
      ]) {
        await fireEvent.input(to, { target: { value: "" } });

        // A key at a time, never leaving the box.
        for (let end = 1; end <= typed.length; end++) {
          await fireEvent.input(to, { target: { value: typed.slice(0, end) } });
        }

        // Naming the one it looks like.
        expect(getByRole("alert")).toHaveTextContent("sofiadesign.dusk");
        expect(to).toHaveAttribute("aria-invalid", "true");
        expect(fields.review()).toBeDisabled();
      }

      expect(baseProps.resolveName).not.toHaveBeenCalled();
    });
  });

  describe("Amount and memo", () => {
    it("should take new gas settings while the form shows, unless the gas was edited here", async () => {
      const { container, getByLabelText, getByRole, rerender } = render(
        Send,
        baseProps,
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

    it("should check an amount against the balance once it's read, and say nothing against a balance not read yet", async () => {
      const { getByRole, queryByRole, rerender } = render(Send, {
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

      // More than the balance: said with the balance.
      await rerender({ availableBalance: 25_000_000n });

      expect(getByRole("alert")).toHaveTextContent("0.025 DUSK");
      expect(fieldsOf(getByRole).review()).toBeDisabled();

      // Too little left for the fee: said with the most that can go.
      await rerender({ availableBalance: 40_000_000n });

      expect(getByRole("alert")).toHaveTextContent("0.02 DUSK");
    });

    it("should keep Send disabled, and say why, while the balance can't pay the fee", async () => {
      const { getByRole } = render(Send, {
        ...baseProps,
        gasSettings: { gasLimit: 40000000n, gasPrice: 40000000n },
        initialRecipient: shieldedAddress,
      });

      await tick();

      expect(fieldsOf(getByRole).review()).toBeDisabled();
      expect(getByRole("alert")).toBeInTheDocument();
    });

    it("should take an amount typed with a decimal comma, or with its thousands grouped", async () => {
      const { container, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.amount(), { target: { value: "1,5" } });

      expect(getSummary(container)).toContain("1.5 DUSK");
      expect(fields.review()).toBeEnabled();
      expect(queryByRole("alert")).toBeNull();

      await fireEvent.input(fields.amount(), { target: { value: "1,000.5" } });

      expect(getSummary(container)).toContain("1,000.5 DUSK");

      // A lone comma before three digits could mean 1 or 1000: asked, with
      // a button for each, which puts that one in the field.
      await fireEvent.input(fields.amount(), { target: { value: "1,000" } });

      expect(getByRole("alert")).toBeInTheDocument();
      expect(getByRole("button", { name: "1000 DUSK" })).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.click(getByRole("button", { name: "1 DUSK" }));

      expect(fields.amount()).toHaveValue("1");
      expect(queryByRole("alert")).toBeNull();
      expect(fields.review()).toBeEnabled();

      await fireEvent.input(fields.amount(), {
        target: { value: "0,0000000001" },
      });

      expect(getByRole("alert")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();
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

        // No figure in the field, on the page or on Send.
        expect(
          /** @type {HTMLInputElement} */ (fields.amount()).value,
        ).not.toMatch(/\d/);
        expect(shown()).not.toContain(exact);
        expect(shown()).not.toContain(
          formatDuskExact(baseProps.availableBalance, "en"),
        );
        await fireEvent.click(fields.review());

        expect(fields.send()).not.toHaveAccessibleName(/\d/);

        await afterConfirmDelay();
        await fireEvent.click(fields.send());

        expect(baseProps.execute).toHaveBeenCalledWith(
          shieldedAddress,
          max,
          expect.anything(),
          expect.anything(),
          expect.anything(),
          undefined,
          aGate,
        );
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
    });

    it("should hide an amount sent back while balances are hidden, as Max's, and send it all the same", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { container, getByRole } = render(Send, {
          ...baseProps,
          initialAmount: "0.012",
          initialAmountHidden: true,
          initialMemo: "Refund: Factura 43",
          initialRecipient: otherAccount,
        });
        const fields = fieldsOf(getByRole);

        expect(
          /** @type {HTMLInputElement} */ (fields.amount()).value,
        ).not.toMatch(/\d/);
        expect(container.textContent).not.toContain("0.012");

        await fireEvent.click(fields.review());

        expect(fields.send()).not.toHaveAccessibleName(/\d/);
        expect(container.textContent).not.toContain("0.012");

        await afterConfirmDelay();
        await fireEvent.click(fields.send());

        expect(baseProps.execute).toHaveBeenCalledWith(
          otherAccount,
          12_000_000n,
          "Refund: Factura 43",
          expect.anything(),
          expect.anything(),
          undefined,
          aGate,
        );
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
    });

    it("should fill in Max as this language writes decimals, so it's never taken for a thousands group", async () => {
      settingsStore.update((store) => ({ ...store, language: "nl-NL" }));

      try {
        const { getByRole } = render(Send, baseProps);

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          /** @type {HTMLInputElement} */ (fieldsOf(getByRole).amount()).value,
        ).not.toContain(".");

        // Nor does what it asks for instead write them another way, and it
        // says why what can mean two amounts is refused.
        await fireEvent.input(fieldsOf(getByRole).amount(), {
          target: { value: "1.001" },
        });

        expect(getByRole("alert")).toBeInTheDocument();
        expect(
          [
            getByRole("button", { name: "1,0010 DUSK" }),
            getByRole("button", { name: "1001 DUSK" }),
          ].every(Boolean),
        ).toBe(true);

        // Its example, too, as this language writes decimals.
        await fireEvent.input(fieldsOf(getByRole).amount(), {
          target: { value: "ten" },
        });

        expect(getByRole("alert")).toHaveTextContent("10,5");
      } finally {
        settingsStore.update((store) => ({ ...store, language: "en" }));
      }
    });

    it("should read a language's own groups, as the page writes them, and say more than your balance rather than talk of gas", async () => {
      settingsStore.update((store) => ({ ...store, language: "fr-FR" }));

      try {
        const { container, getByRole, rerender } = render(Send, {
          ...baseProps,
          availableBalance: 2_000_000_000_000n,
          initialRecipient: shieldedAddress,
        });
        const fields = fieldsOf(getByRole);

        for (const typed of ["1 000", "1\u00a0000", "1\u202f000"]) {
          await fireEvent.input(fields.amount(), { target: { value: typed } });

          expect(getSummary(container)).toContainEqual(
            expect.stringMatching(/^1\s000 DUSK$/),
          );
          expect(fields.review()).toBeEnabled();
        }

        // With no coins, the amount is the trouble, not the fee: what's
        // said names the balance it's more than.
        await rerender({ availableBalance: 0n, shieldedBalance: 0n });

        expect(getByRole("alert")).toHaveTextContent(/\b0 DUSK/);

        await fireEvent.input(fields.amount(), { target: { value: "0,5" } });

        expect(getByRole("alert")).toHaveTextContent(/\b0 DUSK/);
        expect(fields.review()).toBeDisabled();
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

        expect(fields.send()).toHaveAccessibleName(/(^|\s)1 DUSK/);

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
        formatDuskPlain(baseProps.availableBalance - fee),
      );
      expect(fields.review()).toBeEnabled();
    });

    it("should fill Max so that it reads back as it is, never as a thousands group, and ask which is meant of 1.000 typed in English", async () => {
      // 1.234 DUSK can be sent: written as is, it could mean 1234.
      const { getByRole, queryByRole } = render(Send, {
        ...baseProps,
        availableBalance: 1_234_000_000n + fee,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(fields.amount()).toHaveValue("1.2340");
      expect(queryByRole("alert")).toBeNull();
      expect(fields.review()).toBeEnabled();

      // Typed, a lone point before three digits asks, as a comma does.
      await fireEvent.input(fields.amount(), { target: { value: "1.000" } });

      expect(getByRole("alert")).toBeInTheDocument();
      expect(getByRole("button", { name: "1000 DUSK" })).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.click(getByRole("button", { name: "1 DUSK" }));

      expect(fields.amount()).toHaveValue("1");
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
        "173.9018 DUSK",
      );
      expect(getSummary(container).at(-1)).toContain("173.9018 DUSK");
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
      const { getByRole } = render(Send, {
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
      expect(getByRole("alert")).toBeInTheDocument();

      // Below one LUX: kept as typed, and refused.
      await fireEvent.input(fields.amount(), {
        target: { value: "0.0000000001" },
      });

      expect(fields.amount()).toHaveValue("0.0000000001");
      expect(fields.review()).toBeDisabled();
      expect(getByRole("alert")).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "1e2" } });

      expect(fields.review()).toBeDisabled();
      expect(getByRole("alert")).toBeInTheDocument();

      // More than there is: said with the balance.
      await fireEvent.input(fields.amount(), { target: { value: "100000" } });

      expect(fields.review()).toBeDisabled();
      expect(getByRole("alert")).toHaveTextContent(
        `${formatDuskExact(baseProps.availableBalance, "en")} DUSK`,
      );
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
        const { container, getByRole } = render(Send, {
          ...baseProps,
          keepForLater,
        });
        const fields = fieldsOf(getByRole);

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          decimal(/** @type {HTMLInputElement} */ (fields.amount()).value),
        ).toBe(formatDuskPlain(allOfIt - keepForLater.lux));
        // Saying what it keeps.
        expect(container).toHaveTextContent("0.05 DUSK");
      });

      it("lets an amount over that go, and says what it leaves too little for", async () => {
        const { getByRole, queryByRole } = render(Send, {
          ...baseProps,
          initialRecipient: otherAccount,
          keepForLater,
        });
        const fields = fieldsOf(getByRole);

        await fireEvent.input(fields.amount(), {
          target: { value: formatDuskPlain(allOfIt - keepForLater.lux) },
        });

        expect(queryByRole("status")).toBeNull();

        await fireEvent.input(fields.amount(), {
          target: { value: formatDuskPlain(allOfIt) },
        });

        expect(getByRole("status")).toBeInTheDocument();
        expect(fields.review()).toBeEnabled();
      });

      it("empties it on Max where there's nothing for it to keep otherwise, and warns", async () => {
        const { getByRole } = render(Send, {
          ...baseProps,
          keepForLater: { ...keepForLater, lux: allOfIt },
        });

        await fireEvent.click(getByRole("button", { name: "Max" }));

        expect(
          decimal(
            /** @type {HTMLInputElement} */ (fieldsOf(getByRole).amount())
              .value,
          ),
        ).toBe(formatDuskPlain(allOfIt));
        expect(getByRole("status")).toBeInTheDocument();
      });

      it("keeps nothing of a shielded send: the public balance isn't touched", async () => {
        const { getByRole, queryByRole } = render(Send, {
          ...baseProps,
          initialRecipient: otherShielded,
          keepForLater,
        });

        await fireEvent.click(getByRole("button", { name: "Max" }));

        // All of it, and nothing said of what it leaves.
        expect(
          decimal(
            /** @type {HTMLInputElement} */ (fieldsOf(getByRole).amount())
              .value,
          ),
        ).toBe(formatDuskPlain(allOfIt));
        expect(queryByRole("status")).toBeNull();
      });

      it("hides the figure with the balances", async () => {
        settingsStore.update((store) => ({ ...store, hideBalances: true }));

        try {
          const { container, getByRole } = render(Send, {
            ...baseProps,
            keepForLater,
          });

          await fireEvent.click(getByRole("button", { name: "Max" }));

          expect(container).not.toHaveTextContent("0.05");
        } finally {
          settingsStore.update((store) => ({ ...store, hideBalances: false }));
        }
      });
    });

    it("should show a memo's hidden characters as codes on its review, and send it as it was typed", async () => {
      const { container, getByRole } = render(Send, {
        ...baseProps,
        initialRecipient: shieldedAddress,
      });
      const fields = fieldsOf(getByRole);
      // What the summary notes of its memo, in words of its own.
      const noted = () =>
        Array.from(
          container.querySelectorAll(".send__summary-memo .memo-text__note"),
          (note) => note.textContent,
        ).join(" ");

      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await fireEvent.input(fields.memo(), {
        target: { value: "pay \u202E0001\u202C" },
      });

      expect(container.querySelector(".send__summary-memo")).toHaveTextContent(
        "pay \\u202e0001\\u202c",
      );
      const hidden = noted();

      expect(hidden).not.toBe("");

      // Nor can a number's digits read as another number unsaid.
      await fireEvent.input(fields.memo(), {
        target: { value: "pay 1\u06605" },
      });

      const mixed = noted();

      expect(mixed).not.toBe("");
      expect(mixed).not.toBe(hidden);

      // Nor one of digits that look like others, as the extension says.
      await fireEvent.input(fields.memo(), {
        target: { value: "Pay \u09EA DUSK" },
      });

      expect(noted()).not.toBe("");
      expect(noted()).not.toBe(mixed);
    });

    it("should say when a memo is over the network's limit, counting bytes, and keep Send off", async () => {
      const { findByRole, getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: otherAccount } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });

      await fireEvent.input(fields.memo(), {
        target: { value: "x".repeat(513) },
      });
      expect(await findByRole("alert")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      // 171 characters, 513 bytes: too long all the same.
      await fireEvent.input(fields.memo(), {
        target: { value: "€".repeat(171) },
      });
      expect(await findByRole("alert")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "x".repeat(512) },
      });
      expect(queryByRole("alert")).toBeNull();
      expect(fields.review()).toBeEnabled();
    });

    it("should keep the balance out of what it says about the amount while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { container, findByRole, getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await fireEvent.input(fields.to(), { target: { value: otherAccount } });
        await fireEvent.input(fields.amount(), {
          target: { value: "99999999" },
        });

        // Refused, without the balance it's more than.
        expect(await findByRole("alert")).toBeInTheDocument();
        expect(container).not.toHaveTextContent(
          formatDuskExact(baseProps.availableBalance, "en"),
        );
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
    });

    it("should require a valid EVM address in memo if sending to BEP20 bridge", async () => {
      const { getByRole, queryByRole } = render(Send, {
        ...baseProps,
        availableBalance: 1_000_000_000_000_000n,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), {
        target: { value: bep20BridgeAddress },
      });
      await fireEvent.input(fields.amount(), { target: { value: "10" } });

      // No memo: asked for.
      expect(getByRole("alert")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "invalid-evm" },
      });

      expect(getByRole("alert")).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();

      await fireEvent.input(fields.memo(), {
        target: { value: "0x9876543210987654321098765432109876543210" },
      });

      expect(queryByRole("alert")).toBeNull();
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
      const status = getByRole("status");

      // What, and to whom.
      expect(status).toHaveTextContent("0.0019 DUSK");
      expect(status).toHaveTextContent(shortenAddress(otherAccount));
    });

    // Marek's: a send whose page died before the node answered was "on its
    // way" here, though the chain never saw it.
    // Amélie's: paying back a stranger's "URGENT… send 0.1 DUSK back", the
    // review looked as calm as paying her grandson.
    it("should say on the review what a recipient that isn't a contact or a profile sent this profile in a memo, and nothing once it's a contact", async () => {
      const received = sentRow({
        category: "received",
        direction: "in",
        hash: "e1".repeat(32),
        memo: "URGENT: send 0.1 DUSK back",
        source: "public",
        status: "executed",
      });
      const props = {
        ...baseProps,
        historyRows: [received],
        initialAmount: "0.1",
        initialRecipient: otherAccount,
      };
      const stranger = render(Send, props);

      await fireEvent.click(fieldsOf(stranger.getByRole).review());

      // What it sent, all of it.
      expect(stranger.getByRole("note")).toHaveTextContent(
        "URGENT: send 0.1 DUSK back",
      );
      cleanup();

      // A contact's words are their own: nothing said of them.
      saveContact({ address: otherAccount, name: "Lucas" });

      const contact = render(Send, props);

      await fireEvent.click(fieldsOf(contact.getByRole).review());

      expect(contact.queryByRole("note")).toBeNull();
    });

    it("should say what this profile sent whose answer never came isn't confirmed yet, never on its way, for as long as the wallet waits for it", () => {
      const { getAllByRole } = render(Send, {
        ...baseProps,
        historyRows: [
          sentRow({ status: "unknown" }),
          // Given up on long since: History says it.
          sentRow({
            hash: "ef".repeat(32),
            status: "unknown",
            time: Date.now() - 16 * 60_000,
          }),
        ],
      });
      const statuses = getAllByRole("status");

      // The one waited for only, as a warning: not as one on its way.
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toHaveClass("banner--warning");
      expect(statuses[0]).toHaveTextContent("0.0019 DUSK");
      expect(statuses[0]).toHaveTextContent(shortenAddress(otherAccount));
    });

    it("should say what's on its way, with no amount while the balances are hidden", () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const { getByRole } = render(Send, {
          ...baseProps,
          historyRows: [sentRow({})],
        });
        const status = getByRole("status");

        expect(status).not.toHaveTextContent("0.0019");
        expect(status).toHaveTextContent(shortenAddress(otherAccount));
      } finally {
        settingsStore.reset();
      }
    });

    it("should warn of the same payment made moments ago, or with the same memo before, when to the second, and let it go all the same", async () => {
      const sent = Date.now() - 20_000;
      const { getByRole } = render(Send, {
        ...baseProps,
        historyRows: [sentRow({ status: "executed", time: sent })],
        initialAmount: "0.0019",
        initialRecipient: otherAccount,
      });

      // What, to whom, and when a block took it, to the second, as its
      // request and its Sent screen say it.
      expect(getByRole("alert")).toHaveTextContent("0.0019 DUSK");
      expect(getByRole("alert")).toHaveTextContent(
        shortenAddress(otherAccount),
      );
      expect(getByRole("alert")).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/);

      // It can be meant: it goes.
      await fireEvent.click(fieldsOf(getByRole).review());

      expect(fieldsOf(getByRole).send()).toHaveTextContent(/0\.0019 DUSK/);

      await afterConfirmDelay();
      await fireEvent.click(fieldsOf(getByRole).send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
      cleanup();
      baseProps.execute.mockClear();

      // Found while the review shows, as from another tab: it's said, and
      // Send takes no press meant for it before.
      const review = render(Send, {
        ...baseProps,
        initialAmount: "0.0019",
        initialRecipient: otherAccount,
      });

      await fireEvent.click(fieldsOf(review.getByRole).review());
      await afterConfirmDelay();

      expect(review.queryByRole("alert")).toBeNull();

      await review.rerender({
        historyRows: [sentRow({ status: "executed", time: sent })],
      });

      expect(review.getByRole("alert")).toHaveTextContent("0.0019 DUSK");
      expect(fieldsOf(review.getByRole).send()).toHaveTextContent(
        /0\.0019 DUSK/,
      );

      await fireEvent.click(fieldsOf(review.getByRole).send());

      expect(baseProps.execute).not.toHaveBeenCalled();

      await afterConfirmDelay();
      await fireEvent.click(fieldsOf(review.getByRole).send());

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

      const paidAlert = request.getByRole("alert");

      expect(paidAlert).toHaveTextContent("0.0019 DUSK");
      expect(paidAlert).toHaveTextContent(shortenAddress(otherAccount));
      expect(paidAlert).toHaveTextContent(/29 Oct/);
      expect(paidAlert).toHaveTextContent(/\d{1,2}:30:00/);
      cleanup();

      // Still on its way, in no block: no time a block's would change.
      const onItsWay = render(Send, {
        ...baseProps,
        historyRows: [sentRow({ memo: "Factura 044", status: "pending" })],
        initialAmount: "0.0019",
        initialMemo: "Factura 044",
        initialRecipient: otherAccount,
      });
      const pendingAlert = onItsWay.getByRole("alert");

      expect(pendingAlert).toHaveTextContent("0.0019 DUSK");
      expect(pendingAlert).toHaveTextContent(shortenAddress(otherAccount));
      expect(pendingAlert).not.toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/);
      cleanup();

      // Its answer never came: it may have gone out, so it's said too.
      const unconfirmed = render(Send, {
        ...baseProps,
        historyRows: [sentRow({ memo: "Factura 044", status: "unknown" })],
        initialAmount: "0.0019",
        initialMemo: "Factura 044",
        initialRecipient: otherAccount,
      });
      const unknownAlert = unconfirmed.getByRole("alert");

      expect(unknownAlert).toHaveTextContent("0.0019 DUSK");
      expect(unknownAlert).toHaveTextContent(shortenAddress(otherAccount));
      expect(unknownAlert).not.toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/);
    });

    /**
     * A send of 0.0019 DUSK to the other account that waits to go out, from
     * `from`, with `memo`, as Send keeps it.
     *
     * @param {{ from?: string, memo?: string }} [options]
     */
    const waitingSend = ({
      from = publicAddress,
      memo = "Factura 044",
    } = {}) => {
      const gate = sendGate();

      keepWaiting({
        address: otherAccount,
        from,
        gate,
        lux: 1_900_000n,
        maxFee: fee,
        memo,
        operation: new Promise(() => {}),
        to: "Lena",
      });

      return gate;
    };

    it("should warn of the same send waiting to go out already, from the same balance, and let it go all the same", async () => {
      const waiting = waitingSend();

      try {
        const { getByRole } = render(Send, {
          ...baseProps,
          initialAmount: "0.0019",
          initialMemo: "Factura 044",
          initialRecipient: otherAccount,
        });

        // What waits, and to whom.
        expect(getByRole("alert")).toHaveTextContent("0.0019 DUSK");
        expect(getByRole("alert")).toHaveTextContent("Lena");

        await fireEvent.click(fieldsOf(getByRole).review());

        expect(fieldsOf(getByRole).send()).toHaveTextContent(/0\.0019 DUSK/);

        await afterConfirmDelay();
        await fireEvent.click(fieldsOf(getByRole).send());

        expect(baseProps.execute).toHaveBeenCalledOnce();
        cleanup();

        // Another memo, or the same from the shielded balance, is another.
        const other = render(Send, {
          ...baseProps,
          initialAmount: "0.0019",
          initialMemo: "Factura 045",
          initialRecipient: otherAccount,
        });

        expect(other.queryByRole("alert")).toBeNull();
        cleanup();

        waiting.cancel();
        waitingSend({ from: shieldedAddress }).cancel();

        const gone = render(Send, {
          ...baseProps,
          initialAmount: "0.0019",
          initialMemo: "Factura 044",
          initialRecipient: otherAccount,
        });

        expect(gone.queryByRole("alert")).toBeNull();
      } finally {
        waiting.cancel();
      }
    });

    it("should take a send that never went out to its review, filled in with it, as asked from where it's said, and send it from there in its place", async () => {
      const { networkName } = get(networkStore);
      const unsent = {
        account: publicAddress,
        at: Date.now() - 60_000,
        id: "unsent-1",
        label: "Lena",
        lux: "1900000",
        memo: "tab dropped 1",
        network: networkName,
        to: otherAccount,
        typed: {
          amount: "0.0019",
          isMax: false,
          isOwn: false,
          memo: "tab dropped 1",
          picks: {},
          to: otherAccount,
        },
      };
      const execute = vi.fn(() => new Promise(() => {}));

      // Asked before Send opens: its review, as it was.
      sendUnsentAgain(unsent);

      const { container, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        execute,
      });

      await vi.waitFor(() =>
        expect(container.querySelector(".send")).toHaveClass("send--review"),
      );

      expect(queryByRole("button", { name: "Review" })).toBeNull();
      expect(getSummary(container)).toStrictEqual([
        expect.stringContaining(shortenAddress(publicAddress)),
        otherAccount,
        "0.0019 DUSK",
        "tab dropped 1",
        expect.stringContaining("0.0219 DUSK"),
      ]);
      expect(execute).not.toHaveBeenCalled();

      await afterConfirmDelay();
      await fireEvent.click(fieldsOf(getByRole).send());

      expect(execute).toHaveBeenCalledWith(
        otherAccount,
        1_900_000n,
        "tab dropped 1",
        gasPrice,
        gasLimit,
        undefined,
        aGate,
      );

      // In its place: the wallet locks as it waits, and it's the one kept.
      cancelWaitingSends(new WalletChangedError());

      await vi.waitFor(() =>
        expect(get(unsentSends)).toStrictEqual([
          expect.objectContaining({ id: "unsent-1", memo: "tab dropped 1" }),
        ]),
      );
      dropUnsent("unsent-1");
      cleanup();

      // Asked while the form shows, over what's typed there.
      const open = render(Send, baseProps);
      const typed = fieldsOf(open.getByRole);

      await fireEvent.input(typed.memo(), { target: { value: "half typed" } });
      sendUnsentAgain({
        ...unsent,
        id: "unsent-2",
        memo: "",
        typed: { ...unsent.typed, memo: "" },
      });

      await vi.waitFor(() =>
        expect(open.container.querySelector(".send")).toHaveClass(
          "send--review",
        ),
      );
      expect(getSummary(open.container)).toStrictEqual([
        expect.stringContaining(shortenAddress(publicAddress)),
        otherAccount,
        "0.0019 DUSK",
        expect.stringContaining("0.0219 DUSK"),
      ]);

      // Another profile's isn't this form's to fill in.
      sendUnsentAgain({ ...unsent, account: otherAccount, id: "unsent-3" });
      cleanup();

      const another = render(Send, baseProps);

      expect(
        /** @type {HTMLInputElement} */ (fieldsOf(another.getByRole).to())
          .value,
      ).toBe("");
    });

    it("should keep a send that never went out on the form, filled in with it, where the form can't send it as it was", async () => {
      const { networkName } = get(networkStore);

      sendUnsentAgain({
        account: publicAddress,
        at: Date.now() - 60_000,
        id: "unsent-4",
        label: "Lena",
        lux: "1900000",
        memo: "too much now",
        network: networkName,
        to: otherAccount,
        typed: {
          amount: "0.0019",
          memo: "too much now",
          to: otherAccount,
        },
      });

      const { container, getByRole } = render(Send, {
        ...baseProps,
        availableBalance: 1_000_000n,
      });

      await tick();

      expect(container.querySelector(".send")).not.toHaveClass("send--review");
      expect(
        [fieldsOf(getByRole).to(), fieldsOf(getByRole).amount()].map(
          (field) => /** @type {HTMLInputElement} */ (field).value,
        ),
      ).toStrictEqual([otherAccount, "0.0019"]);
    });

    it("should keep a send until it goes out, and say no more of one that never went out once the same is sent again", async () => {
      const { networkName } = get(networkStore);
      const { getByRole } = render(Send, {
        ...baseProps,
        execute: vi.fn(() => new Promise(() => {})),
        initialAmount: "0.0019",
        initialMemo: "ward round 1",
        initialRecipient: otherAccount,
      });
      const fields = fieldsOf(getByRole);

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());

      // It waits, and the wallet locks: it never went out.
      cancelWaitingSends(new WalletChangedError());

      await vi.waitFor(() =>
        expect(get(unsentSends)).toStrictEqual([
          expect.objectContaining({
            account: publicAddress,
            label: shortenAddress(otherAccount),
            lux: "1900000",
            memo: "ward round 1",
            network: networkName,
            to: otherAccount,
          }),
        ]),
      );
      cleanup();

      // Typed again and sent: the one that never went out is said no more.
      const again = render(Send, {
        ...baseProps,
        initialAmount: "0.0019",
        initialMemo: "ward round 1",
        initialRecipient: otherAccount,
      });

      await fireEvent.click(fieldsOf(again.getByRole).review());
      await afterConfirmDelay();
      await fireEvent.click(fieldsOf(again.getByRole).send());

      expect(get(unsentSends)).toStrictEqual([]);
    });
  });

  describe("In the payer's currency", () => {
    const prices = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          market_data: {
            current_price: { usd: 0.5 },
            // Today's: a day's time says its day too.
            last_updated: new Date().toISOString(),
          },
        }),
    }));

    beforeEach(() => {
      vi.stubGlobal("fetch", prices);
      settingsStore.update((store) => ({ ...store, currency: "USD" }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      settingsStore.reset();
      setNodeNetwork(null);
      prices.mockClear();
    });

    it("should say what the amount comes to in the payer's money on mainnet, under it once it reads and on the review, with the price's time", async () => {
      setNodeNetwork(networks.mainnet);

      const { container, getByRole } = render(Send, {
        ...baseProps,
        initialAmount: "2",
        initialRecipient: otherAccount,
      });
      const fields = fieldsOf(getByRole);
      const underAmount = () =>
        container.querySelector(".send__in-currency")?.textContent?.trim();

      // The value, and the price's time.
      await vi.waitFor(() =>
        expect(underAmount()).toMatch(/\$1\.00\D.*\d{1,2}:\d{2}/),
      );

      // As the amount is typed: none for one that doesn't read.
      await fireEvent.input(fields.amount(), { target: { value: "2..1" } });

      expect(underAmount()).toBeUndefined();

      await fireEvent.input(fields.amount(), { target: { value: "4" } });

      expect(underAmount()).toMatch(/\$2\.00\D/);

      await fireEvent.click(fields.review());

      expect(
        container.querySelector(".send__summary-currency")?.textContent?.trim(),
      ).toMatch(/\$2\.00\D/);
    });

    it("should say nothing of it on testnet, where DUSK has no value, nor ask for a price", async () => {
      setNodeNetwork(networks.testnet);

      const { container } = render(Send, {
        ...baseProps,
        initialAmount: "2",
        initialRecipient: otherAccount,
      });

      await tick();

      expect(container.querySelector(".send__in-currency")).toBeNull();
      expect(prices).not.toHaveBeenCalled();
    });
  });

  describe("Summary", () => {
    it("should sum the transfer up, the amount exactly and the fee and total as the most they cost", async () => {
      const amount = 2345.5;
      const { container, getByRole } = render(Send, {
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

      // From the shielded balance; the total as the most it costs.
      expect(getSummary(container)).toStrictEqual([
        expect.stringMatching(/shielded/i),
        shortenAddress(shieldedAddress),
        "2,345.5 DUSK",
        "abc-example-memo",
        expect.stringContaining("2,345.52 DUSK"),
      ]);
      expect(
        container.querySelector(".send__summary .gas-fee"),
      ).toHaveTextContent("0.02 DUSK");
      expect(container.querySelector(".send__visible")).toBeNull();

      // Sending is for the review.
      await fireEvent.click(fields.review());

      expect(fields.send()).toHaveTextContent("2,345.5 DUSK");
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

      expect(visible()).toHaveTextContent(/\S/);

      // The review it's sent from is the summary, the line in it.
      await fireEvent.click(fields.review());

      expect(container.querySelector(".send--review")).not.toBeNull();
      expect(visible()).toHaveTextContent(/\S/);
    });
  });

  describe("Send operation", () => {
    vi.useFakeTimers();

    const amount = 567;

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
      { memo, to = shieldedAddress, value = amount } = {},
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

    it("should send nothing on the first press, only from the review, and say what it sent", async () => {
      const { container, getByRole, getByText, queryByRole } = render(
        Send,
        baseProps,
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

      await afterConfirmDelay();
      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        shieldedAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        undefined,
        aGate,
      );

      // What went to whom, and the transaction it follows.
      expect(getByRole("status")).toHaveTextContent("567 DUSK");
      expect(getByRole("status")).toHaveTextContent(
        shortenAddress(shieldedAddress),
      );
      expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
      expect(followTransaction).toHaveBeenCalledWith(
        lastTxId,
        expect.anything(),
      );
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
        shieldedAddress,
      );

      await fireEvent.click(getByRole("button", { name: "Back" }));

      expect(container.querySelector(".send")).not.toHaveClass("send--review");

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());

      expect(baseProps.execute).toHaveBeenCalledOnce();
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

      // What goes, and the most its fee can be.
      expect(getByRole("status")).toHaveTextContent("567 DUSK");
      expect(getByText("0.02 DUSK")).toBeInTheDocument();

      const blockTime = Date.UTC(2026, 9, 28, 0, 34);

      following.resolve({
        blockHeight: 4_687_200n,
        error: null,
        fee: 1_854_795n,
        timestamp: blockTime,
      });
      await vi.advanceTimersToNextTimerAsync();

      // Sent, at its block's time, in its block.
      const sent = getByRole("status");

      expect(sent).toHaveTextContent(
        timeLabel(blockTime, "en", { seconds: true }),
      );
      expect(sent).toHaveTextContent("567 DUSK");
      expect(sent).toHaveTextContent(shortenAddress(shieldedAddress));
      expect(sent).toHaveTextContent("4,687,200");
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
        30_000_000n,
        undefined,
        aGate,
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
      const { getByRole } = render(Send, baseProps);

      await sendWith(getByRole, { memo });

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        shieldedAddress,
        duskToLux(amount),
        memo,
        gasPrice,
        gasLimit,
        undefined,
        aGate,
      );
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

      expect(getSummary(container)).toContain(evmAddress);

      await fireEvent.click(fields.review());
      await afterConfirmDelay();
      await fireEvent.click(fields.send());
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        bep20BridgeAddress,
        duskToLux(amount),
        evmAddress,
        gasPrice,
        gasLimit,
        undefined,
        aGate,
      );
    });

    it("should show an error message if the transfer fails", async () => {
      const errorMessage = "Some error message";

      baseProps.execute.mockRejectedValueOnce(new Error(errorMessage));

      const { getByRole, getByText } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      // The failure's own message.
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
          otherAccount,
        );
        expect(getSummary(container)).toContain("2 DUSK");
        expect(getSummary(container)).toContain("Invoice 118");
      };

      afterEach(() => {
        historyAt({});
      });

      // Chen's: Send it too, on the held send's screen, paid at once, with
      // no Review, while Send it now opens Review first.
      it("should take a send held as its account sent something else while it waited back to its review with Send it too, nothing sent from the hold", async () => {
        /** @type {import("$lib/transactions/sendGate").SendGate | null} */
        let held = null;

        baseProps.execute.mockImplementationOnce(
          // @ts-ignore
          async (_to, _lux, _memo, _price, _limit, _name, gate) => {
            held = gate;
            await gate.ask();

            return new Promise(() => {});
          },
        );

        const { container, getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await sendWith(getByRole, filled);
        await vi.waitFor(() =>
          expect(
            getByRole("button", { name: "Send it too" }),
          ).toBeInTheDocument(),
        );

        await fireEvent.click(getByRole("button", { name: "Send it too" }));

        // Its review, as it was, with nothing sent from the hold.
        await vi.waitFor(() => expectReview(container));
        expect(fields.to()).toHaveValue(otherAccount);
        expect(fields.amount()).toHaveValue("2");
        expect(fields.memo()).toHaveValue("Invoice 118");
        expect(get(/** @type {any} */ (held))).toBe("cancelled");
        expect(baseProps.execute).toHaveBeenCalledOnce();

        // Sent from there: in its place, as a send of its own.
        await afterConfirmDelay();
        await fireEvent.click(fields.send());
        await vi.advanceTimersToNextTimerAsync();

        expect(baseProps.execute).toHaveBeenCalledTimes(2);
        expect(baseProps.execute).toHaveBeenLastCalledWith(
          otherAccount,
          duskToLux(2),
          "Invoice 118",
          gasPrice,
          gasLimit,
          undefined,
          aGate,
        );
      });

      it("should say a send held so is not sent, plainly, with Don't send: nothing left the wallet", async () => {
        baseProps.execute.mockImplementationOnce(
          // @ts-ignore
          async (_to, _lux, _memo, _price, _limit, _name, gate) => {
            await gate.ask();

            return new Promise(() => {});
          },
        );

        const { getByRole, queryByRole } = render(Send, baseProps);

        await sendWith(getByRole, filled);
        await vi.waitFor(() =>
          expect(
            getByRole("button", { name: "Don't send" }),
          ).toBeInTheDocument(),
        );
        await fireEvent.click(getByRole("button", { name: "Don't send" }));

        // Nothing went out: it can be tried again, with nothing for History
        // to say of it.
        await vi.waitFor(() =>
          expect(
            getByRole("button", { name: "Try again" }),
          ).toBeInTheDocument(),
        );
        expect(queryByRole("link", { name: "Open History" })).toBeNull();
        expect(baseProps.execute).toHaveBeenCalledOnce();
      });

      it("should go back to the review with Try again, the address, the amount and the memo kept, when nothing went out", async () => {
        baseProps.execute.mockRejectedValueOnce(
          new TypeError("Failed to fetch"),
        );

        const { container, getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await sendWith(getByRole, filled);

        expect(baseProps.execute).toHaveBeenCalledOnce();

        await fireEvent.click(getByRole("button", { name: "Try again" }));

        expectReview(container);
        expect(fields.to()).toHaveValue(otherAccount);
        expect(fields.amount()).toHaveValue("2");
        expect(fields.memo()).toHaveValue("Invoice 118");

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
          gasLimit,
          undefined,
          aGate,
        );
        expect(getByRole("status")).toHaveTextContent("2 DUSK");
      });

      it("should offer no Try again, and no way back to the form, when it may have gone out", async () => {
        baseProps.execute.mockRejectedValueOnce(
          outcomeUnknown(new TypeError("Failed to fetch")),
        );

        const { container, getByRole, queryByRole } = render(Send, baseProps);

        await sendWith(getByRole, filled);

        // History to check instead, as it may have gone out.
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
        expect(getByRole("status")).toHaveTextContent("2 DUSK");
      });
    });

    it("should show it as sent, following nothing, if the execution promise doesn't resolve with an hash", async () => {
      baseProps.execute.mockResolvedValueOnce(void 0);

      const { getByRole, queryByRole } = render(Send, baseProps);

      await sendWith(getByRole);

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      // Sent, as a send's state says it: not a failure to try again.
      expect(getByRole("status")).toBeInTheDocument();
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
      expect(followTransaction).not.toHaveBeenCalled();
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

    /**
     * Once the summary's To row has the address a name's lookup gave.
     *
     * @param {HTMLElement} container
     * @param {string} address
     */
    const resolvedTo = (container, address) =>
      waitFor(() =>
        expect(getSummary(container)[1]).toContain(shortenAddress(address)),
      );

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
            }),
      );

      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      await resolvedTo(container, nameAccount);
      expect(fields.review()).toBeEnabled();

      // While the new name is looked up, nothing can go to the old address,
      // and nothing says the new name points to it.
      await fireEvent.input(fields.to(), { target: { value: "second.dusk" } });
      expect(fields.review()).toBeDisabled();
      expect(container.textContent).not.toContain(nameAccount);
      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      await fireEvent.click(fields.review());
      expect(container.querySelector(".send")).not.toHaveClass("send--review");
      expect(baseProps.execute).not.toHaveBeenCalled();

      answerNewName({ account: otherAccount, name: "second.dusk" });
      await resolvedTo(container, otherAccount);
      expect(fields.review()).toBeEnabled();
      expect(getSummary(container)[1]).toContain(shortenAddress(otherAccount));
    });

    it("should look a name up afresh when it's entered again, and keep Send off until the answer comes", async () => {
      /** @type {((answer: object) => void)[]} */
      const answers = [];

      baseProps.resolveName.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });
      answers[0]({ account: nameAccount, name: "first.dusk" });
      await resolvedTo(container, nameAccount);
      expect(fields.review()).toBeEnabled();

      // Cleared and entered again: the old answer doesn't come back.
      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      expect(fields.review()).toBeDisabled();
      expect(container.textContent).not.toContain(shortenAddress(nameAccount));

      // Moved meanwhile: the new answer is the one that counts.
      answers[1]({ account: otherAccount, name: "first.dusk" });
      await resolvedTo(container, otherAccount);
      expect(fields.review()).toBeEnabled();
      expect(getSummary(container)[1]).toContain(shortenAddress(otherAccount));
    });

    it("should leave out an older answer for the same name when it comes after a newer one", async () => {
      /** @type {((answer: object) => void)[]} */
      const answers = [];

      baseProps.resolveName.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "" } });
      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });

      answers[1]({ account: otherAccount, name: "first.dusk" });
      await resolvedTo(container, otherAccount);

      answers[0]({ account: nameAccount, name: "first.dusk" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      expect(getSummary(container)[1]).toContain(shortenAddress(otherAccount));
    });

    it("should leave out a late answer for a name that has been replaced", async () => {
      /** @type {(answer: object) => void} */
      let answerFirst = () => {};

      baseProps.resolveName.mockImplementation((input) =>
        input === "first.dusk"
          ? new Promise((resolve) => {
              answerFirst = resolve;
            })
          : Promise.resolve({ account: otherAccount, name: input }),
      );

      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "first.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "second.dusk" } });
      await resolvedTo(container, otherAccount);

      answerFirst({ account: nameAccount, name: "first.dusk" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      expect(getSummary(container)[1]).toContain(shortenAddress(otherAccount));
    });

    it("should send to the account a name resolves to, with its name and address shown", async () => {
      /** @type {(value: DuskNameResolution) => void} */
      let finishLookup = () => {};

      baseProps.resolveName.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
      );

      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: " Alice.dusk " },
      });

      expect(baseProps.resolveName).toHaveBeenCalledExactlyOnceWith(
        "Alice.dusk",
      );
      expect(fieldsOf(getByRole).review()).toBeDisabled();

      finishLookup({ account: nameAccount, name: "alice.dusk" });

      await vi.waitFor(() =>
        expect(getSummary(container)[1]).toBe(
          `alice.dusk ${shortenAddress(nameAccount)}`,
        ),
      );
      expect(
        getAsHTMLElement(container, ".send__card .full-address"),
      ).toHaveTextContent(nameAccount);

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAccount,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk",
        aGate,
      );
    });

    it("should send a shielded transfer to a name with only a shielded address", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { container, getByRole } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      await resolvedTo(container, nameAddress);
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } }),
      );

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk",
        aGate,
      );
    });

    it("should keep Send disabled for a name with only a shielded address while the shielded balance can't pay for a transfer", async () => {
      baseProps.resolveName.mockResolvedValueOnce({
        address: nameAddress,
        name: "alice.dusk",
      });

      const { container, getByRole } = render(Send, {
        ...baseProps,
        shieldedBalance: maxGasFee,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      await resolvedTo(container, nameAddress);

      // An amount that could go otherwise: the shielded balance can't pay.
      await fireEvent.input(fieldsOf(getByRole).amount(), {
        target: { value: "1" },
      });

      expect(fieldsOf(getByRole).review()).toBeDisabled();
    });

    it("should offer both addresses of a name with both, and send to the one picked", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk"),
      );

      const { container, findByRole, getByRole } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      const options = await findByRole("radiogroup");
      const publicOption = getByRole("radio", { name: "Public account" });
      const shieldedOption = getByRole("radio", { name: "Shielded address" });

      // Each with its address; the public account picked first.
      expect(options).toContainElement(publicOption);
      expect(options).toContainElement(shieldedOption);
      expect(publicOption).toHaveAttribute("aria-checked", "true");
      expect(publicOption).toHaveTextContent(shortenAddress(nameAccount));
      expect(publicOption).toHaveAccessibleDescription(
        expect.stringContaining(nameAccount),
      );
      expect(shieldedOption).toHaveAttribute("aria-checked", "false");
      expect(shieldedOption).toHaveAttribute("aria-disabled", "false");
      expect(shieldedOption).toHaveAccessibleDescription(
        expect.stringContaining(nameAddress),
      );
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "account" } }),
      );

      await fireEvent.click(shieldedOption);

      expect(shieldedOption).toBeChecked();
      expect(publicOption).not.toBeChecked();
      expect(keyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { type: "address" } }),
      );
      expect(
        getAsHTMLElement(container, ".send__card .full-address"),
      ).toHaveTextContent(nameAddress);

      await sendIt(getByRole);

      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        nameAddress,
        duskToLux(amount),
        "",
        gasPrice,
        gasLimit,
        "alice.dusk",
        aGate,
      );
    });

    it("should keep a name's shielded address from being picked while the shielded balance can't pay for a transfer", async () => {
      baseProps.resolveName.mockResolvedValueOnce(
        withBothAddresses("alice.dusk"),
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
        withBothAddresses("alice.dusk"),
      );

      const { findByRole, getByRole, rerender } = render(Send, {
        ...baseProps,
        shieldedBalance: maxGasFee + 1n,
      });

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
      expect(fieldsOf(getByRole).review()).toBeEnabled();

      await rerender({ shieldedBalance: maxGasFee });

      expect(shieldedOption).toBeChecked();
      expect(shieldedOption).toHaveAttribute("aria-disabled", "true");
      expect(fieldsOf(getByRole).review()).toBeDisabled();

      await fireEvent.click(getByRole("radio", { name: "Public account" }));

      expect(shieldedOption).not.toBeChecked();
      expect(fieldsOf(getByRole).review()).toBeEnabled();
    });

    it("should report no recipient type, for the page to show the public balance, while the name entered doesn't resolve", async () => {
      const keyChange = vi.fn();

      baseProps.resolveName
        .mockResolvedValueOnce({ address: nameAddress, name: "alice.dusk" })
        .mockResolvedValueOnce({ error: "not-registered", name: "bob.dusk" });

      const { findByRole, getByRole } = render(Send, {
        events: { keyChange },
        props: baseProps,
      });

      /** @param {string} value */
      const enter = (value) =>
        fireEvent.input(fieldsOf(getByRole).to(), { target: { value } });

      /** @param {"account" | "address" | undefined} type */
      const lastReported = (type) =>
        expect(keyChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ detail: { type } }),
        );

      lastReported(undefined);

      await enter("alice.dusk");

      await waitFor(() => lastReported("address"));

      // Not registered, once that's said: none.
      await enter("bob.dusk");

      expect(await findByRole("alert")).toBeInTheDocument();
      lastReported(undefined);

      await enter(shieldedAddress);

      lastReported("address");

      await enter("");

      lastReported(undefined);
    });

    it.each([
      "expired",
      "invalid",
      "lookup-failed",
      "no-address",
      "not-registered",
      "unsupported-network",
    ])(
      "should explain the %s error inline and keep Send disabled",
      async (error) => {
        baseProps.resolveName.mockResolvedValueOnce({
          error,
          name: "alice.dusk",
        });

        const { findByRole, getByRole } = render(Send, baseProps);
        const fields = fieldsOf(getByRole);

        await fireEvent.input(fields.to(), {
          target: { value: "alice.dusk" },
        });
        await fireEvent.input(fields.amount(), { target: { value: "1" } });

        // Said, and nothing can go to it, whatever the amount.
        expect(await findByRole("alert")).toBeInTheDocument();
        expect(fields.review()).toBeDisabled();
      },
    );

    it("should ignore the lookup of a name that is no longer entered", async () => {
      /** @type {(value: DuskNameResolution) => void} */
      let finishFirstLookup = () => {};

      baseProps.resolveName
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishFirstLookup = resolve;
          }),
        )
        .mockResolvedValueOnce({ error: "not-registered", name: "bob.dusk" });

      const { container, findByRole, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk" } });
      await fireEvent.input(fields.to(), { target: { value: "bob.dusk" } });
      finishFirstLookup({ account: nameAccount, name: "alice.dusk" });
      await tick();

      // Bob's answer, and nothing of the account Alice's gave.
      expect(await findByRole("alert")).toBeInTheDocument();
      expect(container.querySelector(".send__card")).toBeNull();
      expect(container.textContent).not.toContain(shortenAddress(nameAccount));
      expect(fields.review()).toBeDisabled();
    });

    it("should block a name that resolves to a blocked address", async () => {
      const [blocked] = networks.mainnet.display.blocklist;

      baseProps.resolveName.mockResolvedValueOnce({
        account: blocked.account,
        name: "alice.dusk",
      });

      const { findByText, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.input(fields.to(), { target: { value: "alice.dusk" } });
      await fireEvent.input(fields.amount(), { target: { value: "1" } });

      // Blocked, for the reason the blocklist gives for it.
      expect(
        await findByText(
          String(getBlocklistedRecipient(blocked.account)?.reason),
        ),
      ).toBeInTheDocument();
      expect(fields.review()).toBeDisabled();
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
          : { error: "not-registered", name: input },
      );

      const { container, findByRole, getByRole, queryByRole } = render(Send, {
        ...baseProps,
        knownNames: ["bram.dusk"],
      });
      const fields = fieldsOf(getByRole);

      // A contact's name, as it's spelled.
      await fireEvent.input(fields.to(), {
        target: { value: "alice-shpo.dusk" },
      });

      expect(
        await findByRole("button", { name: /alice-shop\.dusk/ }),
      ).toBeInTheDocument();

      // A name paid before, taken from the offer.
      await fireEvent.input(fields.to(), { target: { value: "brma.dusk" } });
      await fireEvent.click(await findByRole("button", { name: /bram\.dusk/ }));

      expect(fields.to()).toHaveValue("bram.dusk");
      await resolvedTo(container, otherAccount);

      // Like none of them: no name offered.
      await fireEvent.input(fields.to(), { target: { value: "zed.dusk" } });
      await findByRole("alert");

      expect(queryByRole("button", { name: /\.dusk/ })).toBeNull();
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

      const { container, findByRole, getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(
        await findByRole("button", { name: "Save to contacts" }),
      );
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
        getAsHTMLElement(container, ".send__card-title"),
      ).toHaveTextContent("Alice · alice.dusk");
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
        await findByRole("radio", { name: "Shielded address" }),
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
        getAsHTMLElement(container, ".send__card-title"),
      ).toHaveTextContent("Profile 2 · wallet-both.dusk");
      expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();
    });

    it("should say which account it sends from", async () => {
      const { container } = render(Send, {
        ...baseProps,
        ownAccounts: [
          { address: publicAddress, label: "Profile 1 · wallet-both.dusk" },
        ],
      });

      expect(getSummary(container)[0]).toBe(
        `Profile 1 · wallet-both.dusk ${shortenAddress(publicAddress)}`,
      );
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
        { target: { value: tdi.id } },
      );
      await waitFor(() =>
        expect(baseProps.resolveName).toHaveBeenCalledWith("tdi.dusk"),
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
        await findByRole("button", { name: "Save to contacts" }),
      );

      expect(getByRole("textbox", { name: "Contact name" })).toHaveValue("");
    });

    it("should refuse a contact's name that passes for a .dusk name the recipient isn't", async () => {
      const { getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: otherAccount },
      });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));

      // With a dot above for the point too, naming the name it looks like.
      for (const name of ["alice.dusk", "alice˙dusk"]) {
        await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
          target: { value: name },
        });

        expect(getByRole("alert")).toHaveTextContent("alice.dusk");
        expect(getByRole("button", { name: "Save" })).toBeDisabled();
      }

      expect(listContacts()).toStrictEqual([]);
    });

    it("should offer a contact by name before a .dusk name, which would be somebody else's", async () => {
      saveContact({ address: otherAccount, name: "Alice" });
      saveContact({ address: otherAccount, name: "Jan (flour)" });

      const { getByRole, queryByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);
      /**
       * The offer of a contact, by its name and its address.
       *
       * @param {string} name
       */
      const offer = (name) => (/** @type {string} */ accessible) =>
        accessible.includes(name) &&
        accessible.includes(shortenAddress(otherAccount));

      await fireEvent.input(fields.to(), { target: { value: "alice" } });
      await fireEvent.blur(fields.to());

      expect(getByRole("button", { name: offer("Alice") })).toBeInTheDocument();
      expect(queryByRole("button", { name: /alice\.dusk/ })).toBeNull();

      // A name keeps its spaces, and a word further in counts too.
      await fireEvent.input(fields.to(), { target: { value: "Jan (flour)" } });
      expect(
        getByRole("button", { name: offer("Jan (flour)") }),
      ).toBeInTheDocument();
      await fireEvent.input(fields.to(), { target: { value: "flour" } });
      expect(
        getByRole("button", { name: offer("Jan (flour)") }),
      ).toBeInTheDocument();

      // With no contact by that name, the guess is still offered.
      await fireEvent.input(fields.to(), { target: { value: "bob" } });
      expect(getByRole("button", { name: /bob\.dusk/ })).toBeInTheDocument();

      await fireEvent.input(fields.to(), { target: { value: "alice" } });
      await fireEvent.click(getByRole("button", { name: offer("Alice") }));
      expect(fields.to()).toHaveValue(otherAccount);
    });

    it("should mark a contact whose name looks like another's, with its address, where it's offered and in the list", async () => {
      saveContact({ address: otherAccount, name: "Estudio Marta" });
      // A Cyrillic а, saved by its .dusk name.
      saveContact({
        address: nameAccount,
        duskName: "marta.dusk",
        name: "Estudio M\u0430rta",
      });
      saveContact({ address: otherAccount, name: "Jan (flour)" });

      const { getByRole } = render(Send, baseProps);
      // Each with its address, and the mark after it, in words of its own;
      // Jan's, like no other, with nothing after it.
      const alike = [
        `Estudio Marta · ${shortenAddress(otherAccount)} · `,
        `Estudio M\u0430rta · ${shortenAddress(nameAccount)} · `,
      ];
      const listed = () =>
        Array.from(
          getByRole("combobox", { name: "Send to a contact" }).querySelectorAll(
            "option",
          ),
          (option) => option.textContent ?? "",
        );

      for (const marked of alike) {
        expect(listed().some((text) => text.startsWith(marked))).toBe(true);
      }
      expect(listed()).toContain(
        `Jan (flour) · ${shortenAddress(otherAccount)}`,
      );

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "Estudio" },
      });

      for (const marked of alike) {
        expect(
          getByRole("button", { name: (name) => name.includes(marked) }),
        ).toBeInTheDocument();
      }
    });

    it("should mark a contact whose name looks like another's where it's named once picked, to the review and the Sent screen", async () => {
      // Send takes a click half a second after it shows: on this clock.
      vi.useFakeTimers({ toFake: ["performance"] });
      saveContact({ address: otherAccount, name: "Alice" });

      // A Cyrillic А.
      const lookAlike = saveContact({
        address: nameAccount,
        name: "\u0410lice",
      });
      const { container, getByRole } = render(Send, baseProps);
      const fields = fieldsOf(getByRole);

      await fireEvent.change(
        getByRole("combobox", { name: "Send to a contact" }),
        { target: { value: lookAlike.id } },
      );

      // Named with the mark after it, in words of its own.
      expect(
        getAsHTMLElement(container, ".send__card-title"),
      ).toHaveTextContent(/^\u0410lice · \S/);
      expect(getSummary(container)[1]).toContain("\u0410lice");
      expect(getSummary(container)[1]).toContain(shortenAddress(nameAccount));
      expect(
        container.querySelector(".send__summary .send__summary-alike"),
      ).toBeInTheDocument();

      await fireEvent.input(fields.amount(), { target: { value: "0.001" } });
      await fireEvent.click(fields.review());

      expect(
        container.querySelector(".send__summary-alike"),
      ).toBeInTheDocument();

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: /^Send/ }));

      // What went to whom: by its address too.
      await vi.waitFor(() => {
        const what = container.querySelector(".transaction-status__what");

        expect(what).toHaveTextContent("0.001 DUSK");
        expect(what).toHaveTextContent("\u0410lice");
        expect(what).toHaveTextContent(shortenAddress(nameAccount));
      });
      vi.useRealTimers();
    });

    it("should show a contact's name saved with what can't be seen in it by its codes, and refuse one now", async () => {
      // Saved before such names were refused: it reads as "Profile 2".
      saveContact({ address: otherAccount, name: "\u202E2 eliforP" });

      const { container, getByRole } = render(Send, baseProps);
      const shown = "\\u202e2 eliforP";

      await fireEvent.change(
        getByRole("combobox", { name: "Send to a contact" }),
        { target: { value: listContacts()[0].id } },
      );

      expect(
        getAsHTMLElement(container, ".send__card-title"),
      ).toHaveTextContent(shown);
      expect(getSummary(container)[1]).toBe(
        `${shown} ${shortenAddress(otherAccount)}`,
      );

      // A new one isn't saved.
      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: nameAccount },
      });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "\u202EecilA" },
      });

      expect(getByRole("alert")).toBeInTheDocument();
      expect(getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("should send to a contact picked from the list", async () => {
      saveContact({ address: otherAccount, name: "Cold storage" });

      const { container, getByRole } = render(Send, baseProps);

      await fireEvent.change(
        getByRole("combobox", { name: "Send to a contact" }),
        { target: { value: listContacts()[0].id } },
      );

      expect(fieldsOf(getByRole).to()).toHaveValue(otherAccount);
      expect(
        getAsHTMLElement(container, ".send__card-title"),
      ).toHaveTextContent("Cold storage");
      expect(getSummary(container)[1]).toBe(
        `Cold storage ${shortenAddress(otherAccount)}`,
      );
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

      // Saying so, of the name and the contact.
      const said = await findByRole("status");

      expect(said).toHaveTextContent("tdi.dusk");
      expect(said).toHaveTextContent("TDI");
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
          "Alice · alice.dusk",
        ),
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
        await findByRole("radio", { name: "Shielded address" }),
      );

      // Asked, of the name and the contact of the kind picked.
      const asked = await findByRole("alert");

      expect(asked).toHaveTextContent("alice.dusk");
      expect(asked).toHaveTextContent("Alice (shielded)");

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
        }),
      );

      const { container, getByRole, queryByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: "alice.dusk" },
      });

      // Still looked up: nothing asked, and nothing noted.
      expect(baseProps.resolveName).toHaveBeenCalledWith("alice.dusk");
      expect(queryByRole("alert")).toBeNull();
      expect(getContact(alice.id)).not.toHaveProperty("movedTo");

      finishLookup({ address: otherShielded, name: "alice.dusk" });

      await waitFor(() =>
        expect(container.querySelector(".send__card-title")).toHaveTextContent(
          "Alice · alice.dusk",
        ),
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

      // Asked, of the name and the contact of the kind picked.
      const asked = await findByRole("alert");

      expect(asked).toHaveTextContent("alice.dusk");
      expect(asked).toHaveTextContent("Alice");
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

      // Asked, of the name and the contact, before anything can go.
      const asked = await findByRole("alert");

      expect(asked).toHaveTextContent("alice.dusk");
      expect(asked).toHaveTextContent("Alice");
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
        getAsHTMLElement(container, ".send__card .full-address"),
      ).toHaveTextContent(nameAccount);
      expect(getContact(alice.id)?.address).toBe(otherAccount);

      // Or the saved one, which the field then holds.
      cleanup();

      const again = render(Send, baseProps);

      await fireEvent.input(fieldsOf(again.getByRole).to(), {
        target: { value: "alice.dusk" },
      });
      await fireEvent.click(
        await again.findByRole("button", { name: "The saved address" }),
      );

      expect(fieldsOf(again.getByRole).to()).toHaveValue(otherAccount);
      expect(
        getAsHTMLElement(again.container, ".send__card-title"),
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

      // Asked, of the name and the contact, before anything can go.
      const asked = await findByRole("alert");

      expect(asked).toHaveTextContent("alice.dusk");
      expect(asked).toHaveTextContent("Alice");
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
        "password123",
      );
      await unlockWallets("password123");

      const [{ account, address }] = get(walletStore).profiles;

      // The wallet added is the one open: Wallet 1 is the other.
      await addWallet(
        "scheme spot photo card baby mountain device kick cradle pact join borrow",
        "password123",
      );

      return { account: String(account), address: String(address) };
    };

    /** @param {HTMLElement} container */
    const cardTitle = (container) =>
      container.querySelector(".send__card-title")?.textContent?.trim();

    it("should ask at Save about a contact's name another contact's starts as, and save it only once answered", async () => {
      // Lucas, as saved before, at another address.
      const lucas = saveContact({
        address: bep20BridgeAddress,
        name: "Lucas (petit-fils)",
      });

      try {
        const { getByRole, queryByRole } = render(Send, baseProps);

        await fireEvent.input(fieldsOf(getByRole).to(), {
          target: { value: otherAccount },
        });
        await fireEvent.click(
          getByRole("button", { name: "Save to contacts" }),
        );
        await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
          target: { value: "Lucas" },
        });

        // Asked, naming the contact it starts as, at its address.
        expect(getByRole("alert")).toHaveTextContent("Lucas (petit-fils)");
        expect(getByRole("alert")).toHaveTextContent(
          shortenAddress(bep20BridgeAddress),
        );

        // Typed, Enter, Enter: the question never takes the focus, so the
        // second Enter asks it again, and saves nothing.
        const field = /** @type {HTMLInputElement} */ (
          getByRole("textbox", { name: "Contact name" })
        );

        field.focus();
        await fireEvent.submit(/** @type {HTMLFormElement} */ (field.form));

        expect(findContact(otherAccount)).toBeNull();
        expect(field).toHaveFocus();
        expect(getByRole("button", { name: "Yes, save it" })).not.toHaveFocus();

        await fireEvent.submit(/** @type {HTMLFormElement} */ (field.form));

        expect(findContact(otherAccount)).toBeNull();

        await fireEvent.click(getByRole("button", { name: "Yes, save it" }));

        expect(findContact(otherAccount)).toMatchObject({ name: "Lucas" });
        expect(queryByRole("textbox", { name: "Contact name" })).toBeNull();
      } finally {
        removeContact(lucas.id);
      }
    });

    it("should refuse to save a contact by the name of a profile here", async () => {
      await holdOtherWallet();

      const { getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: otherAccount },
      });
      await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
      await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
        target: { value: "profile 1" },
      });

      // Refused, naming the profile it would pass for.
      expect(getByRole("alert")).toHaveTextContent("Profile 1");
      expect(getByRole("button", { name: "Save" })).toBeDisabled();
    });

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

      expect(toLine()).toBe(`Wallet 1 · Profile 1 ${shortenAddress(account)}`);

      await fireEvent.input(to, { target: { value: "alice.dusk" } });

      await waitFor(() =>
        expect(toLine()).toBe(`alice.dusk ${shortenAddress(account)}`),
      );

      saveContact({ address: account, name: "Rent" });
      await fireEvent.input(to, { target: { value: account } });

      expect(toLine()).toBe(`Rent ${shortenAddress(account)}`);
    });

    it("should offer a profile here by its name before a .dusk name of it, which is somebody else's, and say so of that one", async () => {
      const { account } = await holdOtherWallet();
      const { getByRole, queryByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();

      // The field takes the space out.
      await fireEvent.input(to, { target: { value: "profile1" } });
      await fireEvent.blur(to);

      // The profile, by its name and its address; not its .dusk name.
      await fireEvent.click(
        getByRole("button", {
          name: (name) =>
            name.includes("Wallet 1 · Profile 1") &&
            name.includes(shortenAddress(account)),
        }),
      );

      expect(to).toHaveValue(account);
      expect(queryByRole("button", { name: /profile1\.dusk/ })).toBeNull();

      // Its .dusk name, typed out, is someone else's.
      baseProps.resolveName.mockResolvedValue({
        account: otherAccount,
        name: "profile1.dusk",
      });
      await fireEvent.input(to, { target: { value: "profile1.dusk" } });

      await waitFor(() => {
        const said = getByRole("status");

        expect(said).toHaveTextContent("profile1.dusk");
        expect(said).toHaveTextContent("Profile 1");
      });
    });

    it("should say a .dusk name of a profile's is someone else's only once it's found, going to none of the profiles here, public or shielded", async () => {
      // Both wallets have a Profile 1.
      const { account, address } = await holdOtherWallet();
      const found = Promise.withResolvers();

      madeUpAddresses.add(address);
      baseProps.resolveName.mockReturnValueOnce(found.promise);

      const { container, getByRole, queryByRole } = render(Send, baseProps);
      const to = fieldsOf(getByRole).to();
      /** @param {string} found */
      const toFound = (found) =>
        waitFor(() =>
          expect(getSummary(container)[1]).toContain(shortenAddress(found)),
        );

      await fireEvent.input(to, { target: { value: "profile1.dusk" } });

      // Nothing said of it while it's looked up.
      expect(queryByRole("status")).toBeNull();

      // Wallet 1's Profile 1.
      found.resolve({ account, name: "profile1.dusk" });

      await toFound(account);
      expect(queryByRole("status")).toBeNull();

      // Its shielded address.
      baseProps.resolveName.mockResolvedValue({
        address,
        name: "profile1.dusk",
      });
      await fireEvent.input(to, { target: { value: "" } });
      await fireEvent.input(to, { target: { value: "profile1.dusk" } });

      await toFound(address);
      expect(queryByRole("status")).toBeNull();
    });

    it("should name the profile of the other wallet sent to on the Done screen", async () => {
      const { account } = await holdOtherWallet();
      const { getByRole } = render(Send, baseProps);

      await fireEvent.input(fieldsOf(getByRole).to(), {
        target: { value: account },
      });

      await sendOne(getByRole);

      await waitFor(() => {
        const sending = getByRole("status");

        expect(sending).toHaveTextContent("1 DUSK");
        expect(sending).toHaveTextContent("Wallet 1 · Profile 1");
      });
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

      await waitFor(() => {
        const sending = getByRole("status");

        expect(sending).toHaveTextContent("1 DUSK");
        expect(sending).toHaveTextContent("Rent");
      });
    });
  });
});
