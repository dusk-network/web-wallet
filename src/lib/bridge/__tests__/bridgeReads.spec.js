import { beforeEach, describe, expect, it, vi } from "vitest";

/** @type {typeof import("../bridgeReads")} */
let reads;

/**
 * Fake reads: the factory names hub `d5…` for every game and type, and the
 * hub answers its views.
 */
function fakeReads() {
  const dgf = {
    call: {
      gameContractId: vi.fn().mockResolvedValue(Array(32).fill(0xd5)),
      virtualGameHubId: vi.fn().mockResolvedValue(`0x${"d5".repeat(32)}`),
    },
  };
  const hub = {
    call: {
      createdAtForGame: vi.fn().mockResolvedValue(46_876_050n),
      maxClockDuration: vi.fn().mockResolvedValue(302_400n),
      resolvedAtForGame: vi.fn().mockResolvedValue(0n),
      statusForGame: vi.fn().mockResolvedValue(0),
    },
  };

  return {
    dgf,
    hub,
    reads: /** @type {any} */ ({
      dgf,
      hub: () => hub,
      nodeUrl: "https://node.example.test",
      portal: { call: {} },
    }),
  };
}

describe("bridgeReads", () => {
  beforeEach(async () => {
    vi.resetModules();
    reads = await import("../bridgeReads");
  });

  it("reads a game's hub raw: the game's address in, a u64 or its status byte out", () => {
    const { GAME_HUB_DRIVER } = reads;
    const game = Array.from({ length: 20 }, (_, i) => i);

    expect(
      GAME_HUB_DRIVER.encodeInputFn("createdAtForGame", JSON.stringify(game))
    ).toStrictEqual(Uint8Array.from(game));
    expect(
      GAME_HUB_DRIVER.encodeInputFn("maxClockDuration", "null")
    ).toHaveLength(0);
    // maxClockDuration on testnet: 302,400 s, as the hub answered.
    expect(
      GAME_HUB_DRIVER.decodeOutputFn(
        "maxClockDuration",
        Uint8Array.of(0x40, 0x9d, 0x04, 0, 0, 0, 0, 0)
      )
    ).toBe(302_400n);
    expect(
      GAME_HUB_DRIVER.decodeOutputFn("statusForGame", Uint8Array.of(2))
    ).toBe(2);
    expect(() =>
      GAME_HUB_DRIVER.decodeOutputFn("resolvedAtForGame", new Uint8Array(4))
    ).toThrow(RangeError);
    expect(() =>
      GAME_HUB_DRIVER.decodeOutputFn("statusForGame", new Uint8Array(0))
    ).toThrow(RangeError);
  });

  it("reads the anchor state registry raw: a game's address in, yes or no out", () => {
    const { GAME_REGISTRY_DRIVER } = reads;
    const game = Array(20).fill(0x1e);

    expect(
      GAME_REGISTRY_DRIVER.encodeInputFn("isGameProper", JSON.stringify(game))
    ).toStrictEqual(Uint8Array.from(game));
    expect(
      GAME_REGISTRY_DRIVER.encodeInputFn("respectedGameTypeUpdatedAt", "null")
    ).toHaveLength(0);
    // As testnet's registry answered on 28 Oct 2026: set at height 3,907,068.
    expect(
      GAME_REGISTRY_DRIVER.decodeOutputFn(
        "respectedGameTypeUpdatedAt",
        Uint8Array.of(0xd8, 0x2b, 0x54, 0x02, 0, 0, 0, 0)
      )
    ).toBe(39_070_680n);
    expect(
      GAME_REGISTRY_DRIVER.decodeOutputFn("isGameProper", Uint8Array.of(1))
    ).toBe(true);
    expect(
      GAME_REGISTRY_DRIVER.decodeOutputFn("isGameRespected", Uint8Array.of(0))
    ).toBe(false);
    expect(() =>
      GAME_REGISTRY_DRIVER.decodeOutputFn("isGameProper", Uint8Array.of(2))
    ).toThrow(RangeError);
    expect(() =>
      GAME_REGISTRY_DRIVER.decodeOutputFn("isGameProper", new Uint8Array(0))
    ).toThrow(RangeError);
  });

  it("reads the registry only where it's known", () => {
    const config = {
      disputeGameFactoryContractId: "22".repeat(32),
      disputeGameFactoryDataDriverUrl: "/dgf.wasm",
      optimismPortalContractId: "11".repeat(32),
      optimismPortalDataDriverUrl: "/portal.wasm",
    };
    const options = {
      fetch: vi.fn(),
      loadDriver: vi.fn(),
      nodeUrl: "https://node.example.test",
    };

    expect(reads.bridgeReads({ config, ...options }).registry).toBeNull();
    expect(
      reads.bridgeReads({
        config: { ...config, anchorStateRegistryContractId: "17".repeat(32) },
        ...options,
      }).registry
    ).toStrictEqual({ call: expect.any(Object) });
  });

  it("reads each game's hub and each hub's clock limit once a node, and keeps a hub once read", async () => {
    const { dgf, hub, reads: fake } = fakeReads();
    const game = `0x${"1e".repeat(20)}`;

    expect(reads.knownHubOf(fake, game)).toBeNull();
    await expect(reads.hubOfGame(fake, game)).resolves.toBe("d5".repeat(32));
    await reads.hubOfGame(fake, game.toUpperCase().replace("0X", "0x"));
    expect(dgf.call.gameContractId).toHaveBeenCalledExactlyOnceWith(
      Array(20).fill(0x1e)
    );
    expect(reads.knownHubOf(fake, game)).toBe("d5".repeat(32));

    // A type's hub, as hex or bytes.
    await expect(reads.hubOfType(fake, 8)).resolves.toBe("d5".repeat(32));

    const [first, second] = await Promise.all([
      reads.readGame(fake, "d5".repeat(32), game),
      reads.readGame(fake, "d5".repeat(32), game),
    ]);

    expect(first).toStrictEqual({
      createdAt: 46_876_050n,
      maxClockDuration: 302_400n,
      resolvedAt: 0n,
      status: 0,
    });
    expect(second).toStrictEqual(first);
    expect(hub.call.maxClockDuration).toHaveBeenCalledOnce();
    expect(hub.call.createdAtForGame).toHaveBeenCalledTimes(2);
  });

  it("reads a hub again after a read of it failed", async () => {
    const { dgf, reads: fake } = fakeReads();
    const game = `0x${"2e".repeat(20)}`;

    dgf.call.gameContractId.mockRejectedValueOnce(new Error("Offline"));

    await expect(reads.hubOfGame(fake, game)).rejects.toThrow("Offline");
    expect(reads.knownHubOf(fake, game)).toBeNull();
    await expect(reads.hubOfGame(fake, game)).resolves.toBe("d5".repeat(32));
    expect(dgf.call.gameContractId).toHaveBeenCalledTimes(2);

    // Not a contract ID: no hub.
    dgf.call.gameContractId.mockResolvedValueOnce([1, 2, 3]);
    await expect(reads.hubOfGame(fake, `0x${"3e".repeat(20)}`)).rejects.toThrow(
      RangeError
    );
  });

  it("settles a read: its value, or why it failed", async () => {
    await expect(reads.settle(Promise.resolve(7))).resolves.toStrictEqual({
      value: 7,
    });
    await expect(
      reads.settle(Promise.reject(new Error("refused")))
    ).resolves.toStrictEqual({ error: new Error("refused") });
  });
});
