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
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { ProfileGenerator } from "@dusk/w3sper";

import {
  Allocate,
  LiquidStake,
  NativeStake,
  Send,
  Unstake,
} from "$lib/components";
import { afterConfirmDelay, getAsHTMLElement } from "$lib/dusk/test-helpers";
import { networkStore, settingsStore, walletStore } from "$lib/stores";
import { openTestContacts, stubWalletNetwork } from "$lib/test-helpers";
import { outcomeUnknown } from "$lib/transactions";
import { generateMnemonic, getSeedFromMnemonic } from "$lib/wallet";

// The accounts here are made up, so none is a key.
vi.mock("@dusk-network/networks/account", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  isAccount: vi.fn(() => true),
}));

// Each profile its own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

// The transaction sent stays pending.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransaction,
}));

// How the page came to be: Back or Forward, or a link; and where it is,
// where a test says.
const nav = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  navigating: null,
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

// Presses that would leave a page, as SvelteKit tells them before they do.
const navigation = vi.hoisted(() => ({
  /** @type {Array<(navigation: any) => void>} */
  before: [],
  goto: vi.fn(() => Promise.resolve()),
}));

vi.mock("$app/navigation", () => ({
  afterNavigate: () => {},
  /** @param {(navigation: any) => void} listener */
  beforeNavigate: (listener) => {
    navigation.before.push(listener);
  },
  disableScrollHandling: () => {},
  goto: navigation.goto,
  invalidate: () => Promise.resolve(),
  invalidateAll: () => Promise.resolve(),
  preloadCode: () => Promise.resolve(),
  preloadData: () => Promise.resolve(),
  pushState: () => {},
}));

vi.mock("$app/stores", async (importOriginal) => {
  const { get, writable } = await import("svelte/store");
  const original = /** @type {any} */ (await importOriginal());
  const page = writable(null);

  nav.navigating = writable(null);
  nav.page = page;

  return {
    ...original,
    navigating: nav.navigating,
    // As a test says, else as SvelteKit's own.
    page: {
      /** @param {(value: any) => void} run */
      subscribe: (run) =>
        get(page) === null ? original.page.subscribe(run) : page.subscribe(run),
    },
  };
});

const DUSK = 1_000_000_000n;
const HASH = "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const RECIPIENT =
  "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const RECIPIENT_SHIELDED =
  "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6";

/**
 * Whether this tab holds what was typed in any form, as anyone could read it.
 *
 * @param {string} typed
 */
const isKept = (typed) =>
  Object.values({ ...sessionStorage }).some((held) =>
    JSON.stringify(JSON.parse(held)?.values ?? null).includes(typed),
  );

const seed = getSeedFromMnemonic(generateMnemonic());
const generator = new ProfileGenerator(async () => seed);

/** The wallet opens, as it does on unlocking. */
const open = () => walletStore.init(generator);

/**
 * A lock or a reload: the wallet goes before what shows it, then it opens as
 * an unlock opens it.
 */
async function lockAndUnlock() {
  walletStore.reset();
  cleanup();
  await open();
}

/**
 * The other profile from the top bar, with nothing typed since, then a lock or
 * a reload, which comes back to that profile.
 */
async function switchProfileAndUnlock() {
  await walletStore.setCurrentProfile(get(walletStore).profiles[1]);
  walletStore.reset();
  cleanup();
  await walletStore.init(generator, undefined, { profile: 1 });
}

/** Leaving the page in the wallet: the wallet stays open. */
const leave = cleanup;

/**
 * A press that would take the page elsewhere in the wallet, to Home or
 * `to`, as SvelteKit tells the page before it goes: whether the page held
 * it.
 *
 * @param {"goto" | "link" | "popstate"} [type]
 * @param {string} [to]
 */
function goHome(
  type = "link",
  to = "http://localhost/some-base-path/dashboard",
) {
  const cancel = vi.fn();

  for (const listener of navigation.before) {
    listener({
      cancel,
      delta: type === "popstate" ? -1 : undefined,
      to: { url: new URL(to) },
      type,
      willUnload: false,
    });
  }

  return cancel.mock.calls.length > 0;
}

