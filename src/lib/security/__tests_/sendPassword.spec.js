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
import { Gas, Network, ProfileGenerator } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";

import { TransactionResult } from "$lib/components";
import { SendPasswordDialog } from "$lib/containers/Wallets";
import {
  InvalidPasswordError,
  SendPasswordDeclinedError,
  WalletChangedError,
} from "$lib/errors";
import { walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { stubWalletNetwork } from "$lib/test-helpers";
import { generateMnemonic, getSeedFromMnemonic } from "$lib/wallet";
import vault from "$lib/vault";

import {
  cancelSendPassword,
  sendPasswordAsk,
  sendPasswordFor,
  sendPasswordLimit,
  setSendPasswordLimit,
} from "../sendPassword";

const DUSK = 1_000_000_000n;
const PASSWORD = "the password here";
const PHRASE =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";
const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";

/** A transaction's gas: what it can cost at most, here 0.01 DUSK. */
const gas = new Gas({ limit: 10_000_000n, price: 1n });

describe("the password on big sends", () => {
  const executeSpy = vi.spyOn(Network.prototype, "execute");

  stubWalletNetwork();

  beforeAll(async () => {
    const seed = getSeedFromMnemonic(generateMnemonic());

    setNodeNetwork(networks.testnet);
    await walletStore.init(new ProfileGenerator(async () => seed));
    await vi.waitUntil(() => !get(walletStore).syncStatus.isInProgress);
  });

  beforeEach(async () => {
    executeSpy.mockClear();
    await vault.setUp(PHRASE, PASSWORD);
    setSendPasswordLimit(DUSK);
  });

  afterEach(async () => {
    cleanup();
    cancelSendPassword();
    setSendPasswordLimit(null);
    await vault.clear();
  });

  afterAll(() => {
    walletStore.reset();
    vi.restoreAllMocks();
  });

  /** What's asking now. */
  const asked = () => get(sendPasswordAsk);

  /**
   * Whether a send asks for the password, and stays unsent until it's given.
   *
   * @param {() => Promise<unknown>} send
   */
  async function asks(send) {
    executeSpy.mockClear();

    const sending = send();

    if (!asked()) {
      await sending.catch(() => {});

      return false;
    }

    expect(executeSpy).not.toHaveBeenCalled();

    asked()?.cancel();

    await expect(sending).rejects.toBeInstanceOf(SendPasswordDeclinedError);
    expect(executeSpy).not.toHaveBeenCalled();

    return true;
  }

  /** @type {Array<[string, (amount: bigint) => Promise<unknown>]>} */
  const movingOut = [
    ["a transfer", (lux) => walletStore.transfer(ACCOUNT, lux, "", gas)],
    ["a stake", (lux) => walletStore.stake(lux, gas)],
    ["a stake added to", (lux) => walletStore.topUpStake(lux, gas)],
    ["a stake with Sozu", (lux) => walletStore.stakeWithSozu(POOL, lux, gas)],
    ["a shield", (lux) => walletStore.shield(lux, gas)],
    ["an unshield", (lux) => walletStore.unshield(lux, gas)],
    [
      "a deposit to DuskEVM",
      (lux) =>
        walletStore.depositEvmFunctionCall(`0x${"22".repeat(20)}`, lux, gas),
    ],
  ];

  it.each(movingOut)(
    "asks before %s above the amount, with its fee, and before anything of it is made",
    async (_, send) => {
      expect(await asks(() => send(2n * DUSK))).toBe(true);

      // With the most its fee can be, what's taken is above the amount.
      expect(await asks(() => send(DUSK))).toBe(true);
    }
  );

  it.each(movingOut)("asks nothing below the amount: %s", async (_, send) => {
    expect(await asks(() => send(DUSK - gas.total))).toBe(false);
  });

  it.each(
    /** @type {Array<[string, () => Promise<unknown>]>} */ ([
      ["an unstake", () => walletStore.unstake(5n * DUSK, gas)],
      ["a claim", () => walletStore.claimRewards(5n * DUSK, gas)],
      [
        "an unstake from Sozu",
        () => walletStore.unstakeFromSozu(POOL, 5n * DUSK, gas),
      ],
      [
        "a withdrawal's proof or claim",
        () =>
          walletStore.sendDuskEvmWithdrawalCall(
            {
              contractId: POOL,
              deposit: 0n,
              fnArgs: new Uint8Array(),
              fnName: "prove",
            },
            gas
          ),
      ],
    ])
  )(
    "asks nothing for what comes back, as only its fee goes out, unless that's above the amount: %s",
    async (_, send) => {
      expect(await asks(send)).toBe(false);

      setSendPasswordLimit(gas.total - 1n);

      expect(await asks(send)).toBe(true);
    }
  );

  it("goes on with the right password only, checked against the vault", async () => {
    executeSpy.mockResolvedValue(
      /** @type {any} */ ({ hash: "ab".repeat(32), nonce: 1n })
    );

    const sending = walletStore.transfer(ACCOUNT, 2n * DUSK, "", gas);

    await expect(asked()?.answer("not the password")).rejects.toBeInstanceOf(
      InvalidPasswordError
    );

    // Still asking, with nothing sent.
    expect(asked()).not.toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();

    await asked()?.answer(PASSWORD);

    expect(asked()).toBeNull();
    await expect(sending).resolves.toMatchObject({ hash: "ab".repeat(32) });
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("takes only a password that opens the wallet open", async () => {
    await vault.clear();

    const wallet = await vault.setUp(PHRASE, PASSWORD);
    const asking = sendPasswordFor(2n * DUSK, wallet.id);

    await expect(asked()?.answer("another password")).rejects.toBeInstanceOf(
      InvalidPasswordError
    );

    await asked()?.answer(PASSWORD);
    await expect(asking).resolves.toBeUndefined();

    const elsewhere = sendPasswordFor(2n * DUSK, "not a wallet here");

    await expect(asked()?.answer(PASSWORD)).rejects.toBeInstanceOf(
      InvalidPasswordError
    );

    cancelSendPassword();
    await expect(elsewhere).rejects.toBeInstanceOf(SendPasswordDeclinedError);
  });

  it("asks nothing while it's off, as it is unless it's turned on", async () => {
    setSendPasswordLimit(null);

    expect(sendPasswordLimit()).toBeNull();
    expect(sendPasswordFor(1_000n * DUSK, "")).toBeNull();
    expect(await asks(() => walletStore.stake(1_000n * DUSK, gas))).toBe(false);
  });

  it("asks nothing of a wallet without a password: there's none to check", async () => {
    await vault.clear();

    expect(sendPasswordFor(1_000n * DUSK, "")).toBeNull();
    expect(asked()).toBeNull();
  });

  it("asks on every send when what's kept can't be read, rather than turn it off", () => {
    localStorage.setItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-send-password`, "?");

    expect(sendPasswordLimit()).toBe(0n);
  });

  it("reads the amount as each send begins, as another tab may have changed it", async () => {
    expect(sendPasswordFor(DUSK / 2n, "")).toBeNull();

    localStorage.setItem(
      `${CONFIG.LOCAL_STORAGE_APP_KEY}-send-password`,
      String(DUSK / 4n)
    );

    const asking = sendPasswordFor(DUSK / 2n, "");

    expect(asking).not.toBeNull();

    cancelSendPassword();
    await expect(asking).rejects.toBeInstanceOf(SendPasswordDeclinedError);
  });

  it("stops asking once the wallet locks or another opens, with nothing sent", async () => {
    const seed = getSeedFromMnemonic(generateMnemonic());
    const stopped = expect(
      walletStore.transfer(ACCOUNT, 2n * DUSK, "", gas)
    ).rejects.toBeInstanceOf(WalletChangedError);

    expect(asked()).not.toBeNull();

    await walletStore.init(new ProfileGenerator(async () => seed));

    expect(asked()).toBeNull();
    await stopped;
    expect(executeSpy).not.toHaveBeenCalled();
  });

  describe("the dialog", () => {
    /** Opens the dialog on a send above the amount. */
    function openDialog() {
      const sending = sendPasswordFor(2n * DUSK, "");
      const view = render(SendPasswordDialog, {
        ask: /** @type {import("../sendPassword").SendPasswordAsk} */ (asked()),
      });

      return { ...view, sending };
    }

    /** @param {HTMLElement} container */
    const form = (container) =>
      /** @type {HTMLFormElement} */ (container.querySelector("form"));

    it("says why it asks, with the amount chosen, and takes the focus", async () => {
      const { getByLabelText, getByRole, sending } = openDialog();

      expect(
        getByRole("dialog", { name: "Enter your password" })
      ).toHaveTextContent("This is above the 1 DUSK you set in Settings.");
      await vi.waitFor(() =>
        expect(getByLabelText("Password you unlock with")).toHaveFocus()
      );

      cancelSendPassword();
      await expect(sending).rejects.toBeInstanceOf(SendPasswordDeclinedError);
    });

    it("says a wrong password, stays and forgets what was typed, and goes on with the right one", async () => {
      const { container, findByRole, getByLabelText, sending } = openDialog();
      const field = getByLabelText("Password you unlock with");

      await fireEvent.input(field, { target: { value: "not the password" } });
      await fireEvent.submit(form(container));

      expect(await findByRole("alert")).toHaveTextContent("Wrong password.");
      expect(field).toHaveValue("");
      expect(asked()).not.toBeNull();
      await vi.waitFor(() => expect(field).toHaveFocus());

      await fireEvent.input(field, { target: { value: PASSWORD } });
      await fireEvent.submit(form(container));

      await expect(sending).resolves.toBeUndefined();
      expect(asked()).toBeNull();
    });

    it("asks for it when none is typed, without checking", async () => {
      const check = vi.spyOn(vault, "check");
      const { container, findByRole, sending } = openDialog();

      await fireEvent.submit(form(container));

      expect(await findByRole("alert")).toHaveTextContent(
        "Enter your password."
      );
      expect(check).not.toHaveBeenCalled();

      check.mockRestore();
      cancelSendPassword();
      await expect(sending).rejects.toBeInstanceOf(SendPasswordDeclinedError);
    });

    it.each([
      [
        "Cancel",
        (/** @type {ReturnType<typeof openDialog>} */ view) =>
          fireEvent.click(view.getByRole("button", { name: "Cancel" })),
      ],
      [
        "Escape",
        (/** @type {ReturnType<typeof openDialog>} */ view) =>
          fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" }),
      ],
    ])("stops the send with %s", async (_, press) => {
      const view = openDialog();

      await press(view);

      await expect(view.sending).rejects.toBeInstanceOf(
        SendPasswordDeclinedError
      );
      expect(asked()).toBeNull();
    });

    it("keeps the focus in it with Tab", async () => {
      const { getByLabelText, getByRole, sending } = openDialog();
      const field = getByLabelText("Password you unlock with");
      const confirm = getByRole("button", { name: "Confirm" });

      confirm.focus();
      await fireEvent.keyDown(confirm, { key: "Tab" });

      expect(field).toHaveFocus();

      await fireEvent.keyDown(field, { key: "Tab", shiftKey: true });

      expect(confirm).toHaveFocus();

      cancelSendPassword();
      await expect(sending).rejects.toBeInstanceOf(SendPasswordDeclinedError);
    });
  });

  it("says a send it stopped wasn't sent, with Try again and no word of failure", async () => {
    const { findByText, getByRole, queryByText } = render(TransactionResult, {
      maxFee: 1n,
      onRetry: () => {},
      operation: Promise.reject(new SendPasswordDeclinedError()),
    });

    expect(await findByText("Not sent")).toBeInTheDocument();
    expect(
      await findByText("It waits for your password, so nothing was sent.")
    ).toBeInTheDocument();
    expect(queryByText("Transaction failed")).toBeNull();
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("isn't fooled by another tab's copy of the settings, which it doesn't live in", async () => {
    const { settingsStore } = await import("$lib/stores");

    setSendPasswordLimit(DUSK);
    settingsStore.update((store) => ({ ...store, darkMode: !store.darkMode }));

    expect(sendPasswordLimit()).toBe(DUSK);
  });
});
