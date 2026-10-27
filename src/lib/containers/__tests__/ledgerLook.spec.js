import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { contactsStore, removeContact, saveContact } from "$lib/contacts";
import { ContactsView } from "$lib/containers/Contacts";
import { HistoryView } from "$lib/containers/History";
import {
  ActivityPanel,
  ExplainerCards,
  HomeBalance,
} from "$lib/containers/Home";
import StakingOverview from "$lib/containers/Staking/StakingOverview.svelte";

const DUSK = 1_000_000_000n;
const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

/** @type {ActivityRow} */
const sent = {
  amount: "10000000",
  blockHash: "b1".repeat(32),
  blockHeight: 4_692_418,
  direction: "out",
  hash: "a1".repeat(32),
  kind: "transfer",
  privacy: "public",
  source: "archive",
  status: "executed",
  success: true,
  timestamp: Date.now() - 60_000,
  to: ACCOUNT,
};

const state = {
  complete: true,
  error: null,
  hasMore: false,
  loaded: true,
  rows: [sent],
  syncing: false,
};

/** @param {Element} element */
const classesOf = (element) => Array.from(element.classList);

/**
 * D's markup in a screen: each section head between two brackets that
 * screen readers skip, and the chain's blue only on links, never on a row.
 *
 * @param {HTMLElement} container
 */
function expectLedgerLook(container) {
  for (const head of container.querySelectorAll(".section-head")) {
    expect(
      Array.from(
        head.querySelectorAll(":scope > [aria-hidden='true']"),
        (bracket) => bracket.textContent
      )
    ).toStrictEqual(["[", "]"]);
  }

  for (const blue of container.querySelectorAll(".text-link")) {
    expect(blue.matches("a[href]:not(.activity-row)")).toBe(true);
  }
}

/**
 * A page's own title: plain, with no brackets.
 *
 * @param {HTMLElement} container
 * @param {string} id
 */
function expectPlainTitle(container, id) {
  const title = /** @type {HTMLElement} */ (container.querySelector(`#${id}`));

  expect(classesOf(title)).not.toContain("section-head");
  expect(title.textContent).not.toMatch(/[[\]]/);
}

describe("The ledger look", () => {
  afterEach(() => {
    cleanup();

    for (const contact of get(contactsStore)) {
      removeContact(contact.id);
    }
  });

  it("gives Home a bracketed head, ledger labels and blue only on its links", () => {
    const panel = render(ActivityPanel, { locale: "en", state });

    expect(panel.getByRole("heading", { name: "Activity" })).toHaveClass(
      "section-head"
    );
    expect(panel.getByRole("link", { name: "History" })).toHaveClass(
      "text-link"
    );
    // A day keeps sentence case, in Söhne.
    expect(
      classesOf(panel.getByRole("heading", { level: 3, name: "Today" }))
    ).not.toContain("ledger-label");
    expectLedgerLook(panel.container);
    cleanup();

    const balance = render(HomeBalance, {
      fiatCurrency: "USD",
      locale: "en",
      shielded: 0n,
      unshielded: 173n * DUSK,
    });
    const cards = render(ExplainerCards, {
      liquid: DUSK / 2n,
      locale: "en",
      minimumStake: 1000n * DUSK,
      reward: 0n,
      shielded: 0n,
      staked: null,
      unshielded: 173n * DUSK,
    });

    expect(
      Array.from(document.body.querySelectorAll(".ledger-label"), (label) =>
        label.textContent?.trim()
      )
    ).toStrictEqual([
      "Total balance",
      "Public",
      "Shielded",
      "Public",
      "Shielded",
      "Staking",
    ]);
    expect(cards.getByRole("link", { name: "Open staking" })).toHaveClass(
      "text-link"
    );
    expectLedgerLook(balance.container);
    expectLedgerLook(cards.container);
  });

  it("keeps History's title plain, and brackets the details' head", () => {
    const { container, getByRole } = render(HistoryView, {
      locale: "en",
      selected: sent.hash,
      state,
    });

    expectPlainTitle(container, "history-title");
    expect(getByRole("heading", { name: "Transaction" })).toHaveClass(
      "section-head"
    );
    expect(
      container.querySelectorAll(".history__table thead th:not(.ledger-label)")
    ).toHaveLength(0);
    expect(container.querySelector(".history__day th")).toHaveTextContent(
      /^Today · /
    );
    // The block opens a page; the transaction's own ID opens nothing.
    expect(container.querySelectorAll(".text-link")).toHaveLength(1);
    expect(getByRole("link", { name: /^4,692,418/ })).toHaveClass("text-link");
    expectLedgerLook(container);
  });

  it("keeps Staking's title plain, with short bracketed heads and ledger labels", () => {
    const { container, getByRole } = render(StakingOverview, {
      activity: state,
      locale: "en",
      maxFee: DUSK / 10n,
      minimumStake: 1000n * DUSK,
      publicBalance: 173n * DUSK,
      sozu: {
        account: "",
        available: true,
        error: null,
        loading: false,
        status: null,
      },
      stakeInfo: { amount: null, faults: 0, hardFaults: 0, reward: 0n },
    });

    expectPlainTitle(container, "staking-title");

    for (const name of ["Stake", "Staking activity"]) {
      expect(getByRole("heading", { name })).toHaveClass("section-head");
    }

    expect(
      container.querySelectorAll(".staking__figures dt:not(.ledger-label)")
    ).toHaveLength(0);
    expect(getByRole("link", { name: /What's a node/ })).toHaveClass(
      "text-link"
    );
    expectLedgerLook(container);
  });

  it("keeps Contacts' title plain, and brackets its sections' heads", () => {
    const resolveName = async (/** @type {string} */ name) => ({
      account: ACCOUNT,
      name,
    });
    const paid = render(ContactsView, {
      contacts: [],
      locale: "en",
      resolveName,
      rows: [sent],
    });

    expectPlainTitle(paid.container, "contacts-title");
    expect(
      paid.getByRole("heading", { name: "People you've paid" })
    ).toHaveClass("section-head");
    expectLedgerLook(paid.container);
    cleanup();

    const shop = saveContact({
      address: ACCOUNT,
      duskName: null,
      name: "Shop",
    });
    const { container, getByRole } = render(ContactsView, {
      contacts: get(contactsStore),
      locale: "en",
      resolveName,
      rows: [sent],
      selected: shop.id,
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__table thead th.ledger-label"),
        (head) => head.textContent
      )
    ).toStrictEqual(["Name", ".dusk name", "Type", "Address", "Last activity"]);
    // The contact's name heads its panel as a name, in Söhne.
    expect(getByRole("heading", { name: "Shop" })).not.toHaveClass(
      "section-head"
    );
    expect(getByRole("heading", { name: "Activity" })).toHaveClass(
      "section-head"
    );
    expectLedgerLook(container);
  });
});