describe("Keeping what's typed in a form that moves money", () => {
  stubWalletNetwork();

  beforeAll(() => openTestContacts());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    await open();
  });

  afterEach(() => {
    cleanup();
    walletStore.reset();
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("Send", () => {
    const sendProps = {
      availableBalance: 1_000n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      publicAddress: "own-public-account",
      resolveName: vi.fn(),
      shieldedAddress: "own-shielded-address",
      shieldedBalance: 500n * DUSK,
    };

    /** @param {{ initialRecipient?: string }} [props] */
    async function typedForm(props) {
      const view = render(Send, { ...sendProps, ...props });

      await fireEvent.input(view.getByRole("textbox", { name: "To" }), {
        target: { value: RECIPIENT },
      });
      await fireEvent.input(view.getByRole("textbox", { name: "Amount" }), {
        target: { value: "2,5" },
      });
      await fireEvent.input(view.getByRole("textbox", { name: /^Memo/ }), {
        target: { value: "Invoice 118" },
      });

      return view;
    }

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const fields = ({ getByRole }) => [
      getByRole("textbox", { name: "To" }),
      getByRole("textbox", { name: "Amount" }),
      getByRole("textbox", { name: /^Memo/ }),
    ];

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const expectTyped = (view) => {
      const [to, amount, memo] = fields(view);

      expect(to).toHaveValue(RECIPIENT);
      expect(amount).toHaveValue("2,5");
      expect(memo).toHaveValue("Invoice 118");
    };

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const expectBlank = (view) => {
      const [to, amount, memo] = fields(view);

      expect(to).toHaveValue("");
      expect(amount).toHaveValue("");
      expect(memo).toHaveValue("");
    };

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    async function press({ getByRole }) {
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: /^Send/ }));
    }

    afterEach(() => {
      sendProps.execute.mockClear();
    });

    it("brings back the address, the amount and the memo after a lock or a reload, as a form to review, with nothing sent", async () => {
      const typed = await typedForm();

      await fireEvent.click(typed.getByRole("button", { name: "Review" }));
      await lockAndUnlock();

      const back = render(Send, sendProps);

      expectTyped(back);
      expect(back.container.querySelector(".send")).not.toHaveClass(
        "send--review",
      );
      expect(sendProps.execute).not.toHaveBeenCalled();
    });

    it("keeps none of it once it goes out, while it's on its way, so that a reload can't send it twice", async () => {
      sendProps.execute.mockReturnValueOnce(new Promise(() => {}));

      await press(await typedForm());

      expect(isKept(RECIPIENT)).toBe(false);
      expect(isKept("Invoice 118")).toBe(false);

      await lockAndUnlock();

      expectBlank(render(Send, sendProps));
    });

    it("keeps none of it once it went out", async () => {
      const sent = await typedForm();

      await press(sent);
      await vi.waitFor(() => expect(sent.getByRole("status")).toBeVisible());

      expect(isKept(RECIPIENT)).toBe(false);

      leave();

      expectBlank(render(Send, sendProps));
    });

    it("brings it back after a send that failed with nothing sent, also after leaving the page, and a reload", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await failed.findByRole("button", { name: "Try again" });

      // Home, from the screen that says it failed.
      leave();

      const back = render(Send, sendProps);

      expectTyped(back);

      await lockAndUnlock();

      expectTyped(render(Send, sendProps));
    });

    it("brings back what was typed over what a link asks, for that link, and not for another", async () => {
      const link = {
        initialAmount: "0.15",
        initialMemo: "Factura 33",
        initialRecipient: RECIPIENT,
      };
      const opened = render(Send, { ...sendProps, ...link });
      const [, amount] = fields(opened);

      expect(amount).toHaveValue("0.15");

      await fireEvent.input(amount, { target: { value: "0.2" } });
      await lockAndUnlock();
      cleanup();

      const back = render(Send, { ...sendProps, ...link });

      expect(fields(back)[1]).toHaveValue("0.2");
      expect(fields(back)[2]).toHaveValue("Factura 33");

      await lockAndUnlock();
      cleanup();

      expect(
        fields(
          render(Send, { ...sendProps, ...link, initialAmount: "0.5" }),
        )[1],
      ).toHaveValue("0.5");
    });

    it("brings nothing back for a link it refuses, so that what wasn't asked for can't be sent, and keeps none of it", async () => {
      await typedForm();
      await lockAndUnlock();

      const problem = "This request is for Mainnet. You are on Testnet.";
      const refused = render(Send, { ...sendProps, initialProblem: problem });

      expectBlank(refused);
      expect(refused.getByText(problem)).toBeInTheDocument();
      expect(refused.getByRole("button", { name: "Review" })).toBeDisabled();
      expect(isKept(RECIPIENT)).toBe(false);
    });

    it("brings it back after a send that failed with nothing sent once its page was left", async () => {
      /** @type {PromiseWithResolvers<string>} */
      const sending = Promise.withResolvers();

      sendProps.execute.mockReturnValueOnce(sending.promise);
      await press(await typedForm());

      expect(isKept(RECIPIENT)).toBe(false);

      // Home, while it waits; then it fails with nothing sent.
      leave();
      sending.reject(new TypeError("Failed to fetch"));
      await vi.waitFor(() => expect(isKept(RECIPIENT)).toBe(true));

      expectTyped(render(Send, sendProps));
    });

    it("lets go of the form brought back after a failed send once it's left again", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await failed.findByRole("button", { name: "Try again" });
      leave();
      render(Send, sendProps);
      leave();

      expectBlank(render(Send, sendProps));
    });

    it("keeps none of it after a send that may have gone out", async () => {
      sendProps.execute.mockRejectedValueOnce(
        outcomeUnknown(new TypeError("Failed to fetch")),
      );

      const failed = await typedForm();

      await press(failed);
      await failed.findByText("Not confirmed");

      expect(isKept(RECIPIENT)).toBe(false);

      leave();

      expectBlank(render(Send, sendProps));
    });

    it("keeps it again from Try again on, and lets it go as it's sent", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await fireEvent.click(
        await failed.findByRole("button", { name: "Try again" }),
      );

      expect(isKept(RECIPIENT)).toBe(true);

      await afterConfirmDelay();
      await fireEvent.click(failed.getByRole("button", { name: /^Send/ }));

      expect(isKept(RECIPIENT)).toBe(false);
    });

    // Amélie's: a payment back to a stranger, left with Back twice, was
    // there again with its 0,1 the next time Send opened.
    it("lets it go as the page is left in the wallet, by a phone's Back or a link: the next Send opens empty", async () => {
      await typedForm();

      // A phone's Back, from the form to Home.
      nav.navigating?.set({ type: "popstate" });
      leave();
      nav.navigating?.set(null);

      // Send, opened again from Home.
      nav.navigating?.set({ type: "link" });

      const again = render(Send, sendProps);

      nav.navigating?.set(null);
      expectBlank(again);
      cleanup();

      // Typed again, and left by a link, as Home's.
      await typedForm();
      nav.navigating?.set({ type: "link" });
      leave();
      nav.navigating?.set(null);

      expectBlank(render(Send, sendProps));
    });

    // Amélie's, decided after round 39: as the extension asks.
    it("asks Leave this payment? before a payment in it is left, Stay the main answer, and lets it go only with Leave", async () => {
      navigation.before = [];
      navigation.goto.mockClear();

      const typed = await typedForm();

      expect(goHome()).toBe(true);

      const question = await typed.findByRole("alertdialog", {
        name: "Leave this payment?",
      });

      expect(question).toHaveTextContent("The form will be cleared.");
      await vi.waitFor(() =>
        expect(typed.getByRole("button", { name: "Stay" })).toHaveFocus(),
      );

      await fireEvent.click(typed.getByRole("button", { name: "Stay" }));

      expect(typed.queryByRole("alertdialog")).toBeNull();
      expectTyped(typed);
      expect(navigation.goto).not.toHaveBeenCalled();

      // A phone's Back asks too; Leave goes where it was going.
      expect(goHome("popstate")).toBe(true);
      await typed.findByRole("alertdialog");

      const back = vi.spyOn(history, "go").mockImplementation(() => {});

      await fireEvent.click(typed.getByRole("button", { name: "Leave" }));

      expect(back).toHaveBeenCalledExactlyOnceWith(-1);
      expect(isKept(RECIPIENT)).toBe(false);

      // Gone, it asks nothing more.
      expect(goHome()).toBe(false);
      back.mockRestore();
    });

    // Codex's, round 40: the search's result for another person opened Send
    // again, at the same path, for another payment, and the one typed went
    // without a word.
    it("asks Leave this payment? as Send opens for another payment, but not as it goes to a step of its own at the same address", async () => {
      const send = new URL("/some-base-path/dashboard/send", location.href);

      navigation.before = [];
      nav.page?.set({ state: {}, url: send });

      try {
        const typed = await typedForm();

        expect(goHome("goto", send.href)).toBe(false);
        expect(goHome("goto", `${send.href}?to=${RECIPIENT_SHIELDED}`)).toBe(
          true,
        );
        expect(
          await typed.findByRole("alertdialog", {
            name: "Leave this payment?",
          }),
        ).toBeInTheDocument();
      } finally {
        // Gone before the page is SvelteKit's own again.
        cleanup();
        nav.page?.set(null);
      }
    });

    // Codex's, round 40: the search opens a result in its own step's place
    // in the browser's history; held up by Leave this payment?, Leave went
    // there as a new step, and Back went to the search again.
    it("goes where a press was going as it was asked once Leave lets it go, in the page's place where it replaced it", async () => {
      const contacts = new URL(
        "/some-base-path/dashboard/contacts",
        location.href,
      );
      const { goto } = await import("$lib/navigation");

      navigation.before = [];

      const typed = await typedForm();

      // As the search opens a result.
      void goto("/dashboard/contacts", { replaceState: true });

      expect(goHome("goto", contacts.href)).toBe(true);
      await typed.findByRole("alertdialog");
      navigation.goto.mockClear();
      await fireEvent.click(typed.getByRole("button", { name: "Leave" }));

      expect(navigation.goto).toHaveBeenCalledExactlyOnceWith(contacts.href, {
        replaceState: true,
      });
    });

    it("asks nothing as an empty form is left, nor as a lock goes, which keeps what's typed", async () => {
      navigation.before = [];
      render(Send, sendProps);

      expect(goHome()).toBe(false);

      cleanup();
      navigation.before = [];
      await typedForm();
      walletStore.reset();

      expect(goHome()).toBe(false);
      expect(isKept(RECIPIENT)).toBe(true);
    });

    it("says what a link filled in is what leaving clears", async () => {
      navigation.before = [];

      const opened = render(Send, {
        ...sendProps,
        initialAmount: "0.15",
        initialMemo: "Factura 33",
        initialRecipient: RECIPIENT,
      });

      expect(goHome()).toBe(true);
      expect(await opened.findByRole("alertdialog")).toHaveTextContent(
        "The form will be cleared.",
      );
    });

    it("says it's your unfinished payment where a lock or a reload brought it back, and clears what it brought for another recipient", async () => {
      await typedForm();

      await lockAndUnlock();

      const back = render(Send, sendProps);

      expectTyped(back);
      expect(back.getByText("Your unfinished payment.")).toBeInTheDocument();

      // Another recipient: what the kept payment held was for its own.
      await fireEvent.input(back.getByRole("textbox", { name: "To" }), {
        target: { value: RECIPIENT_SHIELDED },
      });

      const [, amount, memo] = fields(back);

      expect(amount).toHaveValue("");
      expect(memo).toHaveValue("");
      expect(back.queryByText("Your unfinished payment.")).toBeNull();
    });

    // Amélie's: she chose Chen from Contacts, and the 0,1 meant for a
    // stranger stayed, and would have gone to Chen.
    it("clears what a link filled in for another recipient, but not what was typed over it", async () => {
      const link = {
        initialAmount: "0.15",
        initialMemo: "Factura 33",
        initialRecipient: RECIPIENT,
      };
      const opened = render(Send, { ...sendProps, ...link });
      const [to, amount, memo] = fields(opened);

      await fireEvent.input(memo, { target: { value: "Mine" } });
      await fireEvent.input(to, { target: { value: RECIPIENT_SHIELDED } });

      expect(amount).toHaveValue("");
      expect(memo).toHaveValue("Mine");

      cleanup();

      // The same recipient again, by another means, clears nothing.
      const again = render(Send, { ...sendProps, ...link });

      await fireEvent.input(fields(again)[0], { target: { value: "" } });
      await fireEvent.input(fields(again)[0], {
        target: { value: RECIPIENT },
      });

      expect(fields(again)[1]).toHaveValue("0.15");
    });

    it("brings nothing back with Back once it went out", async () => {
      const typed = await typedForm();

      await press(typed);

      expect(isKept(RECIPIENT)).toBe(false);

      leave();
      nav.navigating?.set({ type: "popstate" });

      const back = render(Send, sendProps);

      nav.navigating?.set(null);
      expectBlank(back);
    });

    it("keeps it only for the wallet, profile and network it was typed on", async () => {
      await typedForm();
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { profile: 1 });

      expectBlank(render(Send, sendProps));
      cleanup();

      await typedForm();
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { key: "another" });

      expectBlank(render(Send, sendProps));
    });

    it("follows the profile the form moves to", async () => {
      const typed = await typedForm();
      const { profiles } = get(walletStore);

      await walletStore.setCurrentProfile(profiles[1]);
      await typed.rerender({ publicAddress: "own-other-account" });
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { profile: 1 });

      expectTyped(render(Send, sendProps));
    });

    it("leaves what a link names first, and comes back to it as typed", async () => {
      await typedForm();
      walletStore.reset();
      cleanup();
      await open();

      sendProps.resolveName.mockResolvedValue({
        error: "not-registered",
        name: "bob.dusk",
      });

      // A link to someone else, in the same tab.
      const linked = render(Send, {
        ...sendProps,
        initialRecipient: "bob.dusk",
      });

      expect(linked.getByRole("textbox", { name: "To" })).toHaveValue(
        "bob.dusk",
      );
      expect(linked.getByRole("textbox", { name: "Amount" })).toHaveValue("");
      cleanup();

      // Typed from that link, then a lock: the same link brings it back.
      const fromLink = await typedForm({ initialRecipient: "bob.dusk" });

      expect(fromLink.getByRole("textbox", { name: "To" })).toHaveValue(
        RECIPIENT,
      );

      await lockAndUnlock();

      expectTyped(render(Send, { ...sendProps, initialRecipient: "bob.dusk" }));
      sendProps.resolveName.mockReset();
    });

    it("keeps Max's amount hidden with the balances, and edited gas, and which address of a name was picked", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        sendProps.resolveName.mockResolvedValue({
          account: RECIPIENT,
          address: RECIPIENT_SHIELDED,
          name: "alice.dusk",
        });

        const typed = render(Send, sendProps);

        await fireEvent.input(typed.getByRole("textbox", { name: "To" }), {
          target: { value: "alice.dusk" },
        });
        await fireEvent.click(
          await typed.findByRole("radio", { name: "Shielded address" }),
        );
        await fireEvent.click(typed.getByRole("button", { name: "Max" }));
        await fireEvent.click(typed.getByRole("button", { name: "Edit" }));
        await fireEvent.input(typed.getByLabelText(/gas limit/i), {
          target: { value: "30000000" },
        });
        await lockAndUnlock();

        const back = render(Send, sendProps);

        expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue(
          "••••",
        );
        expect(
          await back.findByRole("radio", { name: "Shielded address" }),
        ).toBeChecked();
        expect(
          getAsHTMLElement(back.container, ".send__summary .gas-fee"),
        ).toHaveTextContent("0.03 DUSK");
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
        sendProps.resolveName.mockReset();
      }
    });

    it("keeps nothing that reads as a recovery phrase", async () => {
      const phrase = generateMnemonic();
      const typed = render(Send, sendProps);

      await fireEvent.input(typed.getByRole("textbox", { name: "Amount" }), {
        target: { value: "1" },
      });
      await fireEvent.input(typed.getByRole("textbox", { name: /^Memo/ }), {
        target: { value: phrase },
      });

      expect(isKept(phrase)).toBe(false);
      expect(isKept(phrase.split(" ")[0])).toBe(false);

      await lockAndUnlock();

      const back = render(Send, sendProps);

      expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue("1");
      expect(back.getByRole("textbox", { name: /^Memo/ })).toHaveValue("");
    });
  });

  describe("native staking", () => {
    const stakeProps = {
      availableBalance: 2_000n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 35_000_000n,
        gasLimitUpper: 1_000_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      minimumStake: 1_000n * DUSK,
      unstakeFee: 50_000_000n,
    };

    it("keeps what's typed through a switch of profile with the form still open, for the profile a lock comes back to", async () => {
      const typed = render(NativeStake, stakeProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "1200" },
      });
      await switchProfileAndUnlock();

      expect(
        render(NativeStake, stakeProps).getByLabelText("Amount"),
      ).toHaveValue("1200");
    });

    it("brings the amount back after a lock or a failed stake, and lets it go as it's staked", async () => {
      const typed = render(NativeStake, stakeProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "1200" },
      });
      await lockAndUnlock();

      const back = render(NativeStake, stakeProps);

      expect(back.getByLabelText("Amount")).toHaveValue("1200");

      /** @type {PromiseWithResolvers<string>} */
      const sending = Promise.withResolvers();

      stakeProps.execute.mockReturnValueOnce(sending.promise);
      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: /^Stake 1,200/ }));

      expect(isKept("1200")).toBe(false);

      sending.reject(new TypeError("Failed to fetch"));
      await back.findByRole("button", { name: "Try again" });

      expect(isKept("1200")).toBe(true);

      leave();

      const failed = render(NativeStake, stakeProps);

      expect(failed.getByLabelText("Amount")).toHaveValue("1200");

      await fireEvent.click(failed.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        failed.getByRole("button", { name: /^Stake 1,200/ }),
      );
      leave();

      expect(
        render(NativeStake, stakeProps).getByLabelText("Amount"),
      ).toHaveValue("");
    });
  });

  describe("liquid staking", () => {
    const status = {
      contracts: {
        hub: "aa".repeat(32),
        pool: POOL,
        stDusk: "dd".repeat(32),
        substrate: "cc".repeat(32),
      },
      error: "",
      fees: {
        deposit: { denominator: 400n, numerator: 1n },
        reward: { denominator: 100n, numerator: 15n },
      },
      flags: { maintenance: false, synchronization: false },
      pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
      position: { balance: 15n * DUSK, stDusk: 4n * DUSK },
      source: "hub",
    };
    const limits = {
      gasLimitLower: 2_500_000n,
      gasLimitUpper: 1_000_000_000n,
      gasPriceLower: 1n,
    };
    const liquidProps = {
      availableBalance: 172n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gas: {
        stake: { limits, settings: { gasLimit: 5_000_000n, gasPrice: 1n } },
        unstake: { limits, settings: { gasLimit: 10_000_000n, gasPrice: 1n } },
      },
      onRetry: vi.fn(),
      recheck: vi.fn(async () => status),
      sozu: { error: null, loading: false, status },
    };
    /** @type {any} */
    const liquidView = LiquidStake;

    it("keeps what's typed through a switch of profile with the form still open, for the profile a lock comes back to", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "7" },
      });
      await switchProfileAndUnlock();

      expect(
        render(liquidView, liquidProps).getByLabelText("Amount"),
      ).toHaveValue("7");
    });

    it("keeps what's typed as the form is left by the Staking link above it, for its next opening", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "7" },
      });
      nav.navigating?.set({ type: "link" });
      leave();
      nav.navigating?.set(null);

      expect(
        render(liquidView, liquidProps).getByLabelText("Amount"),
      ).toHaveValue("7");
    });

    it("brings back each tab's amount and the tab it was on, and lets them go as one is sent", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "7" },
      });
      await fireEvent.click(typed.getByRole("tab", { name: "Unstake" }));
      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "3" },
      });
      await lockAndUnlock();

      const back = render(liquidView, liquidProps);

      expect(back.getByLabelText("Amount")).toHaveValue("3");

      await fireEvent.click(back.getByRole("tab", { name: "Stake" }));

      expect(back.getByLabelText("Amount")).toHaveValue("7");

      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        back.getByRole("button", { name: "Stake 7 DUSK with Sozu" }),
      );
      await vi.waitFor(() => expect(liquidProps.execute).toHaveBeenCalled());

      expect(isKept("7")).toBe(false);
    });

    it("leaves it for a link to the other action", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "7" },
      });
      await lockAndUnlock();

      const linked = render(liquidView, {
        ...liquidProps,
        action: "unstake",
      });

      expect(linked.getByLabelText("Amount")).toHaveValue("");
    });
  });

  describe("unstake and claim", () => {
    const unstakeProps = {
      availableBalance: 100n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      maxWithdrawAmount: 278n * DUSK,
      minStakeRequirement: 1n * DUSK,
      operationCtaIconPath: "",
      operationCtaLabel: "Unstake",
      operationOverviewLabel: "Amount to unstake",
    };

    it("brings back an amount typed, not the one it starts with, and lets it go as it's sent", async () => {
      const typed = render(Unstake, unstakeProps);

      expect(isKept("278")).toBe(false);

      await fireEvent.input(typed.getByRole("textbox", { name: "Amount" }), {
        target: { value: "12" },
      });
      await lockAndUnlock();

      const back = render(Unstake, unstakeProps);

      expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue("12");

      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Unstake" }));

      expect(unstakeProps.execute).toHaveBeenCalledOnce();
      expect(isKept("12")).toBe(false);
    });
  });

  describe("shield and unshield", () => {
    const allocateProps = {
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      shieldedAddress: "own-shielded-address",
      shieldedBalance: { spendable: 2_000n * DUSK, value: 2_000n * DUSK },
      unshieldedAddress: "own-public-account",
      unshieldedBalance: 1_000n * DUSK,
    };

    it("starts its fields, and reads what it brings back, in the language set, whatever the browser's", async () => {
      settingsStore.update((store) => ({ ...store, language: "de-DE" }));

      try {
        const typed = render(Allocate, {
          ...allocateProps,
          shieldedBalance: {
            spendable: 2_000_123_000_000n,
            value: 2_000_123_000_000n,
          },
        });

        expect(navigator.language).not.toMatch(/^de/);
        expect(
          typed.getByRole("textbox", { name: "Shielded amount" }),
        ).toHaveValue("2000,123");

        await fireEvent.input(
          typed.getByRole("textbox", { name: "Shielded amount" }),
          { target: { value: "2500,5" } },
        );
        await lockAndUnlock();

        const back = render(Allocate, allocateProps);

        expect(
          back.getByRole("textbox", { name: "Shielded amount" }),
        ).toHaveValue("2500,5");
        expect(
          back.getByRole("textbox", { name: "Public amount" }),
        ).toHaveValue("499,5");
      } finally {
        settingsStore.reset();
      }
    });

    it("brings the amount back in the field it was typed in, the other worked out again, and lets it go as it's sent", async () => {
      const typed = render(Allocate, allocateProps);

      await fireEvent.input(
        typed.getByRole("textbox", { name: "Shielded amount" }),
        { target: { value: "2500" } },
      );
      await lockAndUnlock();

      const back = render(Allocate, allocateProps);

      expect(
        back.getByRole("textbox", { name: "Shielded amount" }),
      ).toHaveValue("2500");
      expect(back.getByRole("textbox", { name: "Public amount" })).toHaveValue(
        "500",
      );

      const shield = vi
        .spyOn(walletStore, "shield")
        .mockReturnValue(new Promise(() => {}));

      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        back.getByRole("button", { name: /^(Shield|Unshield) / }),
      );

      expect(shield).toHaveBeenCalledOnce();
      expect(isKept("2500")).toBe(false);

      shield.mockRestore();
    });
  });

  it("goes by the network too", async () => {
    const stakeProps = {
      availableBalance: 2_000n * DUSK,
      execute: vi.fn(),
      gasLimits: {
        gasLimitLower: 35_000_000n,
        gasLimitUpper: 1_000_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      minimumStake: 1_000n * DUSK,
      unstakeFee: 50_000_000n,
    };
    const typed = render(NativeStake, stakeProps);

    await fireEvent.input(typed.getByLabelText("Amount"), {
      target: { value: "1200" },
    });

    const networks = vi
      .spyOn(networkStore, "subscribe")
      .mockImplementation((run) => {
        run(/** @type {any} */ ({ networkName: "another network" }));

        return () => {};
      });

    await lockAndUnlock();

    expect(
      render(NativeStake, stakeProps).getByLabelText("Amount"),
    ).toHaveValue("");

    networks.mockRestore();
  });
});
