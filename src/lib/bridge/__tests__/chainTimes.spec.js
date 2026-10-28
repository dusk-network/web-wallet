import { describe, expect, it } from "vitest";

import { createChainTimes, readDepositLag } from "$lib/bridge/chainTimes";

function memoryStorage() {
  /** @type {Map<string, string>} */
  const values = new Map();

  return /** @type {Storage} */ (
    /** @type {unknown} */ ({
      getItem: (/** @type {string} */ key) => values.get(key) ?? null,
      removeItem: (/** @type {string} */ key) => values.delete(key),
      setItem: (/** @type {string} */ key, /** @type {string} */ value) =>
        values.set(key, String(value)),
    })
  );
}

describe("chain times", () => {
  it("measure a deposit's lag from DuskEVM's latest block to Dusk's own time for the block it took in", async () => {
    /** @type {bigint[]} */
    const asked = [];
    const lag = await readDepositLag({
      // Dusk's time for block 4,698,838; DuskEVM's L1Block keeps one 126 s behind it.
      blockTime: async (height) => {
        asked.push(height);

        return 1_793_095_779;
      },
      l2Batch: async (calls) => {
        expect(calls.map(({ method }) => method)).toStrictEqual([
          "eth_getBlockByNumber",
          "eth_call",
        ]);
        expect(calls[1].params[0]).toStrictEqual({
          data: "0x8381f58a",
          to: "0x4200000000000000000000000000000000000015",
        });

        return [
          { timestamp: `0x${(1_793_095_813).toString(16)}` },
          `0x${(4_698_838).toString(16).padStart(64, "0")}`,
        ];
      },
    });

    expect(lag).toBe(34);
    expect(asked).toStrictEqual([4_698_838n]);
    await expect(
      readDepositLag({
        blockTime: async () => 1,
        l2Batch: async () => [{ timestamp: "0x1" }, "0x"],
      })
    ).rejects.toThrow();
  });

  it("are read at most every 10 minutes, kept a day, and kept per network", async () => {
    let now = Date.UTC(2026, 9, 27, 10);
    const storage = memoryStorage();
    const reads = { deposit: 0, withdrawal: 0 };
    let lag = 35;
    /** @type {() => Promise<{ finalitySeconds: number, maturitySeconds: number, outputSeconds: number | null }>} */
    let withdrawal = async () => {
      reads.withdrawal += 1;

      return {
        finalitySeconds: 302_400,
        maturitySeconds: 604_800,
        outputSeconds: 1_700,
      };
    };
    const read = {
      deposit: async () => {
        reads.deposit += 1;

        return lag;
      },
      withdrawal: () => withdrawal(),
    };
    const times = createChainTimes({
      key: "times-testnet",
      now: () => now,
      read,
      storage,
    });

    expect(times.get()).toBeNull();
    await expect(times.refresh()).resolves.toBe(true);
    expect(times.get()?.deposit).toStrictEqual({ at: now, lagSeconds: 35 });
    expect(times.get()?.withdrawal?.outputSeconds).toBe(1_700);

    // Asked again within 10 minutes: nothing is read, nothing moved.
    now += 5 * 60_000;
    await expect(times.refresh()).resolves.toBe(false);
    expect(reads).toStrictEqual({ deposit: 1, withdrawal: 1 });

    // Later, both again; one that fails keeps what was read before.
    now += 10 * 60_000;
    lag = 40;
    withdrawal = async () => {
      throw new Error("node down");
    };
    await expect(times.refresh()).resolves.toBe(true);
    expect(times.get()?.deposit?.lagSeconds).toBe(40);
    expect(times.get()?.withdrawal?.maturitySeconds).toBe(604_800);

    // The next visit shows what was read at once, on this network only, and not past a day.
    const again = createChainTimes({
      key: "times-testnet",
      now: () => now,
      read,
      storage,
    });

    expect(again.get()?.deposit?.lagSeconds).toBe(40);
    expect(
      createChainTimes({
        key: "times-mainnet",
        now: () => now,
        read,
        storage,
      }).get()
    ).toBeNull();
    now += 86_400_000;
    expect(again.get()).toBeNull();
  });
});
