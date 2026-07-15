<svelte:options immutable={true} />

<script>
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { mdiArrowUpBoldBoxOutline, mdiListStatus } from "@mdi/js";
  import { DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT } from "@dusk/evm-sdk";
  import { parseUnits } from "viem";
  import { sendTransaction, switchChain } from "@wagmi/core";
  import { getKey } from "lamb";
  import { Gas } from "@dusk/w3sper";

  import {
    AnchorButton,
    Badge,
    Icon,
    Select,
    Textbox,
    Throbber,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import {
    AppAnchorButton,
    Banner,
    DepositResult,
    GasFee,
    GasSettings,
    OperationResult,
  } from "$lib/components";
  import { account, duskEvm, wagmiConfig } from "$lib/web3/walletConnection";
  import { logo } from "$lib/dusk/icons";
  import { BRIDGE_DEPOSIT_MIN_GAS_LIMIT } from "$lib/bridge/deposit";
  import {
    depositActivityStore,
    pendingDepositAmountLux,
    rememberDepositTransaction,
    resumeDepositTracking,
    trackDepositTransaction,
  } from "$lib/bridge/depositActivity";
  import { rememberWithdrawalTransaction } from "$lib/bridge/withdrawalActivity";
  import { prepareNativeDuskWithdrawalCall } from "$lib/bridge/withdrawalInitiation";
  import { MESSAGES } from "$lib/constants";
  import { luxToDusk } from "$lib/dusk/currency";
  import { getDecimalSeparator, slashDecimals } from "$lib/dusk/number";
  import { cleanNumberString } from "$lib/dusk/string";
  import { areValidGasSettings } from "$lib/contracts";
  import { walletStore } from "$lib/stores";

  /** @type {`0x${string}`} */
  const VITE_EVM_BRIDGE_CONTRACT_ADDRESS = import.meta.env
    .VITE_EVM_BRIDGE_CONTRACT_ADDRESS;

  /**
   * DuskEVM uses duskEvm.nativeCurrency.decimals (currently 18). DuskDS uses 9 decimals (Lux).
   * This converts from EVM base units (1e18) to Lux units (1e9) so we can reuse luxToDusk().
   * @type {bigint}
   */
  const EVM_TO_LUX_SCALE_FACTOR =
    10n ** BigInt(duskEvm.nativeCurrency.decimals - 9);
  const LAST_WITHDRAWAL_TX_HASH_KEY = "dusk-evm:last-withdrawal-tx-hash";
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
      bridgeAddress: VITE_EVM_BRIDGE_CONTRACT_ADDRESS,
      evmRecipient: $account.address,
      minGasLimit: DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT,
    });

    await switchChain(wagmiConfig, { chainId: duskEvm.id });

    return await sendTransaction(wagmiConfig, {
      chainId: duskEvm.id,
      data: withdrawal.data,
      to: withdrawal.to,
      value: withdrawal.value,
    });
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
    const hash = getKey("hash")(response);

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
    rememberWithdrawalTransaction(
      /** @type {`0x${string}`} */ (lastWithdrawalTxHash),
      { account: $account.address, amountWei }
    );

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
  $: isDepositing =
    originNetwork === "duskDs" && destinationNetwork === "duskEvm";
  $: isWithdrawing =
    originNetwork === "duskEvm" && destinationNetwork === "duskDs";
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
  $: isGasValid = areValidGasSettings(gasPrice, gasLimit);
  $: ({ address } = $account);

  onMount(() => {
    lastWithdrawalTxHash =
      localStorage.getItem(LAST_WITHDRAWAL_TX_HASH_KEY) ?? "";

    const unsubscribeAccount = account.subscribe((value) => {
      resumeDepositTracking(value.address);
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
        {formatter(luxToDusk(unshieldedBalance))}
      </dd>
      <dt class="balances__token">DuskEVM</dt>
      <dd class="balances__balance">
        {#if evmDuskBalance}
          {formatter(luxToDusk(evmDuskBalance.value / EVM_TO_LUX_SCALE_FACTOR))}
        {:else}
          <Throbber size={16} />
        {/if}
        {#if incomingDepositLux > 0n}
          <small>
            + {formatter(luxToDusk(incomingDepositLux))} incoming
          </small>
        {/if}
      </dd>
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
        nextButton={{ disabled: isNextButtonDisabled }}
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

            <hr class="glyph" />

            <p class="operation__label">To</p>

            <div class="operation__input-wrapper">
              <Select
                bind:value={destinationNetwork}
                name="destination-network"
                options={destinationNetworkOptions}
              />
            </div>

            <div class="operation__input-wrapper">
              <Textbox
                className="operation__input-field"
                required
                type="text"
                id="destination-amount"
                name="destination-amount"
                bind:value={amount}
              />
              <Icon
                data-tooltip-id="main-tooltip"
                data-tooltip-text="DUSK"
                path={logo}
              />
            </div>

            {#if amount !== ""}
              {#if isDepositing && !hasEnoughUnshielded}
                <Banner title="Insufficient balance" variant="warning">
                  <p>
                    Your <b>unshielded</b> balance must cover the amount
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
                    Your <b>DuskEVM</b> balance is too low for this withdrawal (you
                    also need a little extra for gas).
                  </p>
                </Banner>
              {/if}
            {/if}
          </fieldset>
          {#if isDepositing}
            <GasSettings
              {formatter}
              {fee}
              limit={gasSettings.gasLimit}
              limitLower={gasLimits.gasLimitLower}
              limitUpper={gasLimits.gasLimitUpper}
              price={gasSettings.gasPrice}
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
          <dl class="operation__review-transaction">
            <dt class="review-transaction__label">
              <Icon path={mdiArrowUpBoldBoxOutline} />
              <span>Amount:</span>
            </dt>
            <dd class="review-transaction__value operation__review-amount">
              <span>
                {`${formatter(luxToDusk(amountLux))} DUSK`}
              </span>
              <Icon
                className="dusk-amount__icon"
                path={logo}
                data-tooltip-id="main-tooltip"
                data-tooltip-text="DUSK"
              />
            </dd>
          </dl>
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
            <GasFee {formatter} {fee} />
          {/if}
          <Banner title="Fee Details" variant="info">
            <p>
              The fee will be deducted from your <b
                >{isDepositing ? "unshielded" : "EVM"}</b
              > balance.
            </p>
          </Banner>
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
            successMessage="Withdrawal request submitted"
          >
            <svelte:fragment slot="success-content" let:result={hash}>
              <p>{MESSAGES.TRANSACTION_PENDING}</p>
              {#if hash}
                <AnchorButton
                  href={`${duskEvm.blockExplorers.default.url}/tx/${hash}`}
                  text="VIEW ON BLOCK EXPLORER"
                  rel="noopener noreferrer"
                  target="_blank"
                />
                <AppAnchorButton
                  href={withdrawalStatusHref(rememberWithdrawalTxHash(hash))}
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

    &__review-amount {
      justify-content: flex-start;
    }

    &__bridge {
      display: flex;
      flex-direction: column;
      gap: 1.2em;
    }

    .review-transaction__label,
    .review-transaction__value {
      display: inline-flex;
      align-items: center;
      gap: var(--small-gap);
    }

    .review-transaction__value {
      font-family: var(--mono-font-family);
      font-weight: 500;
    }

    :global(&__review-notice) {
      text-align: center;
    }

    & > :global(.operation__operation-button) {
      width: 100%;
      text-align: left;
    }
  }

  .glyph {
    margin: var(--default-gap) 0;
    height: 1px;
  }

  .glyph:after {
    content: "↑↓";
    display: inline-block;
    position: relative;
    top: -1.2em;
    color: var(--divider-border-color);
    border: 1px solid var(--divider-border-color);
    border-radius: 2em;
    padding: 0.5em 1.25em;
    background-color: var(--divider-background-color);
  }
</style>
