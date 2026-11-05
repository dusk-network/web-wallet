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

  const timeoutID = window.setTimeout(() => {
    deleteToast(id, timeoutID);
  }, ms);
}

/**
 * @param {string} id
 * @param {number} timeout
 */
function deleteToast(id, timeout) {
  window.clearTimeout(timeout);

  // Deletes toast from store queue
  toastList.update((store) => {
    return store.filter((toast) => toast.id !== id);
  });
}

export const toast = addToast;
