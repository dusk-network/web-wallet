import { describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import { LINK_BAD_AMOUNT } from "@dusk-network/app-core/payment-links";

import { LINK_SEVERAL, LINK_UNCLEAR, readPastedLink, requestText } from "..";

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

  it("is read whole where it's a link, spaces and all, as a link alone always was: never cut short at a space", () => {
    for (const link of [duskLink, httpsLink]) {
      // A space in its memo: the memo as it says it, and all after it.
      expect(
        readPastedLink(
          link.replace("Factura+71", "Factura 71"),
          networks.testnet,
          "en"
        )
      ).toStrictEqual(asked);
      // In its amount: refused, as it was, not 1 DUSK.
      expect(
        readPastedLink(
          link.replace("amount=0.03", "amount=1 000"),
          networks.testnet,
          "en"
        )
      ).toStrictEqual({
        amount: "",
        elsewhere: null,
        memo: "",
        problem: LINK_BAD_AMOUNT,
        to: "",
      });
    }
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
    // Back to back, read whole as one: refused all the same.
    expect(
      readPastedLink(`${duskLink} ${httpsLink}`, networks.testnet, "en")
    ).toStrictEqual({
      amount: "",
      elsewhere: null,
      memo: "",
      problem: expect.any(String),
      to: "",
    });
    expect(readPastedLink(account, networks.testnet, "en")).toBeNull();
    expect(
      readPastedLink("sofiadesign.dusk", networks.testnet, "en")
    ).toBeNull();
  });
});
