import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixtures from "./fixtures/login-v1.json";

/*
 * v1 login records as main (e5604ee) stored them, with its own
 * loginInfoStorage and encryptMnemonic (`current`, `currentLong`) or
 * encryptBuffer at 10,000 iterations (`legacy`, as before f22574f): public
 * BIP39 test phrases, never a real wallet's.
 */
const { current, currentLong, legacy } = fixtures;

const OTHER =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const THIRD =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";
const FOURTH =
  "cat swing flag economy stadium alone churn speed unique patch report train";

const V1 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
const V2 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-v2`;

/** @type {(key: string) => any} */
const stored = (key) => JSON.parse(localStorage.getItem(key) ?? "null");

/** @param {{ stored: string }} fixture */
const recordOf = (fixture) => JSON.parse(fixture.stored);

/** @param {{ wallets: Array<{ mnemonic: string }> }} result */
const phrases = (result) => result.wallets.map((w) => w.mnemonic);

/** @param {{ stored: string }} fixture */
function startWithV1(fixture) {
  localStorage.clear();
  localStorage.setItem(V1, fixture.stored);
}

const real = {
  getItem: Storage.prototype.getItem,
  removeItem: Storage.prototype.removeItem,
  setItem: Storage.prototype.setItem,
};

/*
 * Storage steps that fail, each once: "set:<key>" for the next write of
 * that key, "get:<key>@3" for its third read since failAt. A full disk, or
 * a tab closed, at that step. And reads that answer something else once,
 * by the same names (answerAt): storage that lost a write.
 */
/** @type {Array<{ at: number | null, name: string }>} */
let failing = [];

/** @type {Map<string, number>} */
const counts = new Map();

/** @type {Map<string, string | null>} */
const answers = new Map();

/** @param {string[]} specs */
function failAt(...specs) {
  counts.clear();
  answers.clear();
  failing = specs.map((spec) => {
    const [name, at] = spec.split("@");

    return { at: at ? Number(at) : null, name };
  });
}

/**
 * @param {string} spec "get:<key>@<n>", counted since failAt
 * @param {string | null} value
 */
const answerAt = (spec, value) => answers.set(spec, value);

/**
 * Counts a step, and fails it when it's one to fail: the step's count.
 *
 * @param {string} op
 * @param {string} key
 */
function step(op, key) {
  const name = `${op}:${key}`;
  const n = (counts.get(name) ?? 0) + 1;

  counts.set(name, n);

  const i = failing.findIndex((f) => f.name === name && (f.at ?? n) === n);

  if (i >= 0) {
    failing.splice(i, 1);
    throw new Error(`storage ${op} failed`);
  }

  return `${name}@${n}`;
}

/*
 * The reads of v2 in each change, counted from its start: an unlock that
 * moves v1 reads v2 for the open (1st), for the move (2nd), keeps what's
 * there before writing (3rd), then reads it back (4th); a change of a v2
 * opens it (1st), reads it as opened (2nd), keeps it (3rd), then reads it
 * back (4th); a new vault keeps what's there (1st) and reads back (2nd).
 */
const READ_BACK = `get:${CONFIG.LOCAL_STORAGE_APP_KEY}-login-v2@4`;

/** A fresh module, as a page loaded again after a crash or an update gets. */
async function restart() {
  vi.resetModules();

  return (await import("..")).default;
}

describe("vault", () => {
  beforeEach(() => {
    localStorage.clear();
    failAt();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      /** @this {Storage} */
      function (key) {
        const at = step("get", key);

        return answers.has(at)
          ? (answers.get(at) ?? null)
          : real.getItem.call(this, key);
      }
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      /** @this {Storage} */
      function (key, value) {
        step("set", key);
        real.setItem.call(this, key, value);
      }
    );
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
      /** @this {Storage} */
      function (key) {
        step("remove", key);
        real.removeItem.call(this, key);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("a new vault", () => {
    it("sets up one wallet, sealed as main seals its one phrase", async () => {
      const vault = await restart();
      const wallet = await vault.setUp(current.mnemonic, current.password);

      expect(wallet).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{32}$/),
        n: 1,
      });
      expect(localStorage.getItem(V1)).toBeNull();

      const [entry] = stored(V2).wallets;

      expect(stored(V2)).toEqual({ version: 2, wallets: [entry] });
      expect(entry).toMatchObject({ id: wallet.id, n: 1, version: 1 });
      expect(atob(entry.salt)).toHaveLength(32);
      expect(atob(entry.iv)).toHaveLength(12);
      expect(JSON.stringify(localStorage)).not.toContain("legal");
      await expect(vault.unlock(current.password)).resolves.toEqual({
        fromV1: null,
        wallets: [{ ...wallet, mnemonic: current.mnemonic }],
      });
    });

    it("takes the place of every phrase here, v1's too", async () => {
      startWithV1(legacy);

      let vault = await restart();

      await vault.setUp(OTHER, "password123");
      await vault.add(THIRD, "password123");

      vault = await restart();

      const only = await vault.setUp(FOURTH, "another password");

      expect(stored(V2).wallets).toHaveLength(1);
      expect(localStorage.getItem(V1)).toBeNull();
      await expect(vault.unlock("password123")).rejects.toThrow(
        "Wrong password"
      );
      await expect(vault.unlock("another password")).resolves.toEqual({
        fromV1: null,
        wallets: [{ ...only, mnemonic: FOURTH }],
      });
    });

    it("keeps the vault there was when the new one can't be saved", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");

      const before = localStorage.getItem(V2);

      failAt(`set:${V2}`);
      await expect(vault.setUp(THIRD, "password123")).rejects.toThrow(
        "storage set failed"
      );
      expect(localStorage.getItem(V2)).toBe(before);

      // Read back as something else: put back as it was.
      failAt();
      answerAt(`get:${V2}@2`, JSON.stringify({ version: 2, wallets: [] }));
      await expect(vault.setUp(THIRD, "password123")).rejects.toThrow(
        "couldn't be saved"
      );
      expect(localStorage.getItem(V2)).toBe(before);
      expect(phrases(await vault.unlock("password123"))).toEqual([OTHER]);
    });

    it("lets a reset win over a setup whose encryption is under way", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");

      const encrypted = Promise.withResolvers();
      const resume = Promise.withResolvers();
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);

      vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(
        async (...args) => {
          const result = await encrypt(...args);

          encrypted.resolve(undefined);
          await resume.promise;

          return result;
        }
      );

      const setup = vault.setUp(THIRD, "password123");

      await encrypted.promise;

      const reset = vault.clear();

      try {
        await vi.waitFor(async () => {
          expect((await navigator.locks.query()).pending).toHaveLength(1);
        });
        expect(stored(V2).wallets).toHaveLength(1);
      } finally {
        resume.resolve(undefined);
        await Promise.all([setup, reset]);
      }

      expect(vault.exists()).toBe(false);
    });
  });

  describe("unlocking", () => {
    it("refuses a wrong password with nothing about the vault, and changes nothing", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");

      const before = { ...localStorage };
      const error = await vault.unlock("password12").catch((e) => e);

      expect(error.name).toBe("InvalidPasswordError");
      expect(error.message).toBe("Wrong password");
      expect({ ...localStorage }).toEqual(before);
    });

    it("waits for the lock, and starts nothing once aborted", async () => {
      startWithV1(current);

      const vault = await restart();
      const acquired = Promise.withResolvers();
      const release = Promise.withResolvers();
      const held = navigator.locks.request(V1, () => {
        acquired.resolve(undefined);

        return release.promise;
      });

      await acquired.promise;

      const controller = new AbortController();
      const unlock = vault.unlock(current.password, {
        signal: controller.signal,
      });

      controller.abort();
      release.resolve(undefined);
      await held;
      await expect(unlock).rejects.toMatchObject({ name: "AbortError" });
      expect(localStorage.getItem(V1)).toBe(current.stored);
      expect(localStorage.getItem(V2)).toBeNull();
    });

    it("leaves a record this version can't read as it is", async () => {
      for (const unreadable of [
        JSON.stringify({ data: "x", iv: "y" }),
        JSON.stringify({ ...recordOf(current), version: 7 }),
        "not json",
      ]) {
        localStorage.clear();
        localStorage.setItem(V1, unreadable);

        const vault = await restart();

        await expect(vault.unlock(current.password)).rejects.toThrow(
          "can't be read"
        );
        expect({ ...localStorage }).toEqual({ [V1]: unreadable });
      }

      localStorage.clear();
      localStorage.setItem(V2, JSON.stringify({ phrases: "?", version: 3 }));

      const vault = await restart();

      await expect(vault.unlock(current.password)).rejects.toThrow(
        "can't be read"
      );
      expect(stored(V2)).toEqual({ phrases: "?", version: 3 });
    });

    it("opens v1's phrase beside a v2 it can't read, and changes neither", async () => {
      for (const unreadable of [
        JSON.stringify({ phrases: "?", version: 3 }),
        JSON.stringify({ version: 2, wallets: "?" }),
      ]) {
        startWithV1(current);
        localStorage.setItem(V2, unreadable);

        const vault = await restart();

        expect(phrases(await vault.unlock(current.password))).toEqual([
          current.mnemonic,
        ]);
        expect({ ...localStorage }).toEqual({
          [V1]: current.stored,
          [V2]: unreadable,
        });
        await expect(vault.add(OTHER, current.password)).rejects.toThrow(
          "can't be read"
        );
        await expect(
          vault.changePassword(current.password, "another password")
        ).rejects.toThrow("can't be read");
        expect({ ...localStorage }).toEqual({
          [V1]: current.stored,
          [V2]: unreadable,
        });
      }
    });

    it("clears every phrase, v1's too, and nothing else", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");
      localStorage.setItem(V1, legacy.stored);
      localStorage.setItem("something-else", "kept");

      await vault.clear();

      expect({ ...localStorage }).toEqual({ "something-else": "kept" });
      expect(vault.exists()).toBe(false);
      await expect(vault.unlock("password123")).rejects.toThrow(
        "There's no wallet here"
      );
    });
  });

  describe("the move from v1, from records main made", () => {
    it.each([
      ["12 words", current],
      ["24 words and a password with spaces and accents", currentLong],
    ])(
      "moves %s on unlock: v1's record copied as it is, then v1 gone",
      async (_name, fixture) => {
        startWithV1(fixture);

        let vault = await restart();
        const result = await vault.unlock(fixture.password);
        const { wallets } = result;

        expect(wallets).toEqual([
          {
            id: expect.stringMatching(/^v1-[0-9a-f]{32}$/),
            mnemonic: fixture.mnemonic,
            n: 1,
          },
        ]);
        expect(result.fromV1).toBe(wallets[0].id);
        expect(localStorage.getItem(V1)).toBeNull();
        expect(stored(V2)).toEqual({
          version: 2,
          wallets: [{ id: wallets[0].id, n: 1, ...recordOf(fixture) }],
        });

        // And again, as the next page load unlocks it.
        vault = await restart();
        await expect(vault.unlock(fixture.password)).resolves.toEqual({
          fromV1: null,
          wallets,
        });
      }
    );

    it("moves a legacy record sealed again at the current version, never under its legacy salt", async () => {
      startWithV1(legacy);

      let vault = await restart();
      const { fromV1, wallets } = await vault.unlock(legacy.password);
      const [entry] = stored(V2).wallets;

      expect(wallets).toEqual([
        { id: fromV1, mnemonic: legacy.mnemonic, n: 1 },
      ]);
      expect(fromV1).toMatch(/^v1-[0-9a-f]{32}$/);
      expect(localStorage.getItem(V1)).toBeNull();
      expect(entry).toMatchObject({ id: fromV1, n: 1, version: 1 });
      expect(entry.salt).not.toBe(recordOf(legacy).salt);
      expect(entry.data).not.toBe(recordOf(legacy).data);

      vault = await restart();
      await expect(vault.unlock(legacy.password)).resolves.toEqual({
        fromV1: null,
        wallets,
      });
    });

    it.each([
      ["a current record", current],
      ["a legacy record", legacy],
    ])(
      "moves nothing with a wrong password, then moves %s on the right one",
      async (_name, fixture) => {
        startWithV1(fixture);

        let vault = await restart();

        await expect(vault.unlock(`${fixture.password}!`)).rejects.toThrow(
          "Wrong password"
        );
        await expect(vault.unlock(` ${fixture.password}`)).rejects.toThrow(
          "Wrong password"
        );
        expect({ ...localStorage }).toEqual({ [V1]: fixture.stored });

        vault = await restart();
        expect(phrases(await vault.unlock(fixture.password))).toEqual([
          fixture.mnemonic,
        ]);
        expect(localStorage.getItem(V1)).toBeNull();
        expect(stored(V2).wallets).toHaveLength(1);
      }
    );

    /*
     * Each step of the move cut short: the unlock still opens the phrase,
     * from v1, and the next unlock finishes the move. The move writes v2,
     * reads it back (READ_BACK), then removes v1.
     */
    describe.each([
      ["a current record", current],
      ["a legacy record", legacy],
    ])("of %s", (_name, fixture) => {
      it.each([
        ["writing v2", [`set:${V2}`]],
        ["reading v2 back", [READ_BACK]],
        [
          "reading v2 back, and putting it back as it was",
          [READ_BACK, `remove:${V2}`],
        ],
        ["removing v1", [`remove:${V1}`]],
      ])(
        "still unlocks when the move stops at %s, and finishes next time",
        async (_step, steps) => {
          startWithV1(fixture);

          let vault = await restart();

          failAt(...steps);
          expect(phrases(await vault.unlock(fixture.password))).toEqual([
            fixture.mnemonic,
          ]);
          expect(failing).toEqual([]);
          expect(localStorage.getItem(V1)).toBe(fixture.stored);

          failAt();
          vault = await restart();

          const { wallets } = await vault.unlock(fixture.password);

          expect(phrases({ wallets })).toEqual([fixture.mnemonic]);
          expect(localStorage.getItem(V1)).toBeNull();
          expect(stored(V2).wallets).toEqual([
            expect.objectContaining({ id: wallets[0].id, n: 1 }),
          ]);

          const [entry] = stored(V2).wallets;

          // v1's own record, or for a legacy one, sealed again.
          expect(entry).toMatchObject({ id: wallets[0].id, n: 1, version: 1 });
          expect(
            entry.salt === recordOf(fixture).salt &&
              entry.data === recordOf(fixture).data
          ).toBe(fixture !== legacy);

          // Named the same each time it was tried.
          vault = await restart();
          await expect(vault.unlock(fixture.password)).resolves.toEqual({
            fromV1: null,
            wallets,
          });
        }
      );
    });

    it("leaves v1 as it was when the first read fails", async () => {
      startWithV1(current);

      const vault = await restart();

      failAt(`get:${V1}`);
      await expect(vault.unlock(current.password)).rejects.toThrow(
        "storage get failed"
      );
      expect({ ...localStorage }).toEqual({ [V1]: current.stored });
    });

    it("keeps v1 when v2 doesn't read back as written, and moves it the next time", async () => {
      startWithV1(currentLong);

      let vault = await restart();

      answerAt(READ_BACK, JSON.stringify({ version: 2, wallets: [] }));
      expect(phrases(await vault.unlock(currentLong.password))).toEqual([
        currentLong.mnemonic,
      ]);
      expect(localStorage.getItem(V1)).toBe(currentLong.stored);
      expect(localStorage.getItem(V2)).toBeNull();

      vault = await restart();
      expect(phrases(await vault.unlock(currentLong.password))).toEqual([
        currentLong.mnemonic,
      ]);
      expect(localStorage.getItem(V1)).toBeNull();
      expect(stored(V2).wallets).toEqual([
        expect.objectContaining(recordOf(currentLong)),
      ]);
    });

    it("puts v1's record over a copy of it that doesn't open", async () => {
      startWithV1(current);

      let vault = await restart();
      const { wallets } = await vault.unlock(current.password);
      const broken = stored(V2);

      broken.wallets[0].data = btoa("not the phrase, sealed");
      localStorage.setItem(V2, JSON.stringify(broken));
      localStorage.setItem(V1, current.stored);

      vault = await restart();
      await expect(vault.unlock(current.password)).resolves.toEqual({
        fromV1: wallets[0].id,
        wallets,
      });
      expect(localStorage.getItem(V1)).toBeNull();
      expect(stored(V2).wallets).toEqual([
        { id: wallets[0].id, n: 1, ...recordOf(current) },
      ]);
    });

    it("moves nothing twice: v1's phrase in v2 already, under another wallet, goes once", async () => {
      // An older version, back for a while, made v1 again with the same phrase.
      let vault = await restart();
      const { id } = await vault.setUp(current.mnemonic, current.password);

      localStorage.setItem(V1, current.stored);

      vault = await restart();
      await expect(vault.unlock(current.password)).resolves.toEqual({
        fromV1: id,
        wallets: [{ id, mnemonic: current.mnemonic, n: 1 }],
      });
      expect(localStorage.getItem(V1)).toBeNull();
      expect(stored(V2).wallets).toHaveLength(1);
    });

    it("keeps a wallet another password seals as it is, and adds v1's beside it", async () => {
      // v2 under one password, then v1 from an older version under another.
      let vault = await restart();
      const first = await vault.setUp(OTHER, "an older password");
      const kept = stored(V2).wallets[0];

      localStorage.setItem(V1, currentLong.stored);

      vault = await restart();

      const { wallets } = await vault.unlock(currentLong.password);

      expect(wallets).toEqual([
        {
          id: expect.stringMatching(/^v1-/),
          mnemonic: currentLong.mnemonic,
          n: 2,
        },
      ]);
      expect(localStorage.getItem(V1)).toBeNull();
      expect(stored(V2).wallets).toEqual([
        kept,
        { id: wallets[0].id, n: 2, ...recordOf(currentLong) },
      ]);

      // Each password still opens its own.
      await expect(vault.unlock("an older password")).resolves.toEqual({
        fromV1: null,
        wallets: [{ ...first, mnemonic: OTHER }],
      });
    });
  });

  describe("wallets", () => {
    async function twoWallets() {
      const vault = await restart();
      const first = await vault.setUp(OTHER, "password123");
      const second = await vault.add(THIRD, "password123");

      return { first, second, vault };
    }

    it("adds a wallet under the same password, leaving the others as they are", async () => {
      const vault = await restart();
      const first = await vault.setUp(OTHER, "password123");
      const before = stored(V2).wallets[0];
      const second = await vault.add(THIRD, "password123");

      expect(second).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{32}$/),
        n: 2,
      });
      expect(stored(V2).wallets[0]).toEqual(before);
      expect(JSON.stringify(localStorage)).not.toContain("scheme");
      expect(vault.list()).toEqual([first, second]);
      await expect(vault.unlock("password123")).resolves.toEqual({
        fromV1: null,
        wallets: [
          { ...first, mnemonic: OTHER },
          { ...second, mnemonic: THIRD },
        ],
      });
    });

    it("adds to a vault moved from v1, the moved wallet as main made it", async () => {
      startWithV1(currentLong);

      const vault = await restart();

      await vault.add(OTHER, currentLong.password);

      expect(localStorage.getItem(V1)).toBeNull();
      expect(stored(V2).wallets[0]).toMatchObject({
        n: 1,
        ...recordOf(currentLong),
      });
      expect(phrases(await vault.unlock(currentLong.password))).toEqual([
        currentLong.mnemonic,
        OTHER,
      ]);
    });

    it("adds to a vault moved from a legacy record, never under the legacy salt", async () => {
      startWithV1(legacy);

      const vault = await restart();

      await vault.add(OTHER, legacy.password);

      const [moved, added] = stored(V2).wallets;

      expect(localStorage.getItem(V1)).toBeNull();
      expect(moved.version).toBe(1);
      expect(added).toMatchObject({ salt: moved.salt, version: 1 });
      expect(added.salt).not.toBe(recordOf(legacy).salt);
      expect(phrases(await vault.unlock(legacy.password))).toEqual([
        legacy.mnemonic,
        OTHER,
      ]);
    });

    it("refuses a recovery phrase that's here already, however it's spaced, and writes nothing", async () => {
      const { vault } = await twoWallets();
      const before = { ...localStorage };

      for (const phrase of [OTHER, `  ${THIRD.replaceAll(" ", "   ")}\n`]) {
        await expect(vault.add(phrase, "password123")).rejects.toThrow(
          "This recovery phrase is already in your wallet."
        );
      }

      expect({ ...localStorage }).toEqual(before);
    });

    it("refuses a wallet with a wrong password", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");

      const before = localStorage.getItem(V2);

      await expect(vault.add(THIRD, "password12")).rejects.toThrow(
        "Wrong password"
      );
      expect(localStorage.getItem(V2)).toBe(before);
    });

    it("puts the vault back when a new wallet doesn't read back", async () => {
      const vault = await restart();

      await vault.setUp(OTHER, "password123");

      const before = localStorage.getItem(V2);

      failAt(READ_BACK);
      await expect(vault.add(THIRD, "password123")).rejects.toThrow(
        "couldn't be saved"
      );
      expect(localStorage.getItem(V2)).toBe(before);

      // Read back as the vault from before the write.
      failAt();
      answerAt(READ_BACK, before);
      await expect(vault.add(THIRD, "password123")).rejects.toThrow(
        "couldn't be saved"
      );
      expect(localStorage.getItem(V2)).toBe(before);
      expect(phrases(await vault.unlock("password123"))).toEqual([OTHER]);
    });

    it("removes one wallet with its password, and touches nothing of the others", async () => {
      const { first, second, vault } = await twoWallets();
      const third = await vault.add(FOURTH, "password123");
      const kept = stored(V2).wallets.filter(
        (/** @type {{ id: string }} */ w) => w.id !== second.id
      );

      await expect(vault.remove(second.id, "wrong password")).rejects.toThrow(
        "Wrong password"
      );
      expect(stored(V2).wallets).toHaveLength(3);

      await vault.remove(second.id, "password123");
      expect(stored(V2).wallets).toEqual(kept);

      // Numbers stay with their wallet; the next one gets a new number.
      await expect(vault.unlock("password123")).resolves.toEqual({
        fromV1: null,
        wallets: [
          { ...first, mnemonic: OTHER },
          { ...third, mnemonic: FOURTH, n: 3 },
        ],
      });
      await expect(vault.add(THIRD, "password123")).resolves.toMatchObject({
        n: 4,
      });
    });

    it("never removes the only wallet, or one that isn't here", async () => {
      const vault = await restart();
      const only = await vault.setUp(OTHER, "password123");
      const before = { ...localStorage };

      await expect(vault.remove(only.id, "password123")).rejects.toThrow(
        "This is the only wallet here. Reset removes it."
      );
      await expect(vault.remove("not-a-wallet", "password123")).rejects.toThrow(
        "That wallet isn't here."
      );
      expect({ ...localStorage }).toEqual(before);
    });

    it("refuses to remove a wallet another password seals", async () => {
      let vault = await restart();
      const other = await vault.setUp(OTHER, "an older password");

      localStorage.setItem(V1, current.stored);
      vault = await restart();
      await vault.unlock(current.password);

      const before = localStorage.getItem(V2);

      await expect(vault.remove(other.id, current.password)).rejects.toThrow(
        "Wrong password"
      );
      expect(localStorage.getItem(V2)).toBe(before);
    });

    it("changes the password: every phrase sealed again, the old password opening none", async () => {
      const { first, second, vault } = await twoWallets();
      const before = stored(V2).wallets;

      await expect(
        vault.changePassword("password12", "new password")
      ).rejects.toThrow("Wrong password");
      expect(stored(V2).wallets).toEqual(before);

      await vault.changePassword("password123", "a new password, é");

      const after = stored(V2).wallets;

      expect(after.map((/** @type {any} */ { id, n }) => ({ id, n }))).toEqual([
        first,
        second,
      ]);
      expect(new Set(after.map((/** @type {any} */ w) => w.salt)).size).toBe(1);

      for (const [i, entry] of after.entries()) {
        expect(entry.version).toBe(1);
        expect(entry.salt).not.toBe(before[i].salt);
        expect(entry.data).not.toBe(before[i].data);
      }

      await expect(vault.unlock("password123")).rejects.toThrow(
        "Wrong password"
      );
      expect(phrases(await vault.unlock("a new password, é"))).toEqual([
        OTHER,
        THIRD,
      ]);
    });

    it.each([
      ["a current record", current],
      ["a legacy record", legacy],
    ])(
      "changes the password of a vault moved from %s",
      async (_name, fixture) => {
        startWithV1(fixture);

        const vault = await restart();

        await vault.changePassword(fixture.password, "another one");
        expect(localStorage.getItem(V1)).toBeNull();
        expect(stored(V2).wallets[0].version).toBe(1);
        expect(phrases(await vault.unlock("another one"))).toEqual([
          fixture.mnemonic,
        ]);
      }
    );

    it("leaves a phrase another password seals as it is when the password changes", async () => {
      let vault = await restart();

      await vault.setUp(OTHER, "an older password");

      const kept = stored(V2).wallets[0];

      localStorage.setItem(V1, current.stored);
      vault = await restart();
      await vault.changePassword(current.password, "new password");

      expect(stored(V2).wallets[0]).toEqual(kept);
      expect(phrases(await vault.unlock("new password"))).toEqual([
        current.mnemonic,
      ]);
      expect(phrases(await vault.unlock("an older password"))).toEqual([OTHER]);
    });

    it("derives the key once per salt: 1 derivation for wallets added after the move, 2 beside a moved record with a salt of its own", async () => {
      const added = [OTHER, THIRD, FOURTH];
      const derivations = vi.spyOn(crypto.subtle, "deriveKey");

      /**
       * @template T
       * @param {() => Promise<T>} fn
       * @returns {Promise<[T, number]>}
       */
      const cost = async (fn) => {
        derivations.mockClear();

        const out = await fn();

        return [out, derivations.mock.calls.length];
      };

      /** @param {string} password */
      const unlock = async (password) =>
        cost(async () => phrases(await (await restart()).unlock(password)));

      // v1 moved, then three added: each under the moved record's salt, with
      // an IV of its own.
      startWithV1(current);

      let vault = await restart();

      await vault.unlock(current.password);
      await vault.add(added[0], current.password);
      await vault.add(added[1], current.password);
      await expect(
        cost(() => vault.add(added[2], current.password))
      ).resolves.toEqual([expect.anything(), 1]);
      expect(stored(V2).wallets[0]).toMatchObject({
        n: 1,
        ...recordOf(current),
      });
      expect(
        new Set(stored(V2).wallets.map((/** @type {any} */ w) => w.salt))
      ).toEqual(new Set([recordOf(current).salt]));
      expect(
        new Set(stored(V2).wallets.map((/** @type {any} */ w) => w.iv)).size
      ).toBe(4);
      await expect(unlock(current.password)).resolves.toEqual([
        [current.mnemonic, ...added],
        1,
      ]);

      // A new vault and three added, then a v1 record moved in beside them
      // with its own salt.
      localStorage.clear();
      vault = await restart();
      await vault.setUp(currentLong.mnemonic, current.password);

      for (const phrase of added) {
        await vault.add(phrase, current.password);
      }

      localStorage.setItem(V1, current.stored);
      await (await restart()).unlock(current.password);
      expect(stored(V2).wallets.at(-1)).toMatchObject({
        n: 5,
        ...recordOf(current),
      });
      await expect(unlock(current.password)).resolves.toEqual([
        [currentLong.mnemonic, ...added, current.mnemonic],
        2,
      ]);

      // A new password: one new salt for all of them.
      vault = await restart();
      await expect(
        cost(() => vault.changePassword(current.password, "a new password"))
      ).resolves.toEqual([undefined, 3]);
      expect(
        new Set(stored(V2).wallets.map((/** @type {any} */ w) => w.salt)).size
      ).toBe(1);
      await expect(unlock("a new password")).resolves.toEqual([
        [currentLong.mnemonic, ...added, current.mnemonic],
        1,
      ]);
    });

    it("adds and changes only with the password that opens every wallet held", async () => {
      // One wallet under another password (a vault set up again after a
      // downgrade), v1's under the password it was unlocked with.
      let vault = await restart();

      await vault.setUp(OTHER, "an older password");
      localStorage.setItem(V1, current.stored);
      vault = await restart();

      const [unlocked] = (await vault.unlock(current.password)).wallets;
      const before = { ...localStorage };
      const held = [unlocked.id];

      await expect(
        vault.add(THIRD, "an older password", { held })
      ).rejects.toThrow("Wrong password");
      await expect(
        vault.changePassword("an older password", "new password", { held })
      ).rejects.toThrow("Wrong password");
      expect({ ...localStorage }).toEqual(before);

      await vault.add(THIRD, current.password, { held });
      expect(phrases(await vault.unlock(current.password))).toEqual([
        current.mnemonic,
        THIRD,
      ]);
    });

    it("puts the old vault back when the new password's vault doesn't read back", async () => {
      const { vault } = await twoWallets();
      const before = localStorage.getItem(V2);

      failAt(READ_BACK);
      await expect(
        vault.changePassword("password123", "new password")
      ).rejects.toThrow("couldn't be saved");
      expect(localStorage.getItem(V2)).toBe(before);

      // Read back as the vault from before the write.
      failAt();
      answerAt(READ_BACK, before);
      await expect(
        vault.changePassword("password123", "new password")
      ).rejects.toThrow("couldn't be saved");
      expect(localStorage.getItem(V2)).toBe(before);
      expect(phrases(await vault.unlock("password123"))).toEqual([
        OTHER,
        THIRD,
      ]);
    });

    it("refuses changes while v1 is still to move, so a removed wallet can't come back", async () => {
      startWithV1(current);

      const vault = await restart();

      failAt(`set:${V2}`);
      await expect(
        vault.changePassword(current.password, "new password")
      ).rejects.toThrow("couldn't be saved");
      expect(localStorage.getItem(V1)).toBe(current.stored);
      expect(localStorage.getItem(V2)).toBeNull();
    });
  });
});
