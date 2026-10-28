import { describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { pageHasTitle, pageTitle } from "..";

describe("pageTitle", () => {
  it("should say a page has a title of its own while one is on screen", () => {
    expect(get(pageHasTitle)).toBe(false);

    const first = pageTitle(document.createElement("h1"));
    const second = pageTitle(document.createElement("h1"));

    expect(get(pageHasTitle)).toBe(true);

    first.destroy();

    expect(get(pageHasTitle)).toBe(true);

    second.destroy();
    // Gone twice counts once.
    second.destroy();

    expect(get(pageHasTitle)).toBe(false);
  });

  it("should count a heading only while it's marked as the title", () => {
    const heading = pageTitle(document.createElement("h1"), false);

    expect(get(pageHasTitle)).toBe(false);

    heading.update(true);
    heading.update(true);

    expect(get(pageHasTitle)).toBe(true);

    heading.update(false);

    expect(get(pageHasTitle)).toBe(false);

    heading.destroy();

    expect(get(pageHasTitle)).toBe(false);
  });
});
