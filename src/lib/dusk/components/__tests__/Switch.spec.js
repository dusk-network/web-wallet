import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { Switch } from "..";

describe("Switch", () => {
  const baseProps = {};

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it('should render the "Switch" component with a default tab index of `0`', async () => {
    const { container, rerender } = render(Switch, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();

    await rerender({ ...baseProps, value: true });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should use the received tab index", () => {
    const props = {
      ...baseProps,
      tabindex: 5,
    };
    const { container } = render(Switch, { ...baseOptions, props });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should render the component in a disabled status with a tabindex of `-1`", async () => {
    const props = {
      ...baseProps,
      disabled: true,
      tabindex: 5,
    };
    const { container, rerender } = render(Switch, { ...baseOptions, props });

    expect(container.firstElementChild).toMatchSnapshot();

    await rerender({ ...props, value: true });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should pass additional class names and attributes to the root element", () => {
    const props = {
      ...baseProps,
      className: "foo bar",
      id: "some-id",
    };
    const { container } = render(Switch, { ...baseOptions, props });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  describe("Event handlers", () => {
    it("should dispatch a `change` event when the switch is clicked", async () => {
      const handler = vi.fn();
      const { getByRole } = render(Switch, {
        ...baseOptions,
        events: { change: handler },
      });
      const switchElement = getByRole("switch");

      await fireEvent.click(switchElement);
      await fireEvent.click(switchElement);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ detail: true })
      );
      expect(handler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ detail: false })
      );
    });

    it("should dispatch a `change` event when the user presses space on the switch", async () => {
      const handler = vi.fn();
      const { getByRole } = render(Switch, {
        ...baseOptions,
        events: { change: handler },
      });
      const switchElement = getByRole("switch");

      await fireEvent.keyDown(switchElement, { key: " " });
      await fireEvent.keyDown(switchElement, { key: " " });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ detail: true })
      );
      expect(handler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ detail: false })
      );
    });

    it("should not dispatch an event if the user presses another key", async () => {
      const handler = vi.fn();
      const { getByRole } = render(Switch, {
        ...baseOptions,
        events: { change: handler },
      });
      const switchElement = getByRole("switch");

      await fireEvent.keyDown(switchElement, { key: "Enter" });
      await fireEvent.keyDown(switchElement, { key: "a" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not dispatch an event if the switch is disabled", async () => {
      const props = {
        ...baseProps,
        disabled: true,
      };
      const handler = vi.fn();
      const { getByRole } = render(Switch, {
        ...baseOptions,
        events: { change: handler },
        props,
      });
      const switchElement = getByRole("switch");

      await fireEvent.click(switchElement);
      await fireEvent.keyDown(switchElement, { key: " " });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
