import { get, writable } from "svelte/store";

/**
 * @type {import('svelte/store').Writable<ToastItem[]>}
 * @description Stores each toast as an object in the array
 */
export const toastList = writable([]);

/**
 * @type {import('svelte/store').Writable<Number>}
 * @description Stores the timer fused by all toasts
 */
export const toastTimer = writable(0);

/**
 * @param {TooltipType} type
 * @param {string} message
 * @param {string} icon
 * @param {number} [ms] How long it shows, if not as long as the others
 */

function addToast(type, message, icon, ms = get(toastTimer)) {
  const id = `dusk-toast-${Math.random().toString(36)}`;

  toastList.update((store) => {
    return [
      ...store,
      {
        icon: icon,
        id: id,
        message: message,
        type: type,
      },
    ];
  });

  timers.set(
    id,
    window.setTimeout(() => {
      deleteToast(id);
    }, ms),
  );
}

/**
 * The timer that takes each toast away, by its id: one that's dismissed
 * leaves none behind.
 *
 * @type {Map<string, number>}
 */
const timers = new Map();

/**
 * @param {string} id
 */
function deleteToast(id) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);

  // Deletes toast from store queue
  toastList.update((store) => {
    return store.filter((toast) => toast.id !== id);
  });
}

/**
 * Takes every toast away now, with the timers that would have: nothing of
 * them is left to run, as once a test is done with the page.
 */
export function dismissToasts() {
  for (const id of [...timers.keys()]) {
    deleteToast(id);
  }
}

export const toast = addToast;
