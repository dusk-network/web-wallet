import { describe, expect, it, vi } from "vitest";
import shuffleArray from "../shuffleArray.js";

describe("shuffleArray", () => {
  const sampleArray = [1, 2, 3, 4, 5];

  it("should not mutate the original array", () => {
    const copyOfOriginal = [...sampleArray];

    shuffleArray(sampleArray);
    expect(sampleArray).toStrictEqual(copyOfOriginal);
  });

  it("should return an array of the same length", () => {
    const shuffledArray = shuffleArray(sampleArray);

    expect(shuffledArray.length).toBe(sampleArray.length);
  });

  it("should contain the same elements", () => {
    const shuffledArray = shuffleArray(sampleArray);

    expect(shuffledArray.toSorted()).toStrictEqual(sampleArray.toSorted());
  });

  it("should shuffle the array elements", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);

    expect(shuffleArray(sampleArray)).toStrictEqual([2, 3, 4, 5, 1]);

    random.mockRestore();
  });
});
