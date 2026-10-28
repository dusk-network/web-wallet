import { describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import {
  cardRoutes,
  choosePair,
  flipRoute,
  fromChoices,
  migrationRoutes,
  networkName,
  openingRoute,
  toChoices,
} from "../cardRoutes";

const ids = (/** @type {{ id: string } | null | undefined} */ route) =>
  route?.id ?? null;

describe("the Bridge card's routes", () => {
  it("are the network's own: on mainnet both migrations and the transfer to BNB Smart Chain", () => {
    const list = cardRoutes(networks.mainnet);

    expect(
      list.map(({ destination, id, origin, running }) => [
        id,
        origin,
        destination,
        running,
      ])
    ).toStrictEqual([
      ["bsc-to-dusk", "bsc", "duskDs", true],
      ["ethereum-to-dusk", "ethereum", "duskDs", true],
      ["dusk-to-bsc", "duskDs", "bsc", true],
    ]);
    expect(
      ["ethereum", "bsc", "duskDs"].map((id) => networkName(list, id))
    ).toStrictEqual(["Ethereum", "BNB Smart Chain", "Dusk"]);
    // No DuskEVM yet: it opens on the route from Dusk.
    expect(ids(openingRoute(list))).toBe("dusk-to-bsc");
    expect(ids(openingRoute(list, "bsc-to-dusk"))).toBe("bsc-to-dusk");
    expect(migrationRoutes(list).map(ids)).toStrictEqual([
      "bsc-to-dusk",
      "ethereum-to-dusk",
    ]);
  });

  it("offer each way that runs, and say why another can't be picked", () => {
    const list = cardRoutes(networks.mainnet);

    expect(fromChoices(list, "duskDs", networks.mainnet)).toStrictEqual([
      { id: "ethereum", name: "Ethereum" },
      { id: "bsc", name: "BNB Smart Chain" },
      { id: "duskDs", name: "Dusk" },
    ]);
    expect(
      toChoices(list, "duskDs", "bsc", networks.mainnet, (route) => route.id)
    ).toStrictEqual([
      { disabled: "No route from Dusk", id: "ethereum", name: "Ethereum" },
      { id: "bsc", name: "BNB Smart Chain", note: "dusk-to-bsc" },
      { disabled: "It's where it comes from", id: "duskDs", name: "Dusk" },
    ]);
    // BNB Smart Chain's DUSK comes back to Dusk; Ethereum's is one way.
    const bsc = list.find(({ id }) => id === "bsc-to-dusk") ?? null;
    const ethereum = list.find(({ id }) => id === "ethereum-to-dusk") ?? null;

    expect(ids(flipRoute(list, bsc))).toBe("dusk-to-bsc");
    expect(flipRoute(list, ethereum)).toBeNull();
    // A pick keeps the other side where it can, else takes a route that runs.
    expect(ids(choosePair(list, "ethereum", "duskDs"))).toBe(
      "ethereum-to-dusk"
    );
    expect(ids(choosePair(list, "duskDs", "ethereum"))).toBe("dusk-to-bsc");
  });

  it("list testnet's Sepolia routes as not running, and open on DuskEVM", () => {
    const list = cardRoutes(networks.testnet);

    expect(ids(openingRoute(list))).toBe("dusk-to-dusk-evm");
    expect(fromChoices(list, "duskDs", networks.testnet)).toStrictEqual([
      {
        disabled: "Not running on testnet right now",
        id: "ethereum",
        name: "Sepolia",
      },
      { id: "duskDs", name: "Dusk" },
      { id: "duskEvm", name: "DuskEVM" },
    ]);
    expect(
      toChoices(list, "duskDs", "duskEvm", networks.testnet).map(
        ({ disabled = "", id }) => [id, disabled]
      )
    ).toStrictEqual([
      ["ethereum", "Not running on testnet right now"],
      ["duskDs", "It's where it comes from"],
      ["duskEvm", ""],
    ]);
    // A link to one still opens it, to say so.
    expect(ids(openingRoute(list, "ethereum-to-dusk"))).toBe(
      "ethereum-to-dusk"
    );
    expect(ids(flipRoute(list, openingRoute(list)))).toBe("dusk-evm-to-dusk");
  });

  it("are none on a chain without a file", () => {
    expect(cardRoutes(null)).toStrictEqual([]);
    expect(openingRoute([])).toBeNull();
  });
});
