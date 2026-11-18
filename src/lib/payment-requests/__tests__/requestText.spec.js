import { describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import { LINK_BAD_AMOUNT } from "@dusk-network/app-core/payment-links";

import {
  LINK_SEVERAL,
  LINK_UNCLEAR,
  pastedNames,
  readPastedLink,
  readPaymentLink,
  requestText,
} from "..";

const LINK =
  "https://apps.testnet.dusk.network/wallet/dashboard/send?to=abc&amount=0.03&network=testnet";

describe("What Share and Copy give of a request", () => {
  it("says whose it is, what it asks and its memo in a line, its test network where it isn't Mainnet, then its link", () => {
    expect(
      requestText(
        { link: LINK, lux: 30_000_000n, memo: "Factura F-2026-071" },
        { language: "es-ES", name: "sofiadesign.dusk", net: networks.testnet }
      )
    ).toBe(
      `sofiadesign.dusk asks you to pay 0,03 DUSK on Testnet · Factura F-2026-071\nPay here: ${LINK}`
    );
    // On Mainnet, a name given here, no memo.
    expect(
      requestText(
        { link: LINK, lux: 20_000_000n, memo: "" },
        { language: "en-SG", name: "Chen", net: networks.mainnet }
      )
    ).toBe(`Chen asks you to pay 0.02 DUSK\nPay here: ${LINK}`);
    // A profile known by its number, asking any amount.
    expect(
      requestText(
        { link: LINK, lux: null, memo: "chicken rice" },
        { language: "en", name: "", net: networks.testnet }
      )
    ).toBe(
      `You're asked for a payment in DUSK on Testnet · chicken rice\nPay here: ${LINK}`
    );
  });
});

describe("What's pasted of a request", () => {
  const account =
    "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
  const duskLink = `dusk:public-${account}@dusk:2?amount=0.03&memo=Factura+71`;
  const httpsLink = `https://apps.testnet.dusk.network/wallet/dashboard/send?to=${account}&amount=0.03&memo=Factura+71&network=testnet`;
  const asked = {
    amount: "0.03",
    memo: "Factura 71",
    problem: "",
    to: account,
  };

  it("is read by its one link, as the link alone is, as Share and Copy give it, the line break dropped as a text field drops it, or not", () => {
    for (const link of [duskLink, httpsLink]) {
      const copied = requestText(
        { link, lux: 30_000_000n, memo: "Factura 71" },
        { language: "en", name: "sofiadesign.dusk", net: networks.testnet }
      );

      expect(readPastedLink(link, networks.testnet, "en")).toStrictEqual(asked);
      expect(readPastedLink(copied, networks.testnet, "en")).toStrictEqual(
        asked
      );
      expect(
        readPastedLink(copied.replace("\n", ""), networks.testnet, "en")
      ).toStrictEqual(asked);
    }
  });

  // Lena's: her own link with " danke!" after it said "This link's network
  // can't be read", and with its memo last, the word went into the memo.
  // A link ends at its first space or line break: what follows is words
  // after it, whatever field it ends with, and a space inside it as well.
  it("refuses a link with words after it, or a space in it, as words after the link, whatever field it ends with, and never takes them into its memo", () => {
    const refused = {
      amount: "",
      elsewhere: null,
      memo: "",
      problem: LINK_UNCLEAR,
      to: "",
    };
    // Its memo last, as Lena's link had it.
    const memoLast = httpsLink.replace(
      /&memo=Factura\+71(.*)$/,
      "$1&memo=Factura+71"
    );

    expect(memoLast).toMatch(/&memo=Factura\+71$/);

    for (const link of [duskLink, httpsLink, memoLast]) {
      for (const after of [
        " danke!",
        "\ndanke!",
        "\r\ndanke!",
        "\u00a0danke!",
      ]) {
        expect(
          readPastedLink(`${link}${after}`, networks.testnet, "en")
        ).toStrictEqual(refused);
      }

      // A space inside it: in its memo, or its amount.
      expect(
        readPastedLink(
          link.replace("Factura+71", "Factura 71"),
          networks.testnet,
          "en"
        )
      ).toStrictEqual(refused);
      expect(
        readPastedLink(
          link.replace("amount=0.03", "amount=1 000"),
          networks.testnet,
          "en"
        )
      ).toStrictEqual(refused);
    }

    // Opened or scanned, a space in its amount is still its amount's.
    expect(
      readPaymentLink(
        httpsLink.replace("amount=0.03", "amount=1 000"),
        networks.testnet,
        "en"
      )
    ).toMatchObject({ problem: LINK_BAD_AMOUNT });
  });

  // Marek's: the wallet's own message with only its link's amount changed
  // filled the link's 0.15 under a line saying 0.002, and a forged line's
  // name or memo was ignored.
  // Nandini's, Lena's and Amélie's: "The message and its link don't agree."
  // never said what disagreed.
  it("refuses what Share and Copy give of a request whose line says another amount, memo or name than its link, saying what disagrees", () => {
    /** @param {string} problem */
    const refused = (problem) => ({
      amount: "",
      elsewhere: null,
      memo: "",
      problem,
      to: "",
    });
    const said = (/** @type {string} */ link) =>
      requestText(
        { link, lux: 30_000_000n, memo: "Factura 71" },
        { language: "en", name: "sofiadesign.dusk", net: networks.testnet }
      );

    expect(
      readPastedLink(said(httpsLink), networks.testnet, "en")
    ).toMatchObject({ amount: "0.03", memo: "Factura 71", problem: "" });
    // The link's amount changed under the line.
    expect(
      readPastedLink(
        said(httpsLink).replace("amount=0.03", "amount=0.15"),
        networks.testnet,
        "en"
      )
    ).toStrictEqual(
      refused("The message says 0.03 DUSK; its link asks 0.15 DUSK.")
    );
    // The line's amount, or its memo.
    expect(
      readPastedLink(
        said(httpsLink).replace("0.03 DUSK", "0.002 DUSK"),
        networks.testnet,
        "en"
      )
    ).toStrictEqual(
      refused("The message says 0.002 DUSK; its link asks 0.03 DUSK.")
    );
    expect(
      readPastedLink(
        said(httpsLink).replace("· Factura 71", "· coffee"),
        networks.testnet,
        "en"
      )
    ).toStrictEqual(
      refused("The message's memo is “coffee”; its link's is “Factura 71”.")
    );
    // Its name, where the name service says that name pays another account,
    // or no one.
    const another =
      "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

    expect(pastedNames(said(httpsLink), networks.testnet)).toStrictEqual([
      "sofiadesign.dusk",
    ]);

    // A request for Mainnet, pasted on Testnet: its names are Mainnet's,
    // none looked up here, where it's said to be for Mainnet.
    const onMainnet = requestText(
      {
        link: `https://apps.dusk.network/wallet/dashboard/send?to=${account}&amount=0.03&memo=Factura+71&network=mainnet`,
        lux: 30_000_000n,
        memo: "Factura 71",
      },
      { language: "en", name: "sofiadesign.dusk", net: networks.mainnet }
    );

    expect(pastedNames(onMainnet, networks.testnet)).toStrictEqual([]);
    expect(pastedNames(onMainnet, networks.mainnet)).toStrictEqual([
      "sofiadesign.dusk",
    ]);

    for (const owner of [{ account: another }, null]) {
      expect(
        readPastedLink(
          said(httpsLink),
          networks.testnet,
          "en",
          new Map([["sofiadesign.dusk", owner]])
        )
      ).toStrictEqual(
        refused(
          "The message says sofiadesign.dusk; its link pays 25z9o6…5Etftt."
        )
      );
    }

    expect(
      readPastedLink(
        said(httpsLink),
        networks.testnet,
        "en",
        new Map([["sofiadesign.dusk", { account }]])
      )
    ).toMatchObject({ amount: "0.03", problem: "" });
  });

  it("asks nothing where words after the link in a longer text may be part of it, and says so", () => {
    for (const pasted of [
      `Pay here: ${httpsLink.replace("Factura+71", "Factura 71")}`,
      `Pay here: ${duskLink} thanks!`,
    ]) {
      expect(readPastedLink(pasted, networks.testnet, "en")).toStrictEqual({
        amount: "",
        elsewhere: null,
        memo: "",
        problem: LINK_UNCLEAR,
        to: "",
      });
    }
  });

  it("asks nothing with two links in it, and says so, and is no link without one, as an address or a name", () => {
    expect(
      readPastedLink(
        `Pay here: ${duskLink} or here: ${httpsLink}`,
        networks.testnet,
        "en"
      )
    ).toStrictEqual({
      amount: "",
      elsewhere: null,
      memo: "",
      problem: LINK_SEVERAL,
      to: "",
    });
    // Back to back, or a second where the first's memo would carry it, as
    // all three wallets read what's pasted (app-core's readPastedLink):
    // read whole, the first would pay its recipient with the second in its
    // memo.
    for (const pasted of [
      `${duskLink} ${httpsLink}`,
      `${duskLink.replace("Factura+71", "x")} dusk:public-sofiadesign.dusk`,
    ]) {
      expect(readPastedLink(pasted, networks.testnet, "en")).toStrictEqual({
        amount: "",
        elsewhere: null,
        memo: "",
        problem: LINK_SEVERAL,
        to: "",
      });
    }
    expect(readPastedLink(account, networks.testnet, "en")).toBeNull();
    expect(
      readPastedLink("sofiadesign.dusk", networks.testnet, "en")
    ).toBeNull();
  });
});
