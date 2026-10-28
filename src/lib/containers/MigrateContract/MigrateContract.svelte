<svelte:options immutable={true} />

<script>
  import {
    mdiArrowDown,
    mdiCheckDecagramOutline,
    mdiChevronDown,
    mdiClockOutline,
  } from "@mdi/js";
  import { switchChain } from "@wagmi/core";
  import { formatUnits, parseUnits } from "viem";
  import { onMount } from "svelte";
  import { tokens } from "./tokenConfig";
  import { getDecimalSeparator, slashDecimals } from "$lib/dusk/number";
  import { cleanNumberString, shortenAddress } from "$lib/dusk/string";
  import {
    ApproveMigration,
    BalanceValue,
    Banner,
    ExecuteMigration,
  } from "$lib/components";
  import NetworkMark from "$lib/components/NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "$lib/components/NetworkPicker/NetworkPicker.svelte";
  import SwapCard from "$lib/components/SwapCard/SwapCard.svelte";
  import { Button, Icon, Stepper } from "$lib/dusk/components";
  import { pageTitle } from "$lib/navigation";
  import { settingsStore, walletStore } from "$lib/stores";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import {
    account,
    modal,
    wagmiConfig,
    walletDisconnect,
  } from "$lib/web3/walletConnection";
  import { getBalanceOfCoin } from "$lib/web3/migration";
  import {
    migrationRoute,
    routeTime,
    routeTimeText,
  } from "$lib/bridge/routeTimes";

  /** @type {string} */
  export let migrationNetwork;

  $: ({ language } = $settingsStore);
  $: ({ isConnected, address } = $account);

  /**
   * We force the type here, because the Migrate Contract
   * won't be enabled if we're not on the networks below.
   * See `src/lib/contracts/contract-descriptors.js`.
   */
  const network = /** @type {"mainnet" | "testnet"} */ (
    migrationNetwork.toLowerCase()
  );

  const { ["ERC-20"]: erc20, ["BEP-20"]: bep20 } = tokens[network];

  /** The chains DUSK is migrated from, by the token each holds. */
  const CHAINS = [
    { id: "ethereum", name: "Ethereum", token: erc20.name },
    { id: "bsc", name: "BNB Smart Chain", token: bep20.name },
  ];

  // The minimum allowed amount to be migrated expressed as a string
  const minAmount = "0.000000001";

  const ercDecimals = 18;

  /**
   * An amount of the token in LUX, the unit amounts are shown from.
   *
   * @param {bigint | undefined} amount
   */
  const tokenLux = (amount) => (amount ?? 0n) / 10n ** BigInt(ercDecimals - 9);

  /** @type {TokenNames} */
  let selectedChain = erc20.name;

  /** @type {undefined | bigint} */
  let connectedWalletBalance;

  /** @type {string} */
  let amount = "";

  /** @type {boolean} */
  let isMigrationInitialized = false;

  /** @type {number} */
  let migrationStep = 0;

  /** @type {boolean} */
  let isInputDisabled = false;

  const steps = [{ label: "Approve" }, { label: "Migrate" }, { label: "Done" }];

  $: ({ currentProfile } = $walletStore);
  $: moonlightAccount = currentProfile?.account.toString();

  $: isAmountValid = (() => {
    if (!amount) {
      return false;
    }
    try {
      const parsedAmount = parseUnits(amount.replace(",", "."), ercDecimals);
      const minParsed = parseUnits(minAmount, ercDecimals);
      return (
        parsedAmount >= minParsed &&
        parsedAmount <= (connectedWalletBalance ?? 0n)
      );
    } catch {
      return false;
    }
  })();

  $: amount = slashDecimals(cleanNumberString(amount, getDecimalSeparator()));

  /**
   *  Triggers the switchChain event and reverts the ExclusiveChoice UI selected option if an error is thrown
   *
   * @param {number} id - the chain id of the desired smart contract
   */
  async function handleSwitchChain(id) {
    try {
      if (isConnected) {
        await switchChain(wagmiConfig, { chainId: id });
        connectedWalletBalance = await getBalance();
      }
    } catch {
      selectedChain =
        $account.chainId === erc20.chainId ? erc20.name : bep20.name;
    }
  }

  /**
   * Picks the chain to migrate from, and has the connected wallet switch
   * to it.
   *
   * @param {string} id "ethereum" or "bsc"
   */
  async function pickChain(id) {
    selectedChain = id === "bsc" ? bep20.name : erc20.name;

    if (!isConnected) {
      return;
    }

    amount = "";
    connectedWalletBalance = undefined;
    await handleSwitchChain(
      selectedChain === bep20.name ? bep20.chainId : erc20.chainId
    );
  }

  /**
   * Checks if the chainId of the selected option of ExclusiveChoice UI is different than the chainId of the smart contract in the third-party wallet
   * and triggers an event to set the chainId if there is a difference
   */
  async function switchToSelectedChain() {
    const currentChainId =
      selectedChain === erc20.name ? erc20.chainId : bep20.chainId;
    await handleSwitchChain(currentChainId);
  }

  async function getBalance() {
    try {
      if (!address) {
        throw new Error("Wallet not connected.");
      }
      return await getBalanceOfCoin(
        address,
        tokens[network][selectedChain].tokenContract
      );
    } catch {
      return 0n;
    }
  }

  onMount(() => {
    modal.subscribeEvents(handleModalEvents);

    // Workaround for when the user navigates back to the page
    // Just in case if beforeunload doesn't get triggered
    if ($account.isConnecting) {
      walletDisconnect();
    }
  });

  /** The account the balance shown is read for. */
  let balanceOf = "";

  /**
   * Reads the balance of an account that is connected, or came back, while
   * the page shows, once an account; forgets it once none is.
   *
   * @param {boolean} connected
   * @param {string | undefined} connectedAddress
   */
  function followAccount(connected, connectedAddress) {
    if (connected && connectedAddress && connectedAddress !== balanceOf) {
      balanceOf = connectedAddress;
      switchToSelectedChain();
    } else if (!connected && balanceOf) {
      balanceOf = "";
      connectedWalletBalance = undefined;
    }
  }

  $: followAccount(isConnected, address);

  /**
   * Handles modal state changes.
   * @param {import('@reown/appkit').EventsControllerState} newEvent
   */
  const handleModalEvents = async (newEvent) => {
    // Check if the newState contains an event that matches "CONNECT_SUCCESS"
    if (newEvent.data.event === "CONNECT_SUCCESS") {
      await switchToSelectedChain();
    }
  };

  $: chain = CHAINS.find((c) => c.token === selectedChain) ?? CHAINS[0];

  // How long a migration from this chain takes on this network, or none.
  $: time = routeTime(migrationRoute(chain.id), { network });
  $: routeLine = [
    routeTimeText(time),
    `approve, then migrate, in your ${chain.name} wallet`,
  ]
    .filter(Boolean)
    .join(" · ")
    .replace(/^./, (first) => first.toUpperCase());
  $: primary = !isConnected
    ? { label: `Connect to ${chain.name}`, ready: true }
    : connectedWalletBalance === undefined
      ? { label: "Checking the balance…", ready: false }
      : connectedWalletBalance === 0n
        ? { label: `No DUSK on ${chain.name}`, ready: false }
        : !amount
          ? { label: "Enter an amount", ready: false }
          : !isAmountValid
            ? { label: "Check the amount", ready: false }
            : { label: "Start the migration", ready: true };
  $: canType =
    isConnected && Boolean(connectedWalletBalance) && !isInputDisabled;

  function primaryAction() {
    if (!isConnected) {
      modal.open();
    } else if (primary.ready) {
      isMigrationInitialized = true;
      isInputDisabled = true;
    }
  }
