import { describe, expect, it } from "vitest";
import { getPublicSpendKeyCharacterCount } from "..";

describe("getPublicSpendKeyCharacterCount", () => {
	it("should return minimum characters for widths less than the minimum width", () => {
		expect(getPublicSpendKeyCharacterCount(300)).toBe(5);
	});

	it("should return minimum characters for width equal to the minimum width", () => {
		expect(getPublicSpendKeyCharacterCount(320)).toBe(5);
	});

	it("should return correct characters for a width between the minimum and maximum widths", () => {
		expect(getPublicSpendKeyCharacterCount(500)).toBe(12);
	});

	it("should return maximum characters for width equal to the maximum width", () => {
		expect(getPublicSpendKeyCharacterCount(800)).toBe(20);
	});

	it("should return maximum characters for widths greater than the maximum width", () => {
		expect(getPublicSpendKeyCharacterCount(900)).toBe(20);
	});
});
