import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import { ShieldedPausedNotice } from "..";

const { mockedNetworkStore } = await vi.hoisted(async () => {
  const { default: mockReadableStore } =
    await import("$lib/dusk/test-helpers/mockReadableStore");

  return {
    mockedNetworkStore: mockReadableStore({
      connected: true,
      networkName: "testnet",
    }),
  };
});

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    networkStore: { ...original.networkStore, ...mockedNetworkStore },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

describe("ShieldedPausedNotice", () => {
  const initialNetworkState = mockedNetworkStore.getMockedStoreValue();
  const initialWalletState = mockedWalletStore.getMockedStoreValue();
  const balanceLine =
    "Your shielded DUSK stays where it is until they're back.";

  /** @param {bigint} value */
  const setShieldedBalance = (value) => {
    mockedWalletStore.setMockedStoreValue({
      ...initialWalletState,
      balance: {
        ...initialWalletState.balance,
        shielded: { spendable: value, value },
      },
    });
  };

  beforeEach(() => {
    mockedNetworkStore.setMockedStoreValue(initialNetworkState);
    mockedWalletStore.setMockedStoreValue(initialWalletState);
  });

  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("should render a neutral notice naming the network and keeping the shielded balance in mind", () => {
    const { container, getByText } = render(ShieldedPausedNotice);

    expect(
      getByText("Shielded transactions are paused on Testnet.")
    ).toBeInTheDocument();
    expect(getByText(balanceLine)).toBeInTheDocument();
    expect(container.querySelector(".banner--info")).toBeInTheDocument();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should name the network as the wallet shows it", () => {
    mockedNetworkStore.setMockedStoreValue({
      connected: true,
      networkName: "mainnet",
    });

    const { getByText } = render(ShieldedPausedNotice);

    expect(
      getByText("Shielded transactions are paused on Mainnet.")
    ).toBeInTheDocument();
  });

  it("should say 'this network' when the wallet doesn't know the network's name", () => {
    for (const networkName of ["unknown", ""]) {
      mockedNetworkStore.setMockedStoreValue({ connected: true, networkName });

      const { getByText } = render(ShieldedPausedNotice);

      expect(
        getByText("Shielded transactions are paused on this network.")
      ).toBeInTheDocument();

      cleanup();
    }
  });

  it("should leave out the balance line when there's no shielded balance", () => {
    setShieldedBalance(0n);

    const { container, queryByText } = render(ShieldedPausedNotice);

    expect(queryByText(balanceLine)).not.toBeInTheDocument();
    expect(container).toHaveTextContent(
      /^Shielded transactions are paused on Testnet\.$/
    );
  });

  it("should leave out the balance line when told not to mention it", () => {
    const { container, queryByText } = render(ShieldedPausedNotice, {
      mentionBalance: false,
    });

    expect(queryByText(balanceLine)).not.toBeInTheDocument();
    expect(container).toHaveTextContent(
      /^Shielded transactions are paused on Testnet\.$/
    );
  });
});
