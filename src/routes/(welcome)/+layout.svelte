<script>
  import { onDestroy } from "svelte";

  import { Button, ErrorDetails, Throbber } from "$lib/dusk/components";
  import { Banner } from "$lib/components";
  import { WelcomeShell } from "$lib/containers/Shell";
  import { networkStore } from "$lib/stores";

  /** How long connecting goes on without a word, in milliseconds. */
  const QUIET_FOR = 5000;

  /** How often it tries again by itself once connecting failed, in milliseconds. */
  const RETRY_EVERY = 10_000;

  let isSlow = false;

  /** @type {ReturnType<typeof setTimeout>} */
  let slowTimer;

  /** @type {ReturnType<typeof setTimeout>} */
  let retryTimer;

  /**
   * The socket and what the node says it is: neither needs the other, and
   * asking after the socket opened costs a first visit a third of a second, as
   * Chrome then tries HTTP/3 before anything else.
   *
   * @param {() => Promise<unknown>} toConnect
   */
  function connectWith(toConnect) {
    clearTimeout(slowTimer);
    isSlow = false;

    // This try's own: one stopped for the next ends after that one starts.
    const timer = setTimeout(() => {
      isSlow = true;
    }, QUIET_FOR);
    const noWordNeeded = () => clearTimeout(timer);

    slowTimer = timer;

    const connected = Promise.all([toConnect(), networkStore.init()]);

    hasFailed = false;
    connected.then(noWordNeeded, noWordNeeded);
    connected.catch(() => {
      if (connecting === connected) {
        hasFailed = true;
        retryLater();
      }
    });

    return connected;
  }

  /** Whether the last try failed, which it says. */
  let hasFailed = false;

  /** @type {Promise<unknown>} */
  let connecting = connectWith(networkStore.connect);

  function tryAgain() {
    clearTimeout(retryTimer);
    connecting = connectWith(networkStore.reconnect);
  }

  /**
   * Tries again by itself, now and then, while it says it can't reach the
   * network: what it says stays until a try gets through.
   */
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      const failed = connecting;
      const attempt = Promise.all([
        networkStore.reconnect(),
        networkStore.init(),
      ]);

      attempt.then(
        () => {
          if (connecting === failed) {
            hasFailed = false;
            connecting = attempt;
          }
        },
        () => {
          if (connecting === failed) {
            retryLater();
          }
        }
      );
    }, RETRY_EVERY);
  }

  /** The browser says it's online again: a try now, where the last failed. */
  function handleOnline() {
    if (hasFailed) {
      tryAgain();
    }
  }

  onDestroy(() => {
    clearTimeout(slowTimer);
    clearTimeout(retryTimer);
  });
</script>

<svelte:window on:online={handleOnline} />

<WelcomeShell>
  {#await connecting}
    <div class="welcome-layout__loading" role="status">
      <Throbber />
      <strong>Connecting to the network…</strong>
      {#if isSlow}
        <p>The network is taking longer than usual to answer.</p>
        <Button text="Try again" variant="secondary" on:click={tryAgain} />
      {/if}
    </div>
  {:then}
    <slot />
  {:catch error}
    <div class="welcome-layout__error-container">
      <Banner
        className="welcome-layout__error"
        title="Network connection issue"
        variant="error"
      >
        <p>
          The wallet can't reach the network right now. Try again, or come back
          in a few minutes.
        </p>
        <ErrorDetails {error} summary="Error details" />
      </Banner>
      <Button
        className="welcome-layout__retry-button"
        text="Try again"
        on:click={tryAgain}
      />
    </div>
  {/await}
</WelcomeShell>

<style lang="postcss">
  .welcome-layout__error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--medium-gap);
    width: 100%;
  }
  :global {
    .welcome-layout__loading {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--medium-gap);
      text-align: center;
    }

    .welcome-layout__error > .banner__content {
      gap: var(--medium-gap);
    }

    .welcome-layout__retry-button {
      width: 100%;
    }
  }
</style>
