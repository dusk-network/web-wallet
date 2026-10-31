/**
 * What one tab tells the others of the wallets: another opened ("switch"),
 * one added, removed or renamed ("wallets"), a new password ("password"),
 * or all of them locked ("lock"). It goes through this browser's storage,
 * whose change every other tab of the wallet hears, and the tab that tells
 * it doesn't.
 */

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallet-event`;

/**
 * @typedef {{ key: string, profile: number, type: "switch" }
 *   | { type: "lock" | "password" | "wallets" }} TabEvent
 */

/**
 * Tells the other tabs.
 *
 * @param {TabEvent} event
 */
export function tellOtherTabs(event) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...event,
        // A new value each time, as the same event twice is two changes.
        id: crypto.randomUUID(),
      })
    );
  } catch {
    // The other tabs see the change as they next read it.
  }
}

/**
 * The events another tab tells, as they come.
 *
 * @param {(event: TabEvent) => void} handler
 * @returns {() => void} Stops listening
 */
export function onOtherTabs(handler) {
  /** @param {StorageEvent} event */
  const onStorage = ({ key, newValue, storageArea }) => {
    if (storageArea !== localStorage || key !== KEY || !newValue) {
      return;
    }

    try {
      const event = JSON.parse(newValue);

      if (["lock", "password", "switch", "wallets"].includes(event?.type)) {
        handler(event);
      }
    } catch {
      // Not an event.
    }
  };

  window.addEventListener("storage", onStorage);

  return () => window.removeEventListener("storage", onStorage);
}
