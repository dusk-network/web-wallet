import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { mdiCheckDecagramOutline } from "@mdi/js";

import { Stepper } from "..";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

describe("Stepper", () => {
  const baseProps = {
    activeStep: 2,
    steps: [
      { label: "foo" },
      { label: "bar" },
      { label: "baz" },
      { label: "qux" },
      { iconPath: mdiCheckDecagramOutline, label: "quux" },
    ],
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/dusk/string");
  });

  it("should render the `Stepper` component accepting an array of `StepperStep` objects as steps", async () => {
    const { container, rerender } = render(Stepper, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();

    await rerender({ ...baseProps, activeStep: 3 });
  });
});
