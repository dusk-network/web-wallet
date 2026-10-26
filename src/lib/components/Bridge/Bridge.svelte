<svelte:options immutable={true} />

<script>
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { mdiArrowUpBoldBoxOutline, mdiListStatus } from "@mdi/js";
  import { DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT } from "@dusk/evm-sdk";
  import { formatUnits, parseUnits } from "viem";
  import {
    estimateGas,
    getGasPrice,
    sendTransaction,
    switchChain,
  } from "@wagmi/core";
  import { Gas } from "@dusk/w3sper";

  import {
    AnchorButton,
    Badge,
    Button,
    Select,
    Textbox,
    Throbber,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import {
    AppAnchorButton,
    BalanceValue,
    Banner,
    DepositResult,
    DuskIcon,
    GasSettings,
    OperationResult,
    ReviewAmount,
  } from "$lib/components";
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
  import { withdrawalSentMessage } from "$lib/bridge/withdrawalLifecycle";
  import { loadWithdrawalWaitingPeriod } from "$lib/bridge/withdrawals";
  import { luxToDusk } from "$lib/dusk/currency";
  import { getDecimalSeparator, slashDecimals } from "$lib/dusk/number";
  import { cleanNumberString, shortenAddress } from "$lib/dusk/string";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import { walletStore } from "$lib/stores";

  /**
   * DuskEVM uses duskEvm.nativeCurrency.decimals (currently 18). DuskDS uses 9 decimals (Lux).
   * This converts from EVM base units (1e18) to Lux units (1e9) so we can reuse luxToDusk().
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

  /** @type {(amount: bigint|number) => string} */
  export let formatter;

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

  /** @type {bigint | null} */
  let withdrawalWaitingPeriod = null;

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

  /** Gets the fee and the waiting period a withdrawal's review shows. */
  function prepareWithdrawalReview() {
    const value = amountWei;

    withdrawalFeeWei = null;
    estimateWithdrawalFee(value)
      .then((feeWei) => {
        if (value === amountWei) {
          withdrawalFeeWei = feeWei;
        }
      })
      .catch(() => {});
    void loadWithdrawalWaitingPeriod().then((seconds) => {
      withdrawalWaitingPeriod = seconds;
    });
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

  /**
   * Options used for selecting which network to bridge between in the UI.
   *
   * @type {Array<SelectOption>}
   */
  const baseOptions = [
    { label: "DuskDS", value: "duskDs" },
    { label: "DuskEVM", value: "duskEvm" },
  ];

  // Default origin
  let originNetwork = baseOptions[0].value;

  $: destinationNetworkOptions = baseOptions.map((option) => ({
    ...option,
    disabled: option.value === originNetwork,
  }));
  $: destinationNetwork =
    destinationNetworkOptions.find((o) => !o.disabled)?.value ?? "";
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
  $: ({ address: evmAddress } = $account);

  // What the maximum is asked for: new whenever the amount, the direction
  // or a wallet changes, so that an answer for an older one is dropped.
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

  onMount(() => {
    lastWithdrawalTxHash =
      localStorage.getItem(LAST_WITHDRAWAL_TX_HASH_KEY) ?? "";

    const unsubscribeAccount = account.subscribe((value) => {
      resumeDepositTracking(value.address);
      resumeWithdrawalTracking(value.address);
    });

    return unsubscribeAccount;
  });
</script>

<article class="bridge">
  <header class="bridge__header">
    <h3 class="h4">Bridge</h3>
    <AppAnchorButton
      href={withdrawalStatusHref()}
      text="Activity"
      variant="tertiary"
      icon={{ path: mdiListStatus }}
    />
  </header>

  <aside class="bridge__balances">
    <dl class="balances">
      <dt class="balances__token">DuskDS</dt>
      <dd class="balances__balance">
        <BalanceValue value={formatter(luxToDusk(unshieldedBalance))} />
      </dd>
      <dt class="balances__token">DuskEVM</dt>
      <dd class="balances__balance">
        {#if evmDuskBalance}
          <BalanceValue
            value={formatter(
              luxToDusk(evmDuskBalance.value / EVM_TO_LUX_SCALE_FACTOR)
            )}
          />
        {:else}
          <Throbber size={16} />
        {/if}
        {#if incomingDepositLux > 0n}
          <small>
            + <BalanceValue value={formatter(luxToDusk(incomingDepositLux))} /> incoming
          </small>
        {/if}
      </dd>
      {#if address}
        <dt class="balances__token">DuskEVM account</dt>
        <dd class="balances__balance">
          <!-- Opens the connection's account view, to disconnect it. -->
          <button
            aria-label={`DuskEVM account ${address}: disconnect or change wallet`}
            class="balances__account"
            data-tooltip-id="main-tooltip"
            data-tooltip-text="Disconnect or change wallet"
            on:click={() => modal.open()}
            title={address}
            type="button">{shortenAddress(address)}</button
          >
        </dd>
      {/if}
    </dl>
  </aside>

  <div class="operation">
    <Wizard steps={3} let:key>
      <WizardStep
        step={0}
        {key}
        backButton={{
          disabled: false,
          href: "/dashboard",
          isAnchor: true,
        }}
        nextButton={{
          action: () => {
            isEditing = false;

            if (isWithdrawing) {
              prepareWithdrawalReview();
            }
          },
          disabled: isNextButtonDisabled,
        }}
      >
        <div in:fade|global class="operation__bridge">
          <fieldset class="operation__fieldset">
            <p class="operation__label">From</p>

            <div class="operation__input-wrapper">
              <Select
                bind:value={originNetwork}
                name="origin-network"
                options={baseOptions}
              />
            </div>

            <div class="operation__swap">
              <button
                aria-label="Swap the direction"
                class="operation__swap-button"
                data-tooltip-id="main-tooltip"
                data-tooltip-text="Swap the direction"
                on:click={() => {
                  originNetwork = destinationNetwork;
                }}
                type="button">↑↓</button
              >
            </div>

            <p class="operation__label">To</p>

            <div class="operation__input-wrapper">
              <Select
                bind:value={destinationNetwork}
                name="destination-network"
                options={destinationNetworkOptions}
              />
            </div>

            <div class="operation__amount-wrapper">
              <label class="operation__label" for="destination-amount"
                >Amount</label
              >
              <Button
                disabled={isWithdrawing && !evmDuskBalance}
                on:click={setMaxAmount}
                size="small"
                text="USE MAX"
                variant="tertiary"
              />
            </div>

            <div class="operation__input-wrapper">
              <Textbox
                aria-describedby="destination-amount-available"
                className="operation__input-field"
                required
                type="text"
                id="destination-amount"
                name="destination-amount"
                bind:value={amount}
              />
              <DuskIcon />
            </div>

            <p class="operation__available" id="destination-amount-available">
              Available on {isWithdrawing ? "DuskEVM" : "DuskDS"}:
              {#if !isWithdrawing}
                <BalanceValue value={formatter(luxToDusk(unshieldedBalance))} />
                DUSK
              {:else if evmDuskBalance}
                <BalanceValue
                  value={formatter(
                    luxToDusk(evmDuskBalance.value / EVM_TO_LUX_SCALE_FACTOR)
                  )}
                /> DUSK
              {:else}
                checking
              {/if}
            </p>

            {#if amount !== ""}
              {#if isDepositing && !hasEnoughUnshielded}
                <Banner title="Insufficient balance" variant="warning">
                  <p>
                    Your <b>public</b> balance must cover the amount
                    <i>plus</i> the fee.
                  </p>
                </Banner>
              {:else if isWithdrawing && !evmDuskBalance}
                <Banner title="Checking balance" variant="info">
                  <p>Fetching your <b>DuskEVM</b> balance…</p>
                </Banner>
              {:else if isWithdrawing && evmDuskBalance && !hasEnoughEvm}
                <Banner title="Insufficient balance" variant="warning">
                  <p>
                    Your <b>DuskEVM</b> balance must cover the amount
                    <i>plus</i> gas.
                  </p>
                </Banner>
              {/if}
            {/if}
          </fieldset>
          {#if isDepositing}
            <GasSettings
              {formatter}
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
          {/if}
        </div>
      </WizardStep>
      <WizardStep
        step={1}
        {key}
        backButton={{
          action: () => {
            isEditing = true;
          },
        }}
        nextButton={{
          disabled: isNextButtonDisabled,
          icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
          label: "SEND",
          variant: "primary",
        }}
      >
        <div in:fade|global class="operation__bridge">
          <Badge
            className="operation__review-notice"
            text="REVIEW TRANSACTION"
            variant="warning"
          />
          <ReviewAmount
            label="Amount"
            value={formatter(luxToDusk(amountLux))}
          />
          <dl class="operation__review-transaction">
            <dt class="review-transaction__label">
              <span>From</span>
            </dt>
            <dd class="operation__review-address">
              <span>
                {isDepositing ? unshieldedAddress : address}
              </span>
            </dd>
          </dl>
          <dl class="operation__review-transaction">
            <dt class="review-transaction__label">
              <span>To</span>
            </dt>
            <dd class="operation__review-address">
              <span>
                {isDepositing ? address : unshieldedAddress}
              </span>
            </dd>
          </dl>
          {#if isDepositing}
            <ReviewAmount
              label="Network fee (at most)"
              value={formatter(luxToDusk(fee))}
            />
            <ReviewAmount
              label="Total (at most)"
              value={formatter(luxToDusk(totalDepositLux))}
            />
            <Banner
              title="The fee is paid from your public balance."
              variant="info"
            />
          {:else}
            {#if withdrawalFeeWei !== null}
              <ReviewAmount
                label="Network fee (about)"
                value={formatter(
                  luxToDusk(withdrawalFeeWei / EVM_TO_LUX_SCALE_FACTOR)
                )}
              />
            {/if}
            <Banner
              title={withdrawalSentMessage(withdrawalWaitingPeriod)}
              variant="info"
            >
              <p>
                This fee is paid from your DuskEVM balance. Each step on Dusk
                takes a small fee from your public balance.
              </p>
            </Banner>
          {/if}
        </div>
      </WizardStep>
      <WizardStep step={2} {key} showNavigation={false}>
        {#if isDepositing}
          <DepositResult operation={bridge()} />
        {:else}
          <OperationResult
            errorMessage="Bridging failed"
            operation={bridge()}
            pendingMessage="Processing transaction"
            successMessage="Withdrawal sent"
          >
            <svelte:fragment slot="success-content" let:result={hash}>
              <p>{withdrawalSentMessage(withdrawalWaitingPeriod)}</p>
              {#if hash}
                <AnchorButton
                  href={`${duskEvm.blockExplorers.default.url}/tx/${hash}`}
                  text="VIEW ON BLOCK EXPLORER"
                  rel="noopener noreferrer"
                  target="_blank"
                />
                <AppAnchorButton
                  href={withdrawalStatusHref(hash)}
                  text="TRACK WITHDRAWAL"
                  variant="tertiary"
                />
              {/if}
            </svelte:fragment>
          </OperationResult>
        {/if}
      </WizardStep>
    </Wizard>
  </div>
</article>

<style lang="postcss">
  .bridge {
    border-radius: 1.25em;
    background: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    padding: 1.25em;

    &__header {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: space-between;
    }

    &__balances {
      display: flex;
      padding: 1em 1.25em;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: var(--medium-gap);
      align-self: stretch;

      border-radius: var(--fieldset-border-radius);
      background: var(--fieldset-background-color);
    }
  }

  .balances {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    align-items: baseline;
    margin: 0;
    width: 100%;

    &__token {
      font-weight: 500;
    }

    &__balance {
      align-items: flex-end;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0;
      overflow-wrap: anywhere;
      text-align: right;

      & small {
        color: var(--secondary-text-color);
        font-size: 0.75rem;
      }
    }
  }

  .operation {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;

    &__fieldset {
      display: flex;
      padding: 1em 1.25em;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: var(--medium-gap);
      align-self: stretch;

      border-radius: var(--fieldset-border-radius);
      background: var(--fieldset-background-color);
    }

    &__input-wrapper {
      column-gap: var(--default-gap);
      display: flex;
      align-items: center;
      width: 100%;
    }

    &__review-address {
      background-color: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);
      font-family: var(--mono-font-family);
      font-size: 0.875rem;
      padding: 0.75em 1em;
      width: 100%;
      line-break: anywhere;
    }

    &__review-transaction {
      display: flex;
      flex-direction: column;
      gap: 0.625em;
    }

    &__bridge {
      display: flex;
      flex-direction: column;
      gap: 1.2em;
    }

    .review-transaction__label {
      display: inline-flex;
      align-items: center;
      gap: var(--small-gap);
    }

    :global(&__review-notice) {
      text-align: center;
    }

    & > :global(.operation__operation-button) {
      width: 100%;
      text-align: left;
    }
  }

  .operation__swap {
    display: flex;
    justify-content: center;
    width: 100%;
    border-top: 1px solid var(--divider-color-primary);
    margin: var(--default-gap) 0;
    height: 1px;
  }

  .operation__swap-button {
    position: relative;
    top: -1.4em;
    min-height: 44px;
    padding: 0 1.25em;
    border: 1px solid var(--control-secondary-border-color);
    border-radius: 2em;
    background-color: var(--divider-background-color);
    color: var(--on-surface-color);
    font: inherit;
    cursor: pointer;
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--control-secondary-border-color-hover);
    }

    &:focus-visible {
      outline: 2px solid var(--secondary-color);
      outline-offset: 2px;
    }
  }

  .operation__amount-wrapper {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .operation__available {
    color: var(--muted-color);
    font-size: 0.875em;
  }

  .balances__account {
    all: unset;
    position: relative;
    cursor: pointer;
    font-family: var(--mono-font-family);
    font-size: 0.875em;
    text-decoration: underline;
    text-underline-offset: 0.2em;

    &:focus-visible {
      outline: 2px solid var(--secondary-color);
      outline-offset: 2px;
    }
  }

  /* A larger tap area on phones, as for the other small controls. */
  @media (max-width: 30rem) {
    .balances__account::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: max(100%, 44px);
      height: max(100%, 44px);
      transform: translate(-50%, -50%);
    }
  }
</style>
