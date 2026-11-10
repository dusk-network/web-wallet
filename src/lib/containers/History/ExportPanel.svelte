<svelte:options immutable={true} />

<script>
  /**
   * History's Export: which period, what to add, and Save CSV. The file is read
   * whole as it's asked for, and says what it leaves out.
   */
  import { mdiCheck } from "@mdi/js";

  import { routes } from "@dusk-network/networks";

  import {
    currencyWords,
    evmAddressesOf,
    exportCurrency,
    makeExport,
    otherProfiles,
    periodChoices,
    periodOf,
    readRewardsByYear,
    savedWords,
  } from "$lib/activity/accountantExport";
  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import { Button, Select, Textbox } from "$lib/dusk/components";
  import { createCurrencyFormatter, formatDuskExact } from "$lib/dusk/currency";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    isValidEvmAddress,
    randomUUID,
    shortenAddress,
  } from "$lib/dusk/string";
  import { WalletChangedError } from "$lib/errors";
  import { settingsStore, walletStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import walletAccountNames from "$lib/wallets/accountNames";
  import { account as evmAccount } from "$lib/web3/walletConnection";

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
  let fiat = false;
  let excel = false;
  let problem = "";

  /** What's being read: the file, or the rewards by year. */
  /** @type {"" | "file" | "rewards"} */
  let busyWith = "";

  /** Staking rewards by calendar year, once asked for. */
  /** @type {Awaited<ReturnType<typeof readRewardsByYear>> | null} */
  let rewards = null;

  /** EVM addresses of the person's, added for this file. */
  /** @type {string[]} */
  let added = [];

  /** Whether one is being added, and what's typed for it. */
  let isAdding = false;
  let typedAddress = "";
  let addProblem = "";

  function addAddress() {
    const address = typedAddress.trim();

    if (!isValidEvmAddress(address)) {
      addProblem = "That isn't an EVM address.";

      return;
    }

    added = [...added, address];
    typedAddress = "";
    addProblem = "";
    isAdding = false;
  }

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

    busyWith = "file";

    // The file is of what's open as it begins: with anything else open once
    // it's read, there's none.
    const stillOpen = walletStore.whileOpen();
    const own = [account?.address ?? "", shieldedAddress];
    const contacts = contactNamesOf($contactsStore);

    try {
      const made = await makeExport({
        choices: { excel, fiat, from, period, to, withContacts },
        contactName: (address) => contacts.get(address),
        currency,
        evmConnected: [...($evmAccount.addresses ?? []), ...added],
        net: $nodeNetwork,
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
      busyWith = "";
    }
  }

  async function showRewards() {
    if (isBusy) {
      return;
    }

    problem = "";
    busyWith = "rewards";

    const stillOpen = walletStore.whileOpen();

    try {
      const read = await readRewardsByYear({
        currency,
        fiat,
        session:
          /** @type {NonNullable<ReturnType<typeof walletStore.startHistory>>} */ (
            walletStore.startHistory()
          ),
      });

      stillOpen();
      rewards = read;
    } catch (error) {
      problem =
        error instanceof WalletChangedError
          ? "The wallet changed while this was read. Try again."
          : /** @type {Error} */ (error).message;
    } finally {
      busyWith = "";
    }
  }

  /**
   * A year's rewards, in DUSK and what they were worth, where asked.
   *
   * @param {import("@dusk-network/app-core/export").RewardsSum} sum
   * @param {string | null} valued The currency they're valued in
   */
  function rewardText({ lux, unpriced, worth }, valued) {
    const dusk = `${formatDuskExact(lux, $settingsStore.language)} DUSK`;

    if (!valued || worth === null) {
      return dusk;
    }

    const money = createCurrencyFormatter($settingsStore.language, valued, 2);
    // What a cent can't show, as under one.
    const value =
      Number(worth) > 0 && Number(worth) < 0.01
        ? `under ${money(0.01)}`
        : money(Number(worth));

    if (!unpriced) {
      return `${dusk} · ${value}`;
    }

    const { one } = currencyWords(valued);

    return Number(worth)
      ? `${dusk} · ${value}, ${unpriced} with no ${one} value`
      : `${dusk} · no ${one} value`;
  }

  $: isBusy = busyWith !== "";
  // As the wallet's amounts are, in Settings' currency.
  $: currency = exportCurrency($settingsStore.currency, navigator.language);
  // Where DUSK could come over from another chain, the gas it took there
  // is the person's from their EVM addresses: which, said.
  $: hasMigrations = Boolean(
    $nodeNetwork &&
    routes($nodeNetwork).some(({ kind }) => kind === "migration")
  );
  $: evm = evmAddressesOf($evmAccount.addresses ?? [], added);
  $: evmList = new Intl.ListFormat("en", { type: "conjunction" }).format(
    evm.map(({ address }) => shortenAddress(address))
  );
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
    <input bind:checked={fiat} class="dusk-checkbox" type="checkbox" />
    Add each payment's value in {currencyWords(currency).many}, from CoinGecko's
    prices (the past year)
  </label>
  <label class="export-panel__option">
    <input bind:checked={excel} class="dusk-checkbox" type="checkbox" />
    For Excel: keep accents as it opens
  </label>
  {#if hasMigrations}
    <div class="export-panel__evm">
      <p class="export-panel__note">
        {evm.length
          ? `The file has the network fees your migrations paid from ${evmList}.`
          : "The file has no network fees of migrations: no EVM address of yours is known here."}
      </p>
      {#if isAdding}
        <label class="export-panel__field">
          <span>EVM address you migrated from</span>
          <Textbox
            autocapitalize="off"
            autocomplete="off"
            bind:value={typedAddress}
            disabled={isBusy}
            on:keydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addAddress();
              }
            }}
            placeholder="0x…"
            spellcheck="false"
            type="text"
          />
        </label>
        {#if addProblem}
          <p class="export-panel__error" role="alert">{addProblem}</p>
        {/if}
        <Button
          disabled={isBusy}
          on:click={addAddress}
          size="small"
          text="Add"
          variant="secondary"
        />
      {:else}
        <Button
          disabled={isBusy}
          on:click={() => {
            isAdding = true;
          }}
          size="small"
          text="Add an EVM address"
          variant="secondary"
        />
      {/if}
    </div>
  {/if}
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
    text={busyWith === "file" ? "Reading your history…" : "Save CSV"}
    variant="primary"
  />
  <div class="export-panel__rewards">
    <Button
      disabled={isBusy}
      on:click={showRewards}
      size="small"
      text={busyWith === "rewards"
        ? "Reading your history…"
        : "Show staking rewards by year"}
      variant="secondary"
    />
    {#if rewards}
      {#if rewards.years.length}
        <table class="export-panel__years">
          <caption>Staking rewards by year</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Native staking, claimed</th>
              <th scope="col">Sozu, taken out</th>
            </tr>
          </thead>
          <tbody>
            {#each rewards.years as { claimed, sozu, year } (year)}
              <tr>
                <th scope="row">{year}</th>
                <td>{rewardText(claimed, rewards.currency)}</td>
                <td
                  >{sozu
                    ? rewardText(sozu, rewards.currency)
                    : "Couldn't be read"}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="export-panel__note">No staking rewards yet.</p>
      {/if}
      {#if rewards.shieldedWaiting}
        <p class="export-panel__note">
          Your shielded activity is still syncing: show them again once it's
          done.
        </p>
      {/if}
    {/if}
  </div>
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

  .export-panel__evm {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;

    & .export-panel__field {
      align-self: stretch;
    }
  }

  .export-panel__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
  }

  .export-panel__rewards {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .export-panel__years {
    align-self: stretch;
    border-collapse: collapse;
    font-size: 0.875rem;
    line-height: 1.4;
    text-align: left;

    & caption {
      margin-bottom: 0.375rem;
      font-weight: 500;
      text-align: left;
    }

    & th,
    & td {
      padding: 0.375rem 0.75rem 0.375rem 0;
      border-top: 1px solid var(--calm-line);
      vertical-align: top;
    }

    & thead th {
      color: var(--calm-muted);
      font-weight: 400;
    }
  }
</style>
