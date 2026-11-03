import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { mdiAlertOutline, mdiCheck } from "@mdi/js";

import { recordAnimations } from "$lib/dusk/test-helpers";

import { Toast } from "..";
import { toast, toastList } from "../Toast/store";

/** @typedef {import("$lib/dusk/test-helpers/recordAnimations").AnimationRun} AnimationRun */

/**
 * How far along a frame is: its opacity, and how far it is below where it
 * stays, in pixels.
 *
 * @param {Keyframe} frame
 */
const placeOf = (frame) => ({
  below: Number(
    /translate\(0px, ([\d.-]+)px\)/.exec(String(frame.transform))?.[1] ?? 0
  ),
  opacity: Number(frame.opacity),
});

describe("Toast", () => {
  const baseProps = { timer: 2000 };

  /** @type {ReturnType<typeof recordAnimations>} */
  let animations;

  /** @param {Element} item */
  const runsOn = (item) =>
    animations.runs.filter(({ element }) => element === item);

  /** @param {HTMLElement} list */
  const getToastItems = (list) => list.querySelectorAll(".dusk-toast__item");

  // A toast stands at full opacity, as the page's style has it.
  const style = document.createElement("style");

  style.textContent = ".dusk-toast__item { opacity: 1; }";

  vi.useFakeTimers();

  beforeAll(() => {
    document.head.append(style);
  });

  beforeEach(() => {
    animations = recordAnimations();
  });

  afterEach(() => {
    toastList.set([]);
    cleanup();
    animations.restore();
  });

  afterAll(() => {
    style.remove();
    vi.useRealTimers();
  });

  it("should fade a message in from 4 px below, over 200 ms, easing in where it stays", async () => {
    const { getByRole } = render(Toast, baseProps);

    toast("success", "Name saved.", mdiCheck);
    await tick();

    const [item] = getToastItems(getByRole("list"));
    const [arrival] = runsOn(item);
    const frames = arrival.keyframes.map(placeOf);
    const middle = frames[Math.round((frames.length - 1) / 2)];

    expect(item).toHaveTextContent("Name saved.");
    expect(arrival.duration).toBe(200);
    expect(frames[0]).toStrictEqual({ below: 4, opacity: 0 });
    expect(frames.at(-1)).toStrictEqual({ below: 0, opacity: 1 });
    // Svelte's quartOut: most of the way there by half its time.
    expect(middle.opacity).toBeCloseTo(0.9375, 2);
    expect(middle.below).toBeCloseTo(0.25, 2);
  });

  it("should fade a message out in place over 120 ms, and only then take it away", async () => {
    const { getByRole } = render(Toast, baseProps);

    toast("success", "Name saved.", mdiCheck);
    await tick();

    const list = getByRole("list");
    const [item] = getToastItems(list);

    runsOn(item).forEach((run) => run.finish());
    await vi.advanceTimersByTimeAsync(baseProps.timer);

    // Gone from the list, still on its way out.
    expect(get(toastList)).toStrictEqual([]);
    expect(getToastItems(list)).toHaveLength(1);

    const leaving = /** @type {AnimationRun} */ (runsOn(item).at(-1));
    const frames = leaving.keyframes.map(placeOf);

    expect(leaving.duration).toBe(120);
    expect(frames.every(({ below }) => below === 0)).toBe(true);
    expect(leaving.keyframes.some((frame) => frame.transform)).toBe(false);
    expect(frames[0].opacity).toBe(1);
    expect(frames.at(-1)?.opacity).toBe(0);
    // Svelte's cubicIn: slow to start leaving.
    expect(frames[Math.round((frames.length - 1) / 2)].opacity).toBeCloseTo(
      0.875,
      2
    );

    leaving.finish();
    await tick();

    expect(getToastItems(list)).toHaveLength(0);
  });

  it("should show each message, the others moving up once one is gone", async () => {
    const { getByRole } = render(Toast, baseProps);
    const list = getByRole("list");

    toast("success", "Name saved.", mdiCheck);
    await vi.advanceTimersByTimeAsync(450);
    toast("error", "Couldn't copy the address", mdiAlertOutline);
    await tick();

    expect(get(toastList)).toStrictEqual([
      {
        icon: mdiCheck,
        id: expect.any(String),
        message: "Name saved.",
        type: "success",
      },
      {
        icon: mdiAlertOutline,
        id: expect.any(String),
        message: "Couldn't copy the address",
        type: "error",
      },
    ]);
    expect(
      Array.from(getToastItems(list), (item) => item.textContent?.trim())
    ).toStrictEqual(["Name saved.", "Couldn't copy the address"]);
    expect(
      list.querySelector(".dusk-toast__item-icon-wrapper--error")
    ).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1550);
    animations.runs.forEach((run) => run.finish());
    await tick();

    expect(
      Array.from(getToastItems(list), (item) => item.textContent?.trim())
    ).toStrictEqual(["Couldn't copy the address"]);
  });

  it("should render the Toast component with the correct custom class and rest props", async () => {
    const customProps = {
      className: "test-toast",
      "data-baz": "baz",
      id: "toast-container",
      timer: 2000,
    };

    const { getByRole } = render(Toast, customProps);
    const list = getByRole("list");

    expect(list).toHaveClass(`${customProps.className}`);
    expect(list).toHaveAttribute("id", customProps.id);
    expect(list).toHaveAttribute("data-baz", customProps["data-baz"]);

    expect(list).toMatchSnapshot();
  });
});
