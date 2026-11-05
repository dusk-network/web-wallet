<svelte:options immutable={true} />

<script>
  /**
   * History's Export: which period, what to add, and Save CSV. The file is read
   * whole as it's asked for, and says what it leaves out.
   */
  import { mdiCheck } from "@mdi/js";

  import {
    makeExport,
    otherProfiles,
    periodChoices,
    periodOf,
    savedWords,
  } from "$lib/activity/accountantExport";
  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import { Button, Select, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { randomUUID } from "$lib/dusk/string";
  import { WalletChangedError } from "$lib/errors";
  import { walletStore } from "$lib/stores";
  import walletAccountNames from "$lib/wallets/accountNames";

  /** The account the file is of, and how the wallet names it. */
  /** @type {{ address: string, label: string } | null} */
  export let account;

  /** That profile's shielded address. */
  export let shieldedAddress = "";

  /** The network's name, for the file's name. */
  export let network = "";

  /** Called once the file is saved. */
  /** @type {() => void} */
  export let onSaved = () => {};

  const id = randomUUID();
  const choices = periodChoices();

  let period = "all";
  let from = "";
  let to = "";
  let withContacts = false;
  let euro = false;
  let excel = false;
  let isBusy = false;
  let problem = "";

  /**
   * Saves text as a file, as a download.
   *
   * @param {string} text
   * @param {string} name
   */
  function saveFile(text, name) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function save() {
    if (isBusy) {
      return;
    }

    problem = "";

    try {
      periodOf({ from, period, to });
    } catch (error) {
      problem = /** @type {Error} */ (error).message;

      return;
    }

    isBusy = true;

    // The file is of what's open as it begins: with anything else open once
    // it's read, there's none.
    const stillOpen = walletStore.whileOpen();
    const own = [account?.address ?? "", shieldedAddress];
    const contacts = contactNamesOf($contactsStore);

    try {
      const made = await makeExport({
        choices: { euro, excel, from, period, to, withContacts },
        contactName: (address) => contacts.get(address),
        network,
        profile: {
          account: account?.address,
          address: shieldedAddress,
          name: account?.label,
        },
        profiles: otherProfiles($walletAccountNames, own),
        session:
          /** @type {NonNullable<ReturnType<typeof walletStore.startHistory>>} */ (
            walletStore.startHistory()
          ),
      });

      stillOpen();

      if (made.count) {
        saveFile(made.csv, made.fileName);
        toast("success", savedWords(made), mdiCheck, 6000);
        onSaved();
      } else {
        problem = "There's nothing in that period, so nothing was saved.";
      }
    } catch (error) {
      problem =
        error instanceof WalletChangedError
          ? "The wallet changed while this was read, so nothing was saved. Export again."
          : /** @type {Error} */ (error).message;
    } finally {
      isBusy = false;
    }
  }
</script>

<section aria-label="Export CSV" class="export-panel" id="{id}-panel">
  <label class="export-panel__field">
    <span>Period</span>
    <Select
      aria-label="Period"
      bind:value={period}
      disabled={isBusy}
      options={choices}
    />
  </label>
  {#if period === "dates"}
    <div class="export-panel__dates">
      <label class="export-panel__field">
        <span>From</span>
        <Textbox bind:value={from} disabled={isBusy} type="date" />
      </label>
      <label class="export-panel__field">
        <span>To</span>
        <Textbox bind:value={to} disabled={isBusy} type="date" />
      </label>
    </div>
  {/if}
  <label class="export-panel__option">
    <input bind:checked={withContacts} class="dusk-checkbox" type="checkbox" />
    Add my contact names
  </label>
  <label class="export-panel__option">
    <input bind:checked={euro} class="dusk-checkbox" type="checkbox" />
    Add each payment's value in euros, from CoinGecko's prices (the past year)
  </label>
  <label class="export-panel__option">
    <input bind:checked={excel} class="dusk-checkbox" type="checkbox" />
    For Excel: keep accents as it opens
  </label>
  <p class="export-panel__note">
    One profile's file for tax tools such as Koinly: exact amounts, times in
    UTC, transfers between your profiles marked.
  </p>
  {#if problem}
    <p class="export-panel__error" role="alert">{problem}</p>
  {/if}
  <Button
    disabled={isBusy}
    on:click={save}
    text={isBusy ? "Reading your history…" : "Save CSV"}
    variant="primary"
  />
</section>

<style lang="postcss">
  .export-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding: 1rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
  }

  .export-panel__field {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 0.375rem;
    min-width: 0;
    color: var(--calm-muted);
    font-size: 0.875rem;

    & :global(.dusk-textbox) {
      width: 100%;
    }
  }

  .export-panel__dates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .export-panel__option {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .export-panel__note {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .export-panel__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
  }
</style>
