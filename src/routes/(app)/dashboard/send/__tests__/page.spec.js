import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";

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

  it("should update the spendable amount passed to its child components when a `keyChange` event is fired", async () => {
    const { container, getByRole } = render(SendPage);
    const addressTextbox = getByRole("textbox");

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedUnshielded);

    await fireEvent.input(addressTextbox, {
      target: { value: currentProfile.address.toString() },
    });

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedShielded);

    await fireEvent.input(addressTextbox, {
      target: { value: currentProfile.account.toString() },
    });

    expect(
      container.querySelector(".contract-statuses__value")
    ).toHaveTextContent(formattedUnshielded);
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
});
