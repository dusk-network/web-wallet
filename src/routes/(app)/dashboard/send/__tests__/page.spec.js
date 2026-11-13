import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { getGasSettings } from "$lib/contracts";
import { formatDusk, formatDuskPlain } from "$lib/dusk/currency";
import { gasPriceStore, networkStore, settingsStore } from "$lib/stores";
import { keepWaiting, sendGate } from "$lib/transactions";
import { feeToKeep } from "$lib/wallet-reserve";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { networks } from "@dusk-network/networks";

import SendPage from "../+page.svelte";

const { resolveDuskName } = vi.hoisted(() => ({ resolveDuskName: vi.fn() }));

const page = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<{ url: URL }> | null} */
  store: null,
  url: new URL("http://localhost/some-base-path/dashboard/send"),
}));

vi.mock("$app/stores", async () => {
  const { readable, writable } = await import("svelte/store");

  page.store = writable({ url: page.url });

  return {
    // No navigation under way.
    navigating: readable(null),
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        /** @type {NonNullable<typeof page.store>} */ (page.store).subscribe(
          run
        ),
    },
  };
});

/** @param {URL} url */
const openAt = (url) => {
  page.url = url;
  page.store?.set({ url });
};

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
  "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

/** @param {HTMLElement} container */
const available = (container) =>
  container.querySelector(".send__amount + .send__hint");

// The profiles' addresses here are made up, so none is two keys, and the
// accounts none a key.
vi.mock("$lib/wallet/isShieldedAddress", () => ({ default: () => true }));
vi.mock("@dusk-network/networks/account", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  isAccount: () => true,
}));

