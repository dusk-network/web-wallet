<svelte:options immutable={true} />

<script>
  import { formatTime } from "@dusk-network/networks/format";

  import { Button } from "$lib/dusk/components";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import {
    dropUnsent,
    sendUnsentAgain,
    unsentSends,
    waitingText,
  } from "$lib/transactions";
  import { walletAccountNames } from "$lib/wallets";

  import Banner from "../Banner/Banner.svelte";
  import MemoText from "../MemoText/MemoText.svelte";

  /**
   * Opens Send filled in with a send that never went out, to be reviewed, on
   * the profile it was sent from.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   */
  async function sendNow(send) {
    const profile = profiles.find(
      (each) => String(each.account) === send.account
    );

    if (!profile) {
      return;
    }

    // The profile it's sent from first: Send takes it for that one alone.
    if (profile !== currentProfile) {
      walletStore.setCurrentProfile(profile).catch(() => {});
    }

    sendUnsentAgain(send);
    await goto("/dashboard/send");
  }

  /**
   * What it sends, and from which profile where that isn't the one shown.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   * @param {boolean} hidden
   */
  function whatOf(send, hidden) {
    const what = waitingText(
      { lux: send.lux, to: send.label },
      { hidden, locale: language }
    );
    const from =
      send.account === String(currentProfile?.account ?? "")
        ? ""
        : ($walletAccountNames.get(send.account) ?? "");

    return from ? what.replace(" DUSK to ", ` DUSK from ${from} to `) : what;
  }

  $: ({ currentProfile, profiles } = $walletStore);
  $: ({ networkName } = $networkStore);
  $: ({ hideBalances, language } = $settingsStore);
  // This network's, from a profile the wallet open has.
  $: shown = $unsentSends.filter(
    (send) =>
      send.network === networkName &&
      profiles.some((each) => String(each.account) === send.account)
  );
</script>

<!-- Sends whose page closed, reloaded or locked before they went out: said
  until they're sent again, through Review, or dropped. -->
{#each shown as send (send.id)}
  <Banner
    className="unsent-send"
    role="status"
    title={`Not sent: ${whatOf(send, hideBalances)}.`}
    variant="warning"
  >
    <p class="unsent-send__when">
      {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
      {formatTime(send.at, { locale: language || undefined })}
    </p>
    <p>Nothing left your wallet.</p>
    <div class="unsent-send__actions">
      <Button
        on:click={() => sendNow(send)}
        size="small"
        text="Send it now"
        variant="secondary"
      />
      <Button
        on:click={() => dropUnsent(send.id)}
        size="small"
        text="Don't send"
        variant="tertiary"
      />
    </div>
  </Banner>
{/each}

<style lang="postcss">
  .unsent-send__when {
    color: var(--calm-muted);
    overflow-wrap: anywhere;
  }

  .unsent-send__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
