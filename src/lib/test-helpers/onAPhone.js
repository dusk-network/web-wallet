import { vi } from "vitest";

import { MediaQueryList } from "$lib/dusk/mocks";

/**
 * The device as a phone's for a test: touch alone, a coarse pointer and
 * nothing that hovers (touchOnly). With a pen, as Firefox and Chrome name
 * one: a fine pointer too, that can't hover. Restore it as the test ends.
 *
 * @param {{ pen?: boolean }} [has]
 * @returns {import("vitest").MockInstance} What restores it
 */
export default function onAPhone({ pen = false } = {}) {
  const matching = [
    "(any-pointer: coarse)",
    "(any-hover: none)",
    ...(pen ? ["(any-pointer: fine)"] : []),
  ];

  return vi
    .spyOn(window, "matchMedia")
    .mockImplementation(
      (query) =>
        /** @type {globalThis.MediaQueryList} */ (
          /** @type {unknown} */ (
            new MediaQueryList(query, matching.includes(query))
          )
        ),
    );
}