</script>

<SwapCard label="Migrate">
  <div class="swap-top" slot="top">
    <h1 class="migrate__title" use:pageTitle>Migrate</h1>
  </div>

  <div class="swap-panel">
    <div class="swap-panel__head">
      <span class="swap-panel__label">From</span>
      <NetworkPicker
        choices={CHAINS}
        disabled={isInputDisabled}
        on:pick={({ detail }) => pickChain(detail)}
        side="From"
        title="Where it comes from"
        value={chain.id}
      />
    </div>
    <div class="swap-amount">
      <label class="sr-only" for="migrate-amount">Amount</label>
      <input
        aria-describedby="migrate-balance-label migrate-balance"
        aria-invalid={amount !== "" && !isAmountValid}
        autocomplete="off"
        bind:value={amount}
        disabled={!canType}
        id="migrate-amount"
        inputmode="decimal"
        placeholder="0"
        spellcheck="false"
        type="text"
      />
      <span class="swap-token"><NetworkMark id={chain.id} />DUSK</span>
    </div>
    <div class="swap-foot">
      <span id="migrate-balance-label">Balance on {chain.name}:</span>
      <span class="swap-foot__value">
        <span id="migrate-balance">
          {#if !isConnected}
            connect a wallet to see it
          {:else if connectedWalletBalance === undefined}
            checking
          {:else}
            <BalanceValue
              exact={formatDuskExact(
                tokenLux(connectedWalletBalance),
                language
              )}
              value={formatDusk(tokenLux(connectedWalletBalance), language)}
            /> DUSK
          {/if}
        </span>
        <button
          class="swap-mini"
          disabled={!canType}
          on:click={() => {
            amount = formatUnits(connectedWalletBalance ?? 0n, ercDecimals);
          }}
          type="button">Max</button
        >
      </span>
    </div>
    {#if isConnected && address}
      <p class="swap-recipient">
        from <b title={address}>{shortenAddress(address)}</b> ·
        <button
          aria-label={`${chain.name} wallet ${address}: disconnect or change wallet`}
          class="swap-link"
          on:click={() => modal.open()}
          type="button">Change</button
        >
      </p>
    {/if}
  </div>

  <div class="swap-flip">
    <span aria-hidden="true"><Icon path={mdiArrowDown} /></span>
  </div>

  <div class="swap-panel">
    <div class="swap-panel__head">
      <span class="swap-panel__label">To</span>
      <span class="migrate__network"><NetworkMark id="duskDs" />Dusk</span>
    </div>
    <div class="swap-amount">
      <output class:swap-amount__empty={!isAmountValid} for="migrate-amount"
        >{isAmountValid ? amount : "0"}</output
      >
      <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
    </div>
    <div class="swap-foot"><span>You receive</span></div>
    <p class="swap-recipient">to your public balance on Dusk</p>
  </div>

  <details class="swap-route">
    <summary
      ><Icon path={mdiClockOutline} /><span>{routeLine}</span><Icon
        className="swap-route__chevron"
        path={mdiChevronDown}
      /></summary
    >
    <dl>
      <div>
        <dt>Network fees</dt>
        <dd>On {chain.name}, as your wallet shows</dd>
      </div>
    </dl>
    <p class="swap-route__note">
      <b>Public on {chain.name} and Dusk, and linked:</b> your {chain.name} address,
      your public account and the amount.
    </p>
  </details>

  {#if isMigrationInitialized && isConnected && isAmountValid}
    <div class="migrate__steps">
      <Stepper {steps} activeStep={migrationStep} />
      {#if migrationStep === 0}
        <ApproveMigration
          on:incrementStep={() => migrationStep++}
          on:initApproval={() => {
            isInputDisabled = true;
          }}
          on:errorApproval={() => {
            isInputDisabled = false;
          }}
          amount={parseUnits(amount.replace(",", "."), ercDecimals)}
          chainContract={tokens[network][selectedChain].tokenContract}
          migrationContract={tokens[network][selectedChain].migrationContract}
        />
      {:else if migrationStep === 1}
        <ExecuteMigration
          on:incrementStep={() => migrationStep++}
          amount={parseUnits(amount.replace(",", "."), ercDecimals)}
          currentAddress={moonlightAccount ?? ""}
          migrationContract={tokens[network][selectedChain].migrationContract}
        />
      {:else}
        <div class="migrate__done">
          <Icon path={mdiCheckDecagramOutline} size="large" />
          <p>Migration sent.</p>
          {#if time}
            <Banner
              title={`Arrives on Dusk in ${routeTimeText(time)}.`}
              variant="info"
            />
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="swap-cta">
      <Button
        disabled={!primary.ready}
        on:click={primaryAction}
        text={primary.label}
        variant="primary"
      />
    </div>
  {/if}
</SwapCard>

<style lang="postcss">
  .migrate__title {
    margin: 0;
    padding: 0.5rem 0.5rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    line-height: 1.15;
  }

  .migrate__network {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.875rem 0 0.375rem;
    border-radius: 999px;
    background: var(--calm-s2);
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .migrate__steps {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.75rem 0.5rem 0.25rem;
  }

  .migrate__done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
  }
</style>
