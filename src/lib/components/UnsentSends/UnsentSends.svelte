<svelte:options immutable={true} />

<script>
  import { formatTime } from "@dusk-network/networks/format";
  import { mdiCheck } from "@mdi/js";

  import { isHistoryEnabled } from "$lib/activity";
  import { SENT_AFTER_DONT_SEND } from "$lib/activity/present";
  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import {
    CHECK_BALANCE_FIRST,
    dropUnsent,
    unsentSends,
    waitingText,
  } from "$lib/transactions";
  import {
    dontSendHandedOver,
    followHandedOver,
    foundSends,
    handedOverStates,
    lookAgainNow,
    sendHandedOverAgain,
    sentAgainRefusals,
  } from "$lib/transactions/handedOverSends";
  import reviewUnsent from "$lib/transactions/reviewUnsent";
  import {
    followSentMeanwhile,
    meanwhileKey,
    sayMeanwhile,
    sentMeanwhileChecking,
    sentMeanwhileTold,
  } from "$lib/transactions/sentMeanwhile";
  import { walletAccountNames } from "$lib/wallets";
  import accountNamer from "$lib/wallets/accountNamer";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import Banner from "../Banner/Banner.svelte";
  import MemoText from "../MemoText/MemoText.svelte";

  /**
   * Whether what it says of each send hides its amount: as balances are
   * where it's browsed, on Home, by default; never in Send's flow (false).
   *
   * @type {boolean | undefined}
   */
  export let hidden = undefined;

  /** Whether History shows the sends: else the balance says what went. */
  const hasHistory = isHistoryEnabled();

  /**
   * Takes a send that never went out to Send's review, filled in with it,
   * on the profile it was sent from: it's sent from there, and said here
   * until it is.
   */
  const sendNow = reviewUnsent;

  /**
   * Sends a send handed over, whose transaction the node doesn't have, its
   * nonce still free, again as it is: its very bytes. One whose bytes
   * weren't kept goes to Send's review instead, as one that never went out.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   */
  function sendAgainNow(send) {
    if (send.handedOver?.tx) {
      void sendHandedOverAgain(send);
    } else {
      void sendNow(send);
    }
  }

  /**
   * Doesn't send a send handed over, whose transaction the node doesn't
   * have, and says so: it may still arrive, and it's said then.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   */
  async function dontSendNow(send) {
    if (await dontSendHandedOver(send)) {
      // A toast is over whatever page shows: its amount as balances show
      // there, even where this list is drawn in Send's flow.
      toast(
        "info",
        `Not sent yet: ${whatOf(send, $settingsStore.hideBalances)}. If it still arrives, it shows here.`,
        mdiCheck,
      );
    }
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
      { hidden, locale: language },
    );
    const from =
      send.account === String(currentProfile?.account ?? "")
        ? ""
        : ($walletAccountNames.get(send.account) ?? "");

    return from ? what.replace(" DUSK to ", ` DUSK from ${from} to `) : what;
  }

  /**
   * Whether a send's account sent something else while it waited: it was
   * held for the person as it did, or another transaction took its nonce, or
   * the account's nonce, as last read for the profile shown, moved on since
   * it was sent.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   * @param {bigint} nonce The nonce of the profile shown, as last read
   */
  const isSentElsewhere = (send, nonce) =>
    send.sentElsewhere === true ||
    (send.seen !== undefined &&
      send.account === String(currentProfile?.account ?? "") &&
      nonce > BigInt(send.seen));

  /**
   * What a send's account sent while it waited, to look up and say: by the
   * nonces past the one the wallet knew as it was sent, up to the one of
   * the profile shown as last read, where it's that profile's. Null where
   * that can't be said.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   * @param {bigint} nonce The nonce of the profile shown, as last read
   * @returns {import("$lib/transactions/sentMeanwhile").Meanwhile | null}
   */
  const meanwhileOf = (send, nonce) =>
    send.seen !== undefined &&
    send.account === String(currentProfile?.account ?? "") &&
    nonce > BigInt(send.seen)
      ? {
          account: send.account,
          from: BigInt(send.seen),
          since: send.at,
          to: nonce,
        }
      : null;

  /**
   * What the balances are as last read: once they change, the sends handed
   * over are looked up at once, as a block with one may have changed them.
   */
  let balancesRead = "";

  /** @param {WalletStoreContent["balance"]} balance */
  function lookAgainOn(balance) {
    const read = `${balance.unshielded.value} ${balance.shielded.value}`;

    if (balancesRead && read !== balancesRead) {
      lookAgainNow();
    }

    balancesRead = read;
  }

  $: ({ balance, currentProfile, profiles } = $walletStore);
  $: lookAgainOn(balance);
  $: ({ networkName } = $networkStore);
  $: ({ language } = $settingsStore);
  $: hideBalances = hidden ?? $settingsStore.hideBalances;
  // This network's, from a profile the wallet open has.
  $: kept = $unsentSends.filter(
    (send) =>
      send.network === networkName &&
      profiles.some((each) => String(each.account) === send.account),
  );
  // One handed over is looked up on the chain, and said once it isn't found
  // there; for one held as its account sent something else, what that was.
  $: for (const send of kept) {
    const meanwhile = send.handedOver
      ? null
      : meanwhileOf(send, balance.unshielded.nonce);

    if (send.handedOver) {
      followHandedOver(send);
    } else if (meanwhile) {
      followSentMeanwhile(meanwhile);
    }
  }
  // Found on the chain a moment ago, said so in its notice's place.
  $: found = $foundSends.filter(
    ({ send }) =>
      send.network === networkName &&
      profiles.some((each) => String(each.account) === send.account),
  );
  // By its transaction: one sent again is another. One the node has in its
  // mempool is on its way, as Activity says. One the person chose not to
  // send isn't said, unless it arrives.
  $: shown = kept.filter(
    (send) =>
      !send.handedOver ||
      (!send.handedOver.dismissed &&
        ["not-sent", "sending", "unconfirmed"].includes(
          $handedOverStates.get(send.handedOver.hash) ?? "",
        )),
  );
