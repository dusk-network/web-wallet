import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { rejectAfter, resolveAfter } from "$lib/dusk/promise";

import { Suspense } from "..";

vi.useFakeTimers();

describe("Suspense", () => {
  const delay = 1000;

  const baseProps = {
    waitFor: resolveAfter(delay, "some result"),
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("should add appropriate class names for gap variants", async () => {
    /** @type {import("svelte").ComponentProps<Suspense>} */
    const props = {
      ...baseProps,
      gap: "small",
    };
    const { container, rerender } = render(Suspense, { ...baseOptions, props });

    expect(container.firstElementChild).toHaveClass("dusk-suspense--small-gap");

    await rerender({ ...props, gap: "large" });

    expect(container.firstElementChild).toHaveClass("dusk-suspense--large-gap");
  });

  it("should say what it waits for beside the throbber from the first moment, as Loading… unless told", async () => {
    const { container, getByText, rerender } = render(Suspense, baseOptions);

    expect(container.querySelector(".dusk-throbber")).toBeInTheDocument();
    expect(getByText("Loading…")).toBeInTheDocument();

    await rerender({ ...baseProps, pendingMessage: "Processing transaction" });

    expect(getByText("Processing transaction")).toBeInTheDocument();
  });

  it("should say what it waits for, and why it failed", async () => {
    const waiting = render(Suspense, {
      ...baseOptions,
      props: { ...baseProps, pendingMessage: "Reading the network…" },
    });

    expect(waiting.getByText("Reading the network…")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(delay);

    expect(waiting.queryByText("Reading the network…")).toBeNull();

    cleanup();

    const failed = render(Suspense, {
      ...baseOptions,
      props: {
        errorMessage: "Operation failed",
        waitFor: rejectAfter(delay, new Error("some error")),
      },
    });

    await vi.advanceTimersByTimeAsync(delay);

    expect(failed.getByText("Operation failed")).toBeInTheDocument();
  });
});
