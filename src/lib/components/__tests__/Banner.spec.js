import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import {
  getAsHTMLElement,
  renderWithSimpleContent,
} from "$lib/dusk/test-helpers";

import { Banner } from "..";

describe("Banner", () => {
  afterEach(cleanup);

  it("should show its title above the content passed", () => {
    const { container } = renderWithSimpleContent(Banner, {
      props: { title: "Some title", variant: "info" },
    });
    const banner = getAsHTMLElement(container, ".banner");

    expect(banner).toHaveClass("banner--info");
    expect(getAsHTMLElement(banner, ".banner__title")).toHaveTextContent(
      "Some title"
    );
    expect(banner).toHaveTextContent(/^Some title\s*some text$/);
  });

  it("should show only its title when given no content", () => {
    const { container } = render(Banner, {
      props: { title: "This is your own address.", variant: "warning" },
    });
    const banner = getAsHTMLElement(container, ".banner");

    expect(banner).toHaveClass("banner--warning");
    expect(banner).toHaveTextContent(/^This is your own address\.$/);
  });
});