</script>

<!-- Sends whose page closed, reloaded, locked or died before they ended, or
  whose answer got lost: one that never went out is said until it's sent
  through Review, or dropped; one handed over until the chain or the node
  says what became of it: that it went out, in its block, for a moment;
  that the node doesn't have it, its nonce still free, not sent yet, to
  send again as it is, or not; or, where they can't say, until the person
  is done with it. -->
{#each found as { send, wentOut } (send.handedOver?.hash ?? send.id)}
  <Banner
    className="unsent-send unsent-send--found"
    role="status"
    title={wentOut.error
      ? `Failed: ${whatOf(send, hideBalances)} (fee charged)`
      : send.handedOver?.dismissed
        ? `${SENT_AFTER_DONT_SEND}: ${whatOf(send, hideBalances)}`
        : `Sent: ${whatOf(send, hideBalances)}`}
    variant={wentOut.error ? "error" : "info"}
  >
    <p class="unsent-send__when">
      {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
      {formatTime(send.at, { locale: language || undefined })}
    </p>
    <p>
      In block {wentOut.blockHeight.toLocaleString(language || undefined)}.
    </p>
  </Banner>
{/each}
{#each shown as send (send.id)}
  {@const state = send.handedOver
    ? $handedOverStates.get(send.handedOver.hash)
    : undefined}
  {#if send.handedOver && state === "sending"}
    <Banner
      className="unsent-send unsent-send--handed-over"
      role="status"
      title={`Sending: ${whatOf(send, hideBalances)}`}
      variant="info"
    >
      <p class="unsent-send__when">
        {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
        {formatTime(send.at, { locale: language || undefined })}
      </p>
    </Banner>
  {:else if send.handedOver && state === "not-sent"}
    {@const why = $sentAgainRefusals.get(send.handedOver.hash)}
    <Banner
      className="unsent-send unsent-send--handed-over"
      role="status"
      title={`Not sent yet: ${whatOf(send, hideBalances)}`}
      variant="warning"
    >
      <p class="unsent-send__when">
        {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
        {formatTime(send.at, { locale: language || undefined })}
      </p>
      <p>{why ? `${why} ` : ""}If it still arrives, it shows here.</p>
      <div class="unsent-send__actions">
        <Button
          on:click={() => sendAgainNow(send)}
          size="small"
          text="Send now"
          variant="secondary"
        />
        <Button
          on:click={() => dontSendNow(send)}
          size="small"
          text="Don't send"
          variant="tertiary"
        />
      </div>
    </Banner>
  {:else if send.handedOver}
    <Banner
      className="unsent-send unsent-send--handed-over"
      role="status"
      title={`Not confirmed: ${whatOf(send, hideBalances)}`}
      variant="warning"
    >
      <p class="unsent-send__when">
        {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
        {formatTime(send.at, { locale: language || undefined })}
      </p>
      <p>
        It may have gone out. {hasHistory
          ? "Check Activity before sending again."
          : CHECK_BALANCE_FIRST}
      </p>
      <div class="unsent-send__actions">
        {#if hasHistory}
          <AppAnchorButton
            href={`/dashboard/transactions?tx=${send.handedOver.hash}`}
            size="small"
            text="Open Activity"
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
    {@const isElsewhere = isSentElsewhere(send, balance.unshielded.nonce)}
    {@const meanwhile = meanwhileOf(send, balance.unshielded.nonce)}
    {@const told = sayMeanwhile(
      meanwhile ? $sentMeanwhileTold.get(meanwhileKey(meanwhile)) : null,
      { address: send.to, lux: send.lux, memo: send.memo },
      {
        checking: Boolean(
          meanwhile && $sentMeanwhileChecking.has(meanwhileKey(meanwhile)),
        ),
        hidden: hideBalances,
        locale: language,
        nameOf: $accountNamer,
      },
    )}
    <Banner
      className="unsent-send"
      role="status"
      title={`Not sent: ${whatOf(send, hideBalances)}`}
      variant="warning"
    >
      <p class="unsent-send__when">
        {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
        {formatTime(send.at, { locale: language || undefined })}
      </p>
      <!-- What its account sent meanwhile, from the chain, once it's found,
        and whether it's the same payment. -->
      {#if isElsewhere}
        <p>{told.title}</p>
        {#if told.memo}
          <p class="unsent-send__when"><MemoText inline text={told.memo} /></p>
        {/if}
        {#each told.items as item, i (i)}
          <p class="unsent-send__when">
            {item.text}{#if item.memo}
              · <MemoText inline text={item.memo} />{/if}
          </p>
        {/each}
        {#if told.same}
          <p>{told.same}</p>
        {/if}
      {:else}
        <p>Nothing left your wallet.</p>
      {/if}
      <!-- Off while what its account sent is read: the answer may be that
        it's this same payment. -->
      <div class="unsent-send__actions">
        <Button
          disabled={isElsewhere && told.checking}
          on:click={() => sendNow(send)}
          size="small"
          text={isElsewhere ? "Send it too" : "Send now"}
          variant="secondary"
        />
        <Button
          disabled={isElsewhere && told.checking}
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
