import { vi } from "vitest";

import { CONFIRM_DELAY } from "$lib/dusk/motion";

/**
 * Waits out the moment a button that sends, stakes or signs ignores clicks
 * once its step shows, as a person does before pressing it. It moves the
 * fake clock on, which needs `performance` faked at least, as with
 * `vi.useFakeTimers({ toFake: ["performance"] })`.
 */
const afterConfirmDelay = () => vi.advanceTimersByTimeAsync(CONFIRM_DELAY);

export default afterConfirmDelay;