describe("Send page", () => {
  afterEach(() => {
    cleanup();
    resolveDuskName.mockReset();
    settingsStore.reset();
    openAt(new URL("http://localhost/some-base-path/dashboard/send"));
  });

  afterAll(() => {
    vi.doUnmock("$app/stores");
    vi.doUnmock("$lib/dusk-domains");
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
  });

  describe("opened from a link", () => {
    /** @param {string} query */
    const openLink = (query) =>
      openAt(
        new URL(`http://localhost/some-base-path/dashboard/send?${query}`)
      );

    /** @param {(role: string, options: object) => HTMLElement} getByRole */
    const fieldsAre = (getByRole) =>
      ["To", "Amount", /^Memo/].map(
        (name) =>
          /** @type {HTMLInputElement} */ (getByRole("textbox", { name })).value
      );

    afterEach(() => setNodeNetwork(null));

    it("should open filled in, with what the link asks", () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15&memo=Factura+33&network=testnet`);

      const { getByRole } = render(SendPage);

      expect(fieldsAre(getByRole)).toStrictEqual([OTHER, "0.15", "Factura 33"]);
    });

    it("should say a link for another network is one, and fill in nothing", () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15&memo=Factura+33&network=mainnet`);

      const { getByRole, getByText } = render(SendPage);

      expect(
        getByText("This request is for Mainnet. You are on Testnet.")
      ).toBeInTheDocument();
      expect(fieldsAre(getByRole)).toStrictEqual(["", "", ""]);
    });

    it.each([
      [
        "no recipient",
        "amount=0.15&memo=Factura+33",
        "This link doesn't say who to pay. Ask for a new one.",
      ],
      [
        "an empty recipient",
        "to=&amount=0.15",
        "This link doesn't say who to pay. Ask for a new one.",
      ],
      [
        "a network there's no file for",
        `to=${OTHER}&network=nowhere`,
        "This link's network can't be read. Ask for a new one.",
      ],
    ])(
      "should say why a link with %s can't be read, and fill in nothing",
      (_, query, words) => {
        setNodeNetwork(networks.testnet);
        openLink(query);

        const { getByRole, getByText } = render(SendPage);

        expect(getByText(words)).toBeInTheDocument();
        expect(fieldsAre(getByRole)).toStrictEqual(["", "", ""]);
      }
    );

    it("should start the form over for another link while it shows, and keep what it filled in for Send without one, as Back does", async () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15`);

      const { getByRole } = render(SendPage);

      await act(() =>
        openAt(
          new URL(
            `http://localhost/some-base-path/dashboard/send?to=${OTHER}&amount=0.5`
          )
        )
      );

      expect(fieldsAre(getByRole)[1]).toBe("0.5");

      await act(() =>
        openAt(new URL("http://localhost/some-base-path/dashboard/send"))
      );

      expect(fieldsAre(getByRole)).toStrictEqual([OTHER, "0.5", ""]);
    });
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

  it("should count out of Available and Max what the sends waiting to go out from that balance take, and say so", async () => {
    const public_ = currentProfile.account.toString();
    const shielded = currentProfile.address.toString();
    const waiting = (/** @type {string} */ from) => {
      const gate = sendGate();

      keepWaiting({
        address: OTHER,
        from,
        gate,
        lux: 10_000_000n,
        maxFee: 2_500_000n,
        operation: new Promise(() => {}),
        to: "Lena",
      });

      return gate;
    };
    const fromPublic = waiting(public_);
    const fromShielded = waiting(shielded);

    try {
      const { container, getByRole } = render(SendPage);
      const { gasLimit, gasPrice } = getGasSettings(
        "public-transfer",
        get(settingsStore),
        get(gasPriceStore)
      );
      const left = balance.unshielded.value - 12_500_000n;

      expect(available(container)).toHaveTextContent(
        `Available ${formatDusk(left, "en")} DUSK from your public balance, after what's waiting to go out`
      );

      await fireEvent.input(getByRole("textbox", { name: "To" }), {
        target: { value: OTHER },
      });
      await fireEvent.click(getByRole("button", { name: "Max" }));

      // All that's left, less the fee, and what's kept for later as ever.
      expect(getByRole("textbox", { name: "Amount" })).toHaveValue(
        formatDuskPlain(left - gasLimit * gasPrice - get(feeToKeep).lux)
      );

      // Gone out, or called off: all of it again.
      await act(() => fromPublic.handOver());
      await act(() => fromShielded.cancel());

      expect(available(container)).toHaveTextContent(
        `Available ${formatDusk(balance.unshielded.value, "en")} DUSK from your public balance`
      );
      expect(available(container)).not.toHaveTextContent("waiting");
    } finally {
      fromPublic.cancel();
      fromShielded.cancel();
    }
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

  it("should hide the balance it pays from, and what Max fills in, while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(SendPage);
    const { gasLimit, gasPrice } = getGasSettings(
      "public-transfer",
      get(settingsStore),
      get(gasPriceStore)
    );
    const fee = gasLimit * gasPrice;
    const amount = getByRole("textbox", { name: "Amount" });

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

    expect(amount).toHaveValue("••••");
    expect(container).not.toHaveTextContent(
      formatDuskPlain(balance.unshielded.value - fee)
    );
    expect(container.querySelector(".send__summary")).toHaveTextContent(
      /Amount •••• hidden DUSK/
    );
    expect(available(container)).toHaveTextContent(/•••• hidden/);

    // An amount typed shows.
    await fireEvent.input(amount, { target: { value: "1" } });

    expect(amount).toHaveValue("1");
    expect(container.querySelector(".send__summary")).toHaveTextContent(
      /Amount 1 DUSK/
    );
  });

  it("should start from the gas price both wallets pick, the network's median up to five times the lowest, and say the network is busy over it", async () => {
    const BUSY =
      "The network is busy. You can raise the gas price for it to go out sooner.";
    const connect = vi.spyOn(networkStore, "connect");

    /** @param {bigint} median */
    const nodeAsks = async (median) => {
      connect.mockResolvedValue(
        /** @type {any} */ ({
          blocks: { gasPrice: Promise.resolve({ median }) },
        })
      );
      await gasPriceStore.refresh();
    };

    try {
      for (const [median, price, isBusy] of /** @type {const} */ ([
        [900n, 5n, true],
        [2n, 2n, false],
      ])) {
        await nodeAsks(median);

        const { container, getByRole, queryByText } = render(SendPage);
        const { gasLimit } = getGasSettings(
          "public-transfer",
          get(settingsStore),
          get(gasPriceStore)
        );

        await fireEvent.input(getByRole("textbox", { name: "To" }), {
          target: { value: OTHER },
        });
        await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
          target: { value: "1" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));

        expect(
          container.querySelector(".gas-fee__amount-value")
        ).toHaveTextContent(formatDuskPlain(gasLimit * price));

        if (isBusy) {
          expect(queryByText(BUSY)).toBeInTheDocument();
        } else {
          expect(queryByText(BUSY)).toBeNull();
        }

        cleanup();
      }
    } finally {
      // The lowest again, as the other tests start from.
      await nodeAsks(1n);
      connect.mockRestore();
    }
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
    openAt(
      new URL(`http://localhost/some-base-path/dashboard/send?to=${OTHER}`)
    );

    const { getByRole } = render(SendPage);

    expect(getByRole("textbox", { name: "To" })).toHaveValue(OTHER);
  });

  it("should start again with another recipient the address asks for while the page shows", async () => {
    openAt(
      new URL(`http://localhost/some-base-path/dashboard/send?to=${OTHER}`)
    );

    const { getByRole } = render(SendPage);
    // Another account, a key as any a link pays.
    const another =
      "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";

    await act(() =>
      openAt(
        new URL(`http://localhost/some-base-path/dashboard/send?to=${another}`)
      )
    );

    expect(getByRole("textbox", { name: "To" })).toHaveValue(another);
  });
});
