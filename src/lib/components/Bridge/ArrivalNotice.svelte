<svelte:options immutable={true} />

<script>
  /**
   * On what shows a transfer on its way: being told when it arrives, as far as
   * this browser can.
   */
  import {
    arrivalNoticeState,
    chooseArrivalNotice,
    noticeWords,
    stopArrivalNotice,
  } from "$lib/bridge/arrivalNotice";
</script>

<!-- What it can do here, said with the offer: it's the open page that tells. -->
<p class="arrival-notice">
  {#if $arrivalNoticeState === "offer"}
    <button on:click={chooseArrivalNotice} type="button"
      >Tell me when it arrives</button
    >
    {noticeWords("offer")}
  {:else}
    {noticeWords($arrivalNoticeState)}
    {#if $arrivalNoticeState === "on"}
      <button on:click={stopArrivalNotice} type="button">Turn off</button>
    {/if}
  {/if}
</p>

<style lang="postcss">
  .arrival-notice {
    color: var(--calm-muted);
    font-size: 0.875rem;
    line-height: 1.4;

    & button {
      min-height: 2.75rem;
      padding: 0;
      border: 0;
      background: none;
      color: var(--calm-text);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  }
</style>
