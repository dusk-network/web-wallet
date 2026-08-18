export const INACTIVITY_TIMEOUT = 15 * 60 * 1000;

const activityEvents = ["keydown", "pointerdown", "wheel"];

/**
 * @param {() => unknown} onInactive
 * @param {number} [timeout]
 * @returns {() => void}
 */
function startInactivityTimer(onInactive, timeout = INACTIVITY_TIMEOUT) {
  let expiresAt = Date.now() + timeout;
  let timeoutId = 0;
  let stopped = false;

  function stop() {
    if (!stopped) {
      stopped = true;
      window.clearTimeout(timeoutId);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, handleActivity)
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  }

  function expire() {
    if (!stopped) {
      stop();
      onInactive();
    }
  }

  function checkDeadline() {
    if (Date.now() >= expiresAt) {
      expire();
    } else {
      arm();
    }
  }

  function arm() {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(checkDeadline, expiresAt - Date.now());
  }

  function handleActivity() {
    if (Date.now() >= expiresAt) {
      expire();
    } else {
      expiresAt = Date.now() + timeout;
      arm();
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      checkDeadline();
    }
  }

  activityEvents.forEach((event) =>
    window.addEventListener(event, handleActivity)
  );
  document.addEventListener("visibilitychange", handleVisibilityChange);
  arm();

  return stop;
}

export default startInactivityTimer;
