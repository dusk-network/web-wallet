<svelte:options immutable={true} />

<script>
  import { formatTime } from "@dusk-network/networks/format";
  import { mdiAlertOutline, mdiCheck } from "@mdi/js";

  import { isHistoryEnabled } from "$lib/activity";
  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import {
    CHECK_BALANCE_FIRST,
    dropUnsent,
    sendUnsentAgain,
    unsentSends,
    waitingText,
  } from "$lib/transactions";
  import {
    followHandedOver,
    handedOverStates,
  } from "$lib/transactions/handedOverSends";
  import { walletAccountNames } from "$lib/wallets";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import Banner from "../Banner/Banner.svelte";
  import MemoText from "../MemoText/MemoText.svelte";

  /** Whether History shows the sends: else the balance says what went. */
  const hasHistory = isHistoryEnabled();

  /**
   * Takes a send that never went out to Send's review, filled in with it,
   * on the profile it was sent from: it's sent from there, and said here
   * until it is.
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

  /**
   * Says a send handed over before its page went is on the chain, as it's
   * found there.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   * @param {import("$lib/transactions/handedOverSends").WentOut} wentOut
   */
  function sayWentOut(send, { blockHeight, error }) {
    const what = whatOf(send, $settingsStore.hideBalances);
    const block = ` In block ${blockHeight.toLocaleString(language || undefined)}.`;

    if (error) {
      toast(
        "error",
        `Failed: ${what}. The network fee was charged.`,
        mdiAlertOutline,
        8000
      );
    } else {
      toast("success", `Sent: ${what}.${block}`, mdiCheck, 8000);
    }
  }

  $: ({ currentProfile, profiles } = $walletStore);
  $: ({ networkName } = $networkStore);
  $: ({ hideBalances, language } = $settingsStore);
  // This network's, from a profile the wallet open has.
  $: kept = $unsentSends.filter(
    (send) =>
      send.network === networkName &&
      profiles.some((each) => String(each.account) === send.account)
  );
  // One handed over is looked up on the chain, and said once it isn't found
  // there: it's never said as not sent.
  $: for (const send of kept) {
    if (send.handedOver) {
      followHandedOver(send, (wentOut) => sayWentOut(send, wentOut));
    }
  }
  $: shown = kept.filter(
    (send) =>
      !send.handedOver || $handedOverStates.get(send.id) === "unconfirmed"
  );
</script>

<!-- Sends whose page closed, reloaded, locked or died before they ended:
  one that never went out is said until it's sent through Review, or
  dropped; one handed over until the chain has it, or the person is done
  with it. -->
{#each shown as send (send.id)}
  {#if send.handedOver}
    <Banner
      className="unsent-send unsent-send--handed-over"
      role="status"
      title={`Not confirmed: ${whatOf(send, hideBalances)}.`}
      variant="warning"
    >
      <p class="unsent-send__when">
        {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
        {formatTime(send.at, { locale: language || undefined })}
      </p>
      <p>
        It may have reached the network. {hasHistory
          ? "Check History before you send it again."
          : CHECK_BALANCE_FIRST}
      </p>
      <div class="unsent-send__actions">
        {#if hasHistory}
          <AppAnchorButton
            href={`/dashboard/transactions?tx=${send.handedOver.hash}`}
            size="small"
            text="Open History"
            variant="secondary"
          />
        {/if}
        <Button
          on:click={() => dropUnsent(send.id)}
          size="small"
          text="Done"
          variant="tertiary"
        />
      </div>
    </Banner>
  {:else}
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
  {/if}
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
