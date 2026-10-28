<svelte:options immutable={true} />

<script>
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import {
    mdiArrowDown,
    mdiArrowLeft,
    mdiArrowUpBoldBoxOutline,
    mdiChevronDown,
    mdiClockOutline,
  } from "@mdi/js";
  import { DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT } from "@dusk/evm-sdk";
  import { formatUnits, parseUnits } from "viem";
  import {
    estimateGas,
    getGasPrice,
    sendTransaction,
    switchChain,
  } from "@wagmi/core";
  import { Gas } from "@dusk/w3sper";

  import { AnchorButton, Button, Icon } from "$lib/dusk/components";
  import {
    AppAnchorButton,
    BalanceValue,
    Banner,
    DepositResult,
    GasSettings,
    OperationResult,
    ReviewAmount,
  } from "$lib/components";
  import NetworkMark from "$lib/components/NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "$lib/components/NetworkPicker/NetworkPicker.svelte";
  import SwapCard from "$lib/components/SwapCard/SwapCard.svelte";
  import {
    account,
    duskEvm,
    modal,
    wagmiConfig,
  } from "$lib/web3/walletConnection";
  import { BRIDGE_DEPOSIT_MIN_GAS_LIMIT } from "$lib/bridge/deposit";
  import {
    depositActivityStore,
    pendingDepositAmountLux,
    rememberDepositTransaction,
    resumeDepositTracking,
    trackDepositTransaction,
  } from "$lib/bridge/depositActivity";
  import {
    rememberWithdrawalTransaction,
    resumeWithdrawalTracking,
    trackWithdrawalTransaction,
  } from "$lib/bridge/withdrawalActivity";
  import { prepareNativeDuskWithdrawalCall } from "$lib/bridge/withdrawalInitiation";
  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import { beforeProofText } from "$lib/bridge/claimDate";
  import {
    DEPOSIT,
    WITHDRAWAL,
    routeTime,
    routeTimeText,
  } from "$lib/bridge/routeTimes";
  import {
    formatDusk,
    formatDuskExact,
    formatFee,
    formatTotal,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator, slashDecimals } from "$lib/dusk/number";
  import { cleanNumberString, shortenAddress } from "$lib/dusk/string";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import { addBasePath } from "$lib/navigation";
  import { settingsStore, walletStore } from "$lib/stores";

  /**
   * DuskEVM uses duskEvm.nativeCurrency.decimals (currently 18). DuskDS uses 9 decimals (Lux).
   * This converts from EVM base units (1e18) to Lux units (1e9), which amounts are shown from.
   * @type {bigint}
   */
  const EVM_TO_LUX_SCALE_FACTOR =
    10n ** BigInt(duskEvm.nativeCurrency.decimals - 9);
  const LAST_WITHDRAWAL_TX_HASH_KEY = "dusk-evm:last-withdrawal-tx-hash";

  /**
   * What Max leaves on DuskEVM for the withdrawal's fee while it can't be
   * estimated: 0.01 DUSK, several times a usual one.
   */
  const WITHDRAWAL_FEE_RESERVE_WEI = 10n ** 16n;
  const WITHDRAWAL_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {string} */
  export let unshieldedAddress;

  /** @type {unknown} */
  export let unshieldedAccount;

  /** @type {bigint} */
  export let unshieldedBalance;

  /** @type {import('@wagmi/core').GetBalanceReturnType | undefined} */
  export let evmDuskBalance;

  /** @type {string} */
  let destinationNetwork = "";

  /** @type {string} */
  let amount = "";

  /** @type {string} */
  let lastWithdrawalTxHash = "";

  /** @type {bigint} */
  let amountLux = 0n;

  /** @type {bigint} */
  let amountWei = 0n;

  /** @type {bigint} */
  let incomingDepositLux = 0n;

  /** @type {boolean} */
  let isGasValid = true;

  /** @type {ContractGasSettings} */
  let { gasLimit, gasPrice } = gasSettings;

  /** Whether the first step, where the gas can be edited, shows. */
  let isEditing = true;

  let defaultGas = gasSettings;

  /**
   * The DuskEVM fee of the withdrawal, estimated for its review, in wei.
   *
   * @type {bigint | null}
   */
  let withdrawalFeeWei = null;

  /** How many times the maximum was asked for: only the last one applies. */
  let maxRequests = 0;

  /** How many times a review's fee was asked for: only the last one applies. */
  let reviewRequests = 0;

  /**
   * The DuskEVM gas price. `getGasPrice` throws rather than rejects for a
   * chain it doesn't know, which would leave the gas estimate unhandled.
   */
  const loadEvmGasPrice = async () =>
    getGasPrice(wagmiConfig, { chainId: duskEvm.id });

  /**
   * Estimates the DuskEVM fee of a withdrawal of the given amount: the gas it
   * needs at the current gas price. The EVM wallet sets the fee it pays.
   *
   * @param {bigint} value The amount, in wei.
   * @returns {Promise<bigint>}
   */
  async function estimateWithdrawalFee(value) {
    const call = prepareNativeDuskWithdrawalCall({
      accountPublicKey: unshieldedAccount,
      amountWei: value,
      evmRecipient: /** @type {string} */ ($account.address),
      minGasLimit: DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT,
    });
    const [gas, price] = await Promise.all([
      estimateGas(wagmiConfig, {
        account: $account.address,
        chainId: duskEvm.id,
        data: call.data,
        to: call.to,
        value: call.value,
      }),
      loadEvmGasPrice(),
    ]);

    return gas * price;
  }

  /** Gets the fee a withdrawal's review shows. */
  function prepareWithdrawalReview() {
    reviewRequests += 1;

    const request = reviewRequests;
    const scope = maxScope;

    withdrawalFeeWei = null;
    estimateWithdrawalFee(amountWei)
      .then((feeWei) => {
        // Only for the review asked for last, of the amount, the direction
        // and the wallets it was asked for.
        if (request === reviewRequests && scope === maxScope) {
          withdrawalFeeWei = feeWei;
        }
      })
      .catch(() => {});
  }

  /**
   * The amount to bridge, as the amount field shows it.
   *
   * @param {bigint} lux
   */
  const toAmountText = (lux) =>
    formatUnits(lux > 0n ? lux : 0n, 9).replace(".", getDecimalSeparator());

  /**
   * Bridges all it can: on DuskDS what the public balance holds past the
   * fee, on DuskEVM what is left after the withdrawal's estimated fee, with
   * room for it to change.
   */
  async function setMaxAmount() {
    if (isDepositing) {
      amount = toAmountText(unshieldedBalance - fee);
      return;
    }

    if (!evmDuskBalance) {
      return;
    }

    maxRequests += 1;

    const request = maxRequests;
    const scope = maxScope;
    const feeWei = await estimateWithdrawalFee(1n).catch(() => null);

    // The amount, the direction or a wallet changed while the fee was
    // estimated, or the maximum was asked for again: this one is dropped.
    if (request !== maxRequests || scope !== maxScope || !evmDuskBalance) {
      return;
    }

    const reserveWei = feeWei ? feeWei * 2n : WITHDRAWAL_FEE_RESERVE_WEI;

    amount = toAmountText(
      (evmDuskBalance.value - reserveWei) / EVM_TO_LUX_SCALE_FACTOR
    );
  }

  /**
   * A DuskEVM balance in LUX.
   *
   * @param {{ value: bigint }} balance
   */
  const evmLux = (balance) => balance.value / EVM_TO_LUX_SCALE_FACTOR;

  async function submitNativeWithdrawal() {
    if (!unshieldedAccount) {
      throw new Error("Dusk account is not available.");
    }

    if (!$account.address) {
      throw new Error("DuskEVM account is not available.");
    }

    const withdrawal = prepareNativeDuskWithdrawalCall({
      accountPublicKey: unshieldedAccount,
      amountWei,
      evmRecipient: $account.address,
      minGasLimit: DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT,
    });

    await switchChain(wagmiConfig, { chainId: duskEvm.id });

    const hash = await sendTransaction(wagmiConfig, {
      chainId: duskEvm.id,
      data: withdrawal.data,
      to: withdrawal.to,
      value: withdrawal.value,
    });

    rememberWithdrawalTxHash(hash);
    return hash;
  }

  async function submitNativeDeposit() {
    if (!$account.address) {
      throw new Error("Account address is not available.");
    }

    const response = await walletStore.depositEvmFunctionCall(
      $account.address,
      amountLux,
      new Gas({ limit: gasLimit, price: gasPrice }),
      { minGasLimit: BRIDGE_DEPOSIT_MIN_GAS_LIMIT }
    );
    const { hash } = response;

    if (typeof hash !== "string") {
      throw new Error("The DuskDS transaction did not return a hash.");
    }

    const remembered = rememberDepositTransaction(hash, {
      account: $account.address,
      amountLux,
      amountWei,
    });

    if (!remembered) {
      throw new Error("The DuskDS transaction returned an invalid hash.");
    }

    void trackDepositTransaction(remembered.transactionHash);
    return remembered.transactionHash;
  }

  /**
   * Determines the direction of the transaction as either a withdrawal or deposit,
   * makes the appropriate contract call and returns the transaction hash.
   *
   * @return {Promise<string>} hash
   */
  async function bridge() {
    if (originNetwork === "duskEvm" && destinationNetwork === "duskDs") {
      return await submitNativeWithdrawal();
    }

    if (originNetwork === "duskDs" && destinationNetwork === "duskEvm") {
      return await submitNativeDeposit();
    }

    throw new Error("Invalid bridge operation.");
  }

  /**
   * @param {string | undefined} hash
   */
  function withdrawalStatusHref(hash = lastWithdrawalTxHash) {
    return WITHDRAWAL_TX_HASH_PATTERN.test(hash)
      ? `/dashboard/bridge/transactions?tx=${hash}`
      : "/dashboard/bridge/transactions";
  }

  /**
   * @param {string | undefined} hash
   */
  function rememberWithdrawalTxHash(hash) {
    if (!browser || !WITHDRAWAL_TX_HASH_PATTERN.test(hash ?? "")) {
      return hash;
    }

    lastWithdrawalTxHash = /** @type {string} */ (hash);
    localStorage.setItem(LAST_WITHDRAWAL_TX_HASH_KEY, lastWithdrawalTxHash);
    const remembered = rememberWithdrawalTransaction(
      /** @type {`0x${string}`} */ (lastWithdrawalTxHash),
      { account: $account.address, amountWei }
    );

    if (remembered) {
      void trackWithdrawalTransaction(remembered.transactionHash);
    }

    return hash;
  }

  /** The networks the bridge moves DUSK between. */
  const NETWORKS = [
    { id: "duskDs", name: "Dusk" },
    { id: "duskEvm", name: "DuskEVM" },
  ];

  /** @param {string} id */
  const otherThan = (id) => (id === "duskDs" ? "duskEvm" : "duskDs");

  /**
   * A route in one line, its time on this network first where it's known:
   * the route row and the To list say the same.
   *
   * @param {RouteTime | null} time
   * @param {string[]} rest
   */
  const routeLineOf = (time, rest) => {
    const line = [routeTimeText(time), ...rest].filter(Boolean).join(" · ");

    return `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
  };

  // Default origin
  let originNetwork = "duskDs";

  /** Where the card is: the form, the review, or what came of it. */
  /** @type {"form" | "result" | "review"} */
  let step = "form";

  /** What Send started: shown once the card moves on to it. */
  /** @type {Promise<string>} */
  let operation = Promise.resolve("");

  function review() {
    isEditing = false;

    if (isWithdrawing) {
      prepareWithdrawalReview();
    }

    step = "review";
  }

  function edit() {
    isEditing = true;
    step = "form";
  }

  function send() {
    operation = bridge();
    step = "result";
  }

  function primaryAction() {
    if (!isConnected) {
      modal.open();
    } else if (primary.ready) {
      review();
    }
  }

  $: destinationNetwork = otherThan(originNetwork);
  $: amount = slashDecimals(cleanNumberString(amount, getDecimalSeparator()));
  $: fee = gasLimit * gasPrice;

  // The default gas can change while the form is open, as when the node's
  // price arrives: the form takes it while its gas can be edited, unless it
  // was edited here, and keeps the gas a review shows.
  $: if (isEditing && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
  }

  $: isDepositing =
    originNetwork === "duskDs" && destinationNetwork === "duskEvm";
  $: isWithdrawing =
    originNetwork === "duskEvm" && destinationNetwork === "duskDs";
  $: ({ address: evmAddress, isConnected } = $account);

  // What the maximum and a review's fee are asked for: new whenever the
  // amount, the direction or a wallet changes, so that an answer for an
  // older one is dropped.
  $: maxScope = { amount, evmAddress, isWithdrawing, unshieldedAccount };
  $: incomingDepositLux = pendingDepositAmountLux(
    $account.address,
    $depositActivityStore
  );
  $: {
    // viem expects a dot as decimal separator.
    // We also guard against incomplete inputs like "1." or ",5".
    const normalized = amount.replace(",", ".");
    const trimmed = normalized.endsWith(".")
      ? normalized.slice(0, -1)
      : normalized;
    const safe = trimmed.startsWith(".") ? `0${trimmed}` : trimmed;

    try {
      amountLux = safe ? parseUnits(safe, 9) : 0n;
    } catch {
      amountLux = 0n;
    }

    // Convert Lux (1e9) to EVM base units (1e18)
    amountWei = amountLux * EVM_TO_LUX_SCALE_FACTOR;
  }
  $: totalDepositLux = amountLux + fee;
  $: hasEnoughUnshielded =
    !isDepositing || unshieldedBalance >= totalDepositLux;
  $: hasEnoughEvm =
    !isWithdrawing ||
    (evmDuskBalance ? amountWei <= evmDuskBalance.value : false);
  $: isBalanceSufficient = isDepositing ? hasEnoughUnshielded : hasEnoughEvm;
  $: isNextButtonDisabled =
    amountLux === 0n || (isDepositing && !isGasValid) || !isBalanceSufficient;
  $: isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  $: ({ address } = $account);

  $: primary = !isConnected
    ? { label: "Connect a DuskEVM wallet", ready: true }
    : amountLux === 0n
      ? { label: "Enter an amount", ready: false }
      : !isBalanceSufficient
        ? {
            label:
              isWithdrawing && !evmDuskBalance
                ? "Checking the DuskEVM balance…"
                : "Not enough DUSK",
            ready: false,
          }
        : isDepositing && !isGasValid
          ? { label: "Check the network fee", ready: false }
          : { label: "Review bridge", ready: true };

  // A review needs its EVM wallet: without one, back to the form, which
  // offers to connect it.
  $: if (step === "review" && !isConnected) {
    edit();
  }

  // How long each way takes on this network: what its chains said, or none.
  $: depositTime = routeTime(DEPOSIT, $bridgeTimes);
  $: withdrawalTime = routeTime(WITHDRAWAL, $bridgeTimes);
  $: depositLine = routeLineOf(depositTime, [
    `fee up to ${formatFee(fee, language, { max: true })} DUSK`,
  ]);
  $: withdrawalLine = routeLineOf(withdrawalTime, ["two steps on Dusk"]);
  $: routeLine = isDepositing ? depositLine : withdrawalLine;
  $: toChoices = NETWORKS.map((network) => ({
    ...network,
    note: network.id === "duskDs" ? withdrawalLine : depositLine,
  }));

  // What's left once a withdrawal is sent: the proof, then the claim, with
  // the waits the chain said: "Claim 7 days after you prove. You can prove
  // about 30 minutes after sending."
  $: withdrawalNext =
    beforeProofText(withdrawalTime) || "Prove it on Dusk, then claim it.";

  onMount(() => {
    void bridgeTimes.load();
    lastWithdrawalTxHash =
      localStorage.getItem(LAST_WITHDRAWAL_TX_HASH_KEY) ?? "";

    const unsubscribeAccount = account.subscribe((value) => {
      resumeDepositTracking(value.address);
      resumeWithdrawalTracking(value.address);
    });

    return unsubscribeAccount;
  });

  $: ({ language } = $settingsStore);
</script>

<SwapCard label="Bridge">
  <div class="swap-top" slot="top">
    <nav aria-label="Bridge and activity" class="swap-tabs">
      <a
        aria-current="page"
        class="swap-tab"
        href={addBasePath("/dashboard/bridge")}>Bridge</a
      >
      <a class="swap-tab" href={addBasePath(withdrawalStatusHref())}>Activity</a
      >
    </nav>
  </div>

  {#if step === "form"}
    <div class="swap-panel">
      <div class="swap-panel__head">
        <span class="swap-panel__label">From</span>
        <NetworkPicker
          choices={NETWORKS}
          on:pick={({ detail }) => {
            originNetwork = detail;
          }}
          side="From"
          title="Where it comes from"
          value={originNetwork}
        />
      </div>
      <div class="swap-amount">
        <label class="sr-only" for="bridge-amount">Amount</label>
        <input
          aria-describedby="bridge-balance-label bridge-balance"
          aria-invalid={amount !== "" && !isBalanceSufficient}
          autocomplete="off"
          bind:value={amount}
          id="bridge-amount"
          inputmode="decimal"
          name="destination-amount"
          placeholder="0"
          spellcheck="false"
          type="text"
        />
        <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
      </div>
      <div class="swap-foot">
        <span id="bridge-balance-label"
          >{isWithdrawing ? "DuskEVM balance:" : "Public balance:"}</span
        >
        <span class="swap-foot__value">
          <span id="bridge-balance">
            {#if !isWithdrawing}
              <BalanceValue
                exact={formatDuskExact(unshieldedBalance, language)}
                value={formatDusk(unshieldedBalance, language)}
              /> DUSK
            {:else if evmDuskBalance}
              <BalanceValue
                exact={formatDuskExact(evmLux(evmDuskBalance), language)}
                value={formatDusk(evmLux(evmDuskBalance), language)}
              /> DUSK
            {:else}
              {isConnected ? "checking" : "connect a wallet to see it"}
            {/if}
          </span>
          <button
            class="swap-mini"
            disabled={isWithdrawing && !evmDuskBalance}
            on:click={setMaxAmount}
            type="button">Max</button
          >
        </span>
      </div>
      {#if isWithdrawing && evmAddress}
        <p class="swap-recipient">
          from your DuskEVM account <b title={evmAddress}
            >{shortenAddress(evmAddress)}</b
          >
          ·
          <button
            aria-label={`DuskEVM account ${evmAddress}: disconnect or change wallet`}
            class="swap-link"
            on:click={() => modal.open()}
            type="button">Change</button
          >
        </p>
      {/if}
      {#if amount !== "" && amountLux > 0n && isConnected && !isBalanceSufficient}
        <p class="swap-error" role="alert">
          {isDepositing
            ? "Your public balance must cover the amount and the fee."
            : evmDuskBalance
              ? "Your DuskEVM balance must cover the amount and its gas."
              : "Checking your DuskEVM balance…"}
        </p>
      {/if}
    </div>

    <div class="swap-flip">
      <button
        aria-label="Swap From and To"
        class="swap-flip__button"
        on:click={() => {
          originNetwork = destinationNetwork;
        }}
        type="button"><Icon path={mdiArrowDown} /></button
      >
    </div>

    <div class="swap-panel">
      <div class="swap-panel__head">
        <span class="swap-panel__label">To</span>
        <NetworkPicker
          choices={toChoices}
          on:pick={({ detail }) => {
            originNetwork = otherThan(detail);
          }}
          side="To"
          title="Where it goes"
          value={destinationNetwork}
        />
      </div>
      <div class="swap-amount">
        <output class:swap-amount__empty={amountLux === 0n} for="bridge-amount"
          >{amountLux === 0n
            ? "0"
            : formatDuskExact(amountLux, language)}</output
        >
        <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
      </div>
      <div class="swap-foot">
        <span>You receive</span>
        {#if isDepositing && incomingDepositLux > 0n}
          <span class="swap-foot__value"
            >+ <BalanceValue
              exact={formatDuskExact(incomingDepositLux, language)}
              value={formatDusk(incomingDepositLux, language)}
            /> DUSK on its way</span
          >
        {/if}
      </div>
      {#if isWithdrawing}
        <p class="swap-recipient">to your public balance on Dusk</p>
      {:else if evmAddress}
        <p class="swap-recipient">
          to your DuskEVM account <b title={evmAddress}
            >{shortenAddress(evmAddress)}</b
          >
          ·
          <button
            aria-label={`DuskEVM account ${evmAddress}: disconnect or change wallet`}
            class="swap-link"
            on:click={() => modal.open()}
            type="button">Change</button
          >
        </p>
      {/if}
    </div>

    <details class="swap-route">
      <summary
        ><Icon path={mdiClockOutline} /><span>{routeLine}</span><Icon
          className="swap-route__chevron"
          path={mdiChevronDown}
        /></summary
      >
      <dl>
        {#if isDepositing}
          <div>
            <dt>Steps</dt>
            <dd>One, in this wallet</dd>
          </div>
          <div>
            <dt>Leaves your public balance</dt>
            <dd>
              up to {formatFee(totalDepositLux, language, { max: true })} DUSK
            </dd>
          </div>
        {:else}
          <div>
            <dt>Steps</dt>
            <dd>Send on DuskEVM, then prove and claim on Dusk</dd>
          </div>
          <div>
            <dt>Network fees</dt>
            <dd>
              On DuskEVM, as your EVM wallet shows, and a small fee for each
              step on Dusk
            </dd>
          </div>
        {/if}
      </dl>
      {#if isDepositing}
        <div class="bridge__gas">
          <GasSettings
            {fee}
            limit={gasLimit}
            limitLower={gasLimits.gasLimitLower}
            limitUpper={gasLimits.gasLimitUpper}
            price={gasPrice}
            priceLower={gasLimits.gasPriceLower}
            on:gasSettings={(event) => {
              gasPrice = event.detail.price;
              gasLimit = event.detail.limit;
            }}
          />
        </div>
      {/if}
      <p class="swap-route__note">
        <b>Public on Dusk and DuskEVM, and linked:</b> your public account, the DuskEVM
        account and the amount.
      </p>
    </details>

    <div class="swap-cta">
      <Button
        disabled={!primary.ready}
        on:click={primaryAction}
        text={primary.label}
        variant="primary"
      />
    </div>
  {:else if step === "review"}
    <div class="bridge-review">
      <h2 class="bridge-review__title">Review</h2>
      <ReviewAmount
        label="Amount"
        value={formatDuskExact(amountLux, language)}
      />
      <dl class="bridge-review__ends">
        <div>
          <dt>From</dt>
          <dd>
            <span>{isDepositing ? "Your public account" : "DuskEVM"}</span>
            <span class="bridge-review__address"
              >{isDepositing ? unshieldedAddress : address}</span
            >
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>
            <span>{isDepositing ? "DuskEVM" : "Your public account"}</span>
            <span class="bridge-review__address"
              >{isDepositing ? address : unshieldedAddress}</span
            >
          </dd>
        </div>
      </dl>
      {#if isDepositing}
        <ReviewAmount
          label="Network fee (at most)"
          value={formatFee(fee, language, { max: true })}
        />
        <ReviewAmount
          label="Total (at most)"
          value={formatTotal(totalDepositLux, unshieldedBalance, language)}
        />
      {:else}
        {#if withdrawalFeeWei !== null}
          <ReviewAmount
            label="Network fee (about)"
            value={formatFee(
              withdrawalFeeWei / EVM_TO_LUX_SCALE_FACTOR,
              language
            )}
          />
        {/if}
        <Banner title={withdrawalNext} variant="info">
          <p>Each step on Dusk takes a small fee from your public balance.</p>
        </Banner>
      {/if}
      <div class="bridge-review__actions">
        <Button
          icon={{ path: mdiArrowLeft }}
          on:click={edit}
          text="Back"
          variant="secondary"
        />
        <Button
          disabled={isNextButtonDisabled || !isConnected}
          icon={{ path: mdiArrowUpBoldBoxOutline, position: "before" }}
          on:click={send}
          text="Send"
          variant="primary"
        />
      </div>
    </div>
  {:else if isDepositing}
    <div class="bridge-result">
      <DepositResult {operation} />
    </div>
  {:else}
    <div class="bridge-result">
      <OperationResult
        errorMessage="Bridging failed"
        {operation}
        pendingMessage="Processing transaction"
        successMessage="Withdrawal sent"
      >
        <svelte:fragment slot="success-content" let:result={hash}>
          <p>{withdrawalNext}</p>
          {#if hash}
            <AnchorButton
              href={`${duskEvm.blockExplorers.default.url}/tx/${hash}`}
              text="View in Dusk explorer"
              rel="noopener noreferrer"
              target="_blank"
            />
            <AppAnchorButton
              href={withdrawalStatusHref(hash)}
              text="Track withdrawal"
              variant="tertiary"
            />
          {/if}
        </svelte:fragment>
      </OperationResult>
    </div>
  {/if}
</SwapCard>

<style lang="postcss">
  .bridge__gas {
    margin: 0 0.5rem 0.5rem;
  }

  .bridge-review,
  .bridge-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
  }

  .bridge-review__title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .bridge-review__ends {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;

    & > div {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    & dt {
      color: var(--calm-muted);
      font-size: 0.8125rem;
    }

    & dd {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      margin: 0;
    }
  }

  .bridge-review__address {
    color: var(--calm-muted);
    font-family: var(--mono-font-family, monospace);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .bridge-review__actions {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
