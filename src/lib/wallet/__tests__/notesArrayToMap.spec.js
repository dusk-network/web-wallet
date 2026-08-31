import { describe, expect, it } from "vitest";
import { cacheUnspentNotes } from "$lib/mock-data";

import { notesArrayToMap } from "..";

describe("notesArrayToMap", () => {
  it("should convert an array of notes to the map format used by `w3sper.js`", () => {
    const notesMap = notesArrayToMap(cacheUnspentNotes);
    const groupedNotes = Object.groupBy(
      cacheUnspentNotes,
      ({ address }) => address
    );
    const addresses = Object.keys(groupedNotes);

    expect(Array.from(notesMap.keys())).toStrictEqual(addresses);

    addresses.forEach((address) => {
      const entries = groupedNotes[address] ?? [];
      const expectedKeys = entries.map(({ nullifier }) => nullifier);
      const expectedValues = entries.map(({ note }) => note);
      const noteMap = notesMap.get(address) ?? new Map();

      expect(Array.from(noteMap.keys())).toStrictEqual(expectedKeys);
      expect(Array.from(noteMap.values())).toStrictEqual(expectedValues);
    });
  });

  it("should return an empty map if supplied with an empty array", () => {
    expect(notesArrayToMap([])).toStrictEqual(new Map());
  });
});
