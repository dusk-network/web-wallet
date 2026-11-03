import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { ExclusiveChoice } from "..";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

describe("ExclusiveChoice", () => {
  /** @type {SelectOption[]} */
  const objectOptionsA = [
    { label: "one", value: "1" },
    { label: "two", value: "2" },
    { disabled: true, label: "three", value: "3" },
    { label: "four", value: "4" },
  ];

  const baseProps = {
    options: objectOptionsA,
    value: "2",
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/dusk/string");
  });

  it("should accept a change event handler", async () => {
    const changeHandler = vi.fn();
    const { container } = render(ExclusiveChoice, {
      ...baseOptions,
      events: { change: changeHandler },
    });
    const target = /** @type {HTMLInputElement} */ (
      container.querySelector("input[value='4']")
    );

    await fireEvent.click(target);

    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler).toHaveBeenCalledWith(expect.any(Event));
    expect(target.checked).toBe(true);
  });
});
