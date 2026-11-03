import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { rejectAfter, resolveAfter } from "$lib/dusk/promise";

import { OperationResult } from "..";

vi.useFakeTimers();

describe("OperationResult", () => {
  const delay = 1000;

  const onBeforeLeave = vi.fn();

  const baseProps = {
    onBeforeLeave,
    operation: resolveAfter(delay, ""),
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(() => {
    cleanup();
    onBeforeLeave.mockClear();
  });

  it("should call the `onBeforeLeave` function when the home button is clicked", async () => {
    const { getByRole } = render(OperationResult, baseOptions);

    await vi.advanceTimersByTimeAsync(delay);

    const homeBtn = getByRole("link");

    // prevents the browser from attempting to navigate
    // to the link's href, which jsdom cannot handle
    homeBtn.addEventListener("click", (event) => event.preventDefault());

    await fireEvent.click(homeBtn);

    expect(baseProps.onBeforeLeave).toHaveBeenCalledTimes(1);
  });

  it("should say what it was told to as it waits, once it's done, and when it fails", async () => {
    const messages = {
      errorMessage: "Transaction failed",
      pendingMessage: "Transaction pending",
      successMessage: "Transaction created",
    };
    const done = render(OperationResult, {
      ...baseOptions,
      props: { ...baseProps, ...messages, operation: resolveAfter(delay, "") },
    });

    expect(done.getByText("Transaction pending")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(delay);

    expect(done.getByText("Transaction created")).toBeInTheDocument();
    expect(done.queryByText("Transaction pending")).toBeNull();

    cleanup();

    const failed = render(OperationResult, {
      ...baseOptions,
      props: {
        ...baseProps,
        ...messages,
        operation: rejectAfter(delay, new Error("some error")),
      },
    });

    await vi.advanceTimersByTimeAsync(delay);

    expect(failed.getByText("Transaction failed")).toBeInTheDocument();
    expect(failed.queryByText("Transaction created")).toBeNull();
  });
});
