<svelte:options immutable={true} />

<script>
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { mdiAlertOutline, mdiArrowUpBoldBoxOutline } from "@mdi/js";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import { isDuskName } from "$lib/dusk-domains";
  import { getAddressInfo } from "$lib/wallet";
  import { getBlocklistedRecipient } from "$lib/security/addressBlocklist";
  import { duskToLux, luxToDusk } from "$lib/dusk/currency";
  import {
    isValidEvmAddress,
    makeClassName,
    randomUUID,
    shortenAddress,
  } from "$lib/dusk/string";
  import {
    Badge,
    Button,
    Stepper,
    Switch,
    Textbox,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    AppAnchor,
    Banner,
    DuskIcon,
    GasSettings,
    ReviewAmount,
    ScanQR,
    TransactionResult,
  } from "$lib/components";

  /** @type {(to: string, amount: bigint, memo: string, gasPrice: bigint, gasLimit: bigint, toName?: string) => Promise<string>} */
  export let execute;

  /** @type {(amount: number) => string} */
  export let formatter;

  /** @type {(name: string) => Promise<DuskNameResolution>} */
  export let resolveName;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /**
   * The spendable balance the transfer is paid from.
   *
   * @type {bigint}
   */
  export let availableBalance;

  /**
   * The spendable shielded balance, which pays transfers to shielded addresses.
   *
   * @type {bigint}
   */
  export let shieldedBalance;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {string} */
  export let shieldedAddress;

  /** @type {string} */
  export let publicAddress;

  /** @type {undefined | string} */
  export let bep20BridgeAddress = undefined;

  /** @type {number} */
  let sendAmount = 1;

  /** @type {string} */
  let sendToAddress = "";

  /** @type {string} */
  let memo = "";

  /** @type {import("qr-scanner").default} */
  let scanner;

  /** @type {import("..").ScanQR} */
  let scanQrComponent;

  /** @type {import("$lib/dusk/components").WizardStep} */
  let addressStep;

  /**
   * Whether a recipient that isn't valid is pointed out: once it is pasted,
   * left or confirmed with Enter, not while it is being typed.
   *
   * @type {boolean}
   */
  let isRecipientChecked = false;

  /** @type {boolean} */
  let isMemoShown = false;

  /** @type {boolean} */
  let isNextButtonDisabled = false;

  /** @type {boolean} */
  let isGasValid = false;

  /** @type {boolean} */
  let isMemoValid = true;

  /** @type {DuskNameResolution | null} */
  let nameLookup = null;

  /**
   * The address the user picked for each `.dusk` name with both a public
   * account and a shielded address. A pick stays with its name, through
   * lookups of the same name and steps back, until the user makes another;
   * any other name starts at its public account.
   *
   * @type {Record<string, "account" | "address">}
   */
  let namePicks = {};

  /**
   * The options shown for a `.dusk` name with both addresses, by type,
   * for the focus to follow the pick.
   *
   * @type {Partial<Record<"account" | "address", HTMLElement>>}
   */
  const nameOptionElements = {};

  const nameOptionsId = randomUUID();

  const invalidRecipientId = `${randomUUID()}-invalid-recipient`;

  // Without the allocation page there is nowhere to link to for shielding.
  const canShield = import.meta.env.VITE_FEATURE_ALLOCATE === "true";

  let { gasLimit, gasPrice } = gasSettings;

  const minAmount = 0.000000001;

  const steps = [
    { label: "Address" },
    { label: "Amount" },
    { label: "Review" },
    { label: "Done" },
  ];
  const dispatch = createEventDispatcher();

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  function setMaxAmount() {
    if (!isGasValid) {
      toast("error", "Please set valid gas settings first", mdiAlertOutline);
      return;
    }

    if (availableBalance < maxGasFee) {
      toast(
        "error",
        "You don't have enough DUSK to cover the transaction fee",
        mdiAlertOutline
      );
      return;
    }

    sendAmount = luxToDusk(maxSpendableAmount);
  }

  /**
   * Enter moves on as Next does: no address or name has a line break.
   *
   * @param {KeyboardEvent} event
   */
  function handleRecipientKeyDown(event) {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      isRecipientChecked = true;
      addressStep.next(event);
    }
  }

  /**
   * Looks up a `.dusk` name, keeping only the result
   * for the name currently entered.
   *
   * @param {string} name
   */
  function lookUpName(name) {
    if (!name) {
      nameLookup = null;
      return;
    }

    const lookup = { name };

    nameLookup = lookup;
    resolveName(name).then((result) => {
      if (nameLookup === lookup) {
        nameLookup = result;
      }
    });
  }

  /**
   * @typedef {{
   *   address: string,
   *   disabled: boolean,
   *   title: string,
   *   type: "account" | "address",
   *   visibility: string,
   * }} NameOption
   */

  /**
   * The address of a `.dusk` name the transfer goes to: the one picked for
   * a name with both a public account and a shielded address, its public
   * account otherwise, or its shielded address when it has only that.
   *
   * @param {DuskNameResolution | null} lookup
   * @param {Record<string, "account" | "address">} picks
   * @returns {"account" | "address"}
   */
  function getNameAddressType(lookup, picks) {
    if (!lookup?.account) {
      return "address";
    }

    return (lookup.address && picks[lookup.name]) || "account";
  }

  /**
   * The addresses a `.dusk` name points to, to pick from when it has both a
   * public account and a shielded address. The shielded address can't be
   * picked, or sent to, while the shielded balance can't pay.
   *
   * @param {DuskNameResolution | null} lookup
   * @param {boolean} canPayShielded
   * @returns {NameOption[]}
   */
  function getNameOptions(lookup, canPayShielded) {
    /** @type {NameOption[]} */
    const options = [
      {
        address: lookup?.account ?? "",
        disabled: false,
        title: "Public account",
        type: "account",
        visibility: "Visible on chain",
      },
      {
        address: lookup?.address ?? "",
        disabled: !canPayShielded,
        title: "Shielded address",
        type: "address",
        visibility: "Private",
      },
    ];

    return options.filter((option) => option.address);
  }

  /**
   * Picks which address of the `.dusk` name entered the transfer goes
   * to, unless that option is disabled.
   *
   * @param {"account" | "address"} type
   */
  function pickNameAddress(type) {
    const option = nameOptions.find((item) => item.type === type);

    if (nameLookup && option && !option.disabled) {
      namePicks = { ...namePicks, [nameLookup.name]: type };
    }
  }

  /**
   * How far each arrow key moves the pick between options.
   *
   * @type {Record<string, number>}
   */
  const arrowKeyOffsets = {
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -1,
  };

  /**
   * Moves the pick with the arrow keys, past a disabled option, and makes
   * it with Space, as in a radio group.
   *
   * @param {KeyboardEvent} event
   * @param {"account" | "address"} type The option with the focus.
   */
  async function handleNameOptionKeyDown(event, type) {
    const offset = arrowKeyOffsets[event.key] ?? 0;

    if (!offset && event.key !== " ") {
      return;
    }

    event.preventDefault();

    const types = nameOptions
      .filter((option) => !option.disabled)
      .map((option) => option.type);
    const next = offset
      ? types[(types.indexOf(type) + offset + types.length) % types.length]
      : type;

    if (next) {
      pickNameAddress(next);
      await tick();
      nameOptionElements[next]?.focus();
    }
  }

  /** @type {Record<DuskNameError, (name: string) => [string, string]>} */
  const nameErrors = {
    expired: (name) => [
      `${name} has expired`,
      "An expired name can't receive DUSK.",
    ],
    invalid: (name) => [
      `${name} isn't a valid name`,
      "Names use only letters, digits and hyphens.",
    ],
    "lookup-failed": (name) => [
      `Couldn't look up ${name}`,
      "Check your connection.",
    ],
    "no-address": (name) => [
      `${name} has no address to send to`,
      "Its owner needs to add one first.",
    ],
    "not-registered": (name) => [
      `${name} isn't registered`,
      "Check the name, or paste the recipient's address instead.",
    ],
    "unsupported-network": () => [
      ".dusk names aren't available on this network",
      "They work on mainnet and testnet. Paste the recipient's address instead.",
    ],
  };

  let activeStep = 0;

  /**
   * Sends the transfer, with the `.dusk` name it goes to, as the lookup
   * gives it, for the history.
   */
  function sendTransfer() {
    const toName = recipientName ? nameLookup?.name : undefined;

    return toName
      ? execute(
          recipientAddress,
          sendAmountInLux,
          transactionMemo,
          gasPrice,
          gasLimit,
          toName
        )
      : execute(
          recipientAddress,
          sendAmountInLux,
          transactionMemo,
          gasPrice,
          gasLimit
        );
  }

  // The gas settings depend on the recipient (public or shielded), chosen in
  // the address step: start over from new ones there. On the amount step,
  // where the gas can be edited, take new ones, as the node's price, unless
  // the gas was edited there. The review keeps the gas it shows.
  let defaultGas = gasSettings;

  $: if (activeStep <= 1 && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } =
      activeStep === 0
        ? gasSettings
        : followDefaultGas({ gasLimit, gasPrice }, defaultGas, gasSettings));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  $: sendAmountInLux = sendAmount ? duskToLux(sendAmount) : 0n;

  // Calculate the maximum gas fee based on the gas limit and gas price.
  $: maxGasFee = gasLimit * gasPrice;

  // A balance can pay for a transfer if it covers the smallest amount the
  // amount step takes plus the maximum gas fee, which that step requires.
  $: canPayFromShieldedBalance =
    shieldedBalance >= maxGasFee + duskToLux(minAmount);

  // Check if the available balance is sufficient to cover the max gas fee.
  // This is a prerequisite for any transaction.
  $: isBalanceSufficientForGas = availableBalance >= maxGasFee;

  // Determine the maximum amount spendable for the transfer.
  // If the available balance is less than the max gas fee, set it to 0n to avoid negative values.
  $: maxSpendableAmount =
    availableBalance >= maxGasFee ? availableBalance - maxGasFee : 0n;

  // Validate that the send amount is within allowable limits:
  // - At least the minimum send requirement.
  // - At most the maximum spendable amount (after accounting for maximum gas fees).
  $: isSendAmountValid =
    sendAmountInLux >= minAmount && sendAmountInLux <= maxSpendableAmount;

  // Calculate the total amount for the transaction, which includes:
  // - The maximum gas fee.
  // - The user-specified amount to send (converted to Lux).
  $: totalAmount = maxGasFee + sendAmountInLux;

  // Validate that the total amount is within the user's available balance.
  $: isTotalAmountWithinAvailableBalance = totalAmount <= availableBalance;

  $: transactionMemo = isSendingToBep20Bridge ? memo.trim() : memo;

  // For BEP20 bridge operations, memo is required and must be a valid EVM address
  $: isMemoValidForBridge =
    !isSendingToBep20Bridge || (transactionMemo !== "" && isMemoValid);

  $: isNextButtonDisabled = !(
    isSendAmountValid &&
    isGasValid &&
    isTotalAmountWithinAvailableBalance &&
    isBalanceSufficientForGas &&
    isMemoValidForBridge &&
    !isRecipientBlocklisted
  );

  // A pasted recipient often brings spaces or line breaks, which no address
  // or name has.
  $: if (/\s/.test(sendToAddress)) {
    sendToAddress = sendToAddress.replace(/\s+/g, "");
  }

  $: if (!sendToAddress) {
    isRecipientChecked = false;
  }

  $: recipientName = isDuskName(sendToAddress) ? sendToAddress.trim() : "";

  $: lookUpName(recipientName);

  $: nameAddressType = getNameAddressType(nameLookup, namePicks);

  // The addresses the name points to: one, or two to pick from.
  $: nameOptions = getNameOptions(nameLookup, canPayFromShieldedBalance);

  // The address the transfer goes to: the one entered, or the one picked
  // of the addresses a `.dusk` name resolved to (empty until it has).
  $: recipientAddress = recipientName
    ? (nameLookup?.[nameAddressType] ?? "")
    : sendToAddress;

  // A name's shielded address needs a shielded balance that can pay.
  $: isNameUnpayable =
    Boolean(nameLookup?.[nameAddressType]) &&
    nameAddressType === "address" &&
    !canPayFromShieldedBalance;

  $: addressInfo = getAddressInfo(
    recipientAddress,
    shieldedAddress,
    publicAddress
  );

  $: isRecipientInvalid =
    isRecipientChecked && !recipientName && !addressInfo.isValid;

  $: blocklistedRecipient = getBlocklistedRecipient(recipientAddress);
  $: isRecipientBlocklisted = Boolean(blocklistedRecipient);

  // The page shows the balance that pays: the shielded one for a shielded
  // address, the public one for anything else, including no recipient.
  $: recipientType = addressInfo.type;
  $: dispatch("keyChange", { type: recipientType });

  $: isSendingToBep20Bridge = recipientAddress.trim() === bep20BridgeAddress;

  $: if (isSendingToBep20Bridge) {
    isMemoShown = true;
  }

  $: {
    if (isSendingToBep20Bridge && transactionMemo !== "") {
      // If sending to the BEP20 bridge and a memo is provided,
      // it must be a valid EVM address.
      isMemoValid = isValidEvmAddress(transactionMemo);
    } else {
      // Otherwise (not sending to BEP20 bridge, or memo is empty),
      // the memo is not considered invalid from an EVM format perspective.
      isMemoValid = true;
    }
  }

  $: sendToAddressTextboxClasses = makeClassName({
    "operation__send-address": true,
    "operation__send-address--blocked": isRecipientBlocklisted,
    "operation__send-address--invalid": recipientName
      ? nameLookup?.error
      : sendToAddress && !addressInfo.isValid,
  });

  $: sendMemoTextboxClasses = makeClassName({
    "operation__send-memo": true,
    "operation__send-memo--invalid": isMemoValid === false,
  });
</script>

<div class="operation">
  <Wizard steps={steps.length} let:key>
    <div slot="stepper">
      <Stepper {activeStep} {steps} />
    </div>
    <!-- Address Step -->
    <WizardStep
      bind:this={addressStep}
      step={0}
      {key}
      backButton={{
        disabled: false,
        href: "/dashboard",
        isAnchor: true,
      }}
      nextButton={{
        action: () => activeStep++,
        disabled:
          !addressInfo.isValid || isRecipientBlocklisted || isNameUnpayable,
      }}
    >
      <div in:fade|global class="operation__send">
        <div class="operation__address-wrapper">
          <p>Address or .dusk name</p>
          <!-- Only with a camera, which ScanQR looks for without asking
            for permission. -->
          {#if scanner}
            <Button
              size="small"
              on:click={() => {
                scanQrComponent.startScan();
              }}
              text="Scan QR"
            />
          {/if}
        </div>
        <Textbox
          required
          className={sendToAddressTextboxClasses}
          aria-describedby={isRecipientInvalid ? invalidRecipientId : undefined}
          aria-invalid={isRecipientInvalid}
          aria-label="Recipient address or .dusk name"
          type="multiline"
          bind:value={sendToAddress}
          on:blur={() => {
            isRecipientChecked = true;
          }}
          on:keydown={handleRecipientKeyDown}
          on:paste={() => {
            isRecipientChecked = true;
          }}
        />

        {#if isRecipientInvalid}
          <Banner
            id={invalidRecipientId}
            title="Not a valid address"
            variant="error"
          >
            <p>Check it, or paste it again.</p>
          </Banner>
        {/if}

        {#if nameLookup?.[nameAddressType]}
          {@const isChoice = nameOptions.length > 1}
          <p id="{nameOptionsId}-label">{nameLookup.name} points to</p>
          <!-- Radios only when there is a choice: a name's one address shows
            in the same card as plain text, with no radio mark. -->
          <div
            aria-labelledby={isChoice ? `${nameOptionsId}-label` : undefined}
            class="operation__name-options"
            role={isChoice ? "radiogroup" : undefined}
          >
            {#each nameOptions as option (option.type)}
              {@const id = `${nameOptionsId}-${option.type}`}
              {@const isPicked = option.type === nameAddressType}
              {#snippet optionText()}
                {#if isChoice}
                  <span class="operation__name-option-mark"></span>
                {/if}
                <span class="operation__name-option-text">
                  <span class="operation__name-option-title">
                    <strong id="{id}-title">{option.title}</strong>
                    <samp id="{id}-address" title={option.address}>
                      <span aria-hidden="true"
                        >{shortenAddress(option.address)}</span
                      >
                      <span class="sr-only">{option.address}</span>
                    </samp>
                  </span>
                  {#if !option.disabled}
                    <span id="{id}-text">{option.visibility}</span>
                  {/if}
                </span>
              {/snippet}
              <div
                class="operation__name-option"
                class:operation__name-option--disabled={option.disabled}
                class:operation__name-option--picked={isPicked}
                class:operation__name-option--single={!isChoice}
              >
                {#if isChoice}
                  <div
                    aria-checked={isPicked}
                    aria-describedby={option.disabled
                      ? `${id}-hint ${id}-address`
                      : `${id}-text ${id}-address`}
                    aria-disabled={option.disabled}
                    aria-labelledby="{id}-title"
                    bind:this={nameOptionElements[option.type]}
                    class="operation__name-option-body"
                    on:click={() => pickNameAddress(option.type)}
                    on:keydown={(event) =>
                      handleNameOptionKeyDown(event, option.type)}
                    role="radio"
                    tabindex={isPicked ? 0 : -1}
                  >
                    {@render optionText()}
                  </div>
                {:else}
                  <div class="operation__name-option-body">
                    {@render optionText()}
                  </div>
                {/if}
                {#if option.disabled}
                  <p class="operation__name-hint" id="{id}-hint">
                    Not enough shielded DUSK ·
                    {#if canShield}
                      <AppAnchor href="/dashboard/allocate"
                        >Shield first</AppAnchor
                      >
                    {:else}
                      Shield first
                    {/if}
                  </p>
                {/if}
              </div>
            {/each}
          </div>
        {:else if nameLookup?.error}
          {@const [title, text] = nameErrors[nameLookup.error](nameLookup.name)}
          <Banner variant="error" {title}>
            <p>{text}</p>
            {#if nameLookup.error === "lookup-failed"}
              <Button
                size="small"
                variant="tertiary"
                on:click={() => lookUpName(recipientName)}
                text="Try again"
              />
            {/if}
          </Banner>
        {:else if nameLookup}
          <p>Looking up {nameLookup.name}…</p>
        {/if}

        {#if isRecipientBlocklisted}
          <Banner variant="error" title="Blocked recipient address">
            <p>{blocklistedRecipient?.reason}</p>
          </Banner>
        {/if}

        <ScanQR
          bind:this={scanQrComponent}
          bind:scanner
          on:scan={(event) => {
            sendToAddress = event.detail;
          }}
        />
        {#if addressInfo.isSelfReferential}
          <Banner variant="warning" title="This is your own address." />
        {/if}
        {#if isSendingToBep20Bridge}
          <Banner variant="info" title="BEP20 bridge address">
            <p>In the memo, enter the EVM address that receives the tokens.</p>
          </Banner>
        {/if}
      </div>
    </WizardStep>
    <!-- Amount Step -->
    <WizardStep
      step={1}
      {key}
      backButton={{
        action: () => activeStep--,
      }}
      nextButton={{
        action: () => activeStep++,
        disabled: isNextButtonDisabled,
      }}
    >
      <div in:fade|global class="operation__send">
        <div class="operation__amount-wrapper">
          <p>Amount</p>
          <Button
            size="small"
            variant="tertiary"
            on:click={setMaxAmount}
            text="Use max"
          />
        </div>

        <div class="operation__input-wrapper">
          <Textbox
            className="operation__input-field"
            bind:value={sendAmount}
            aria-label="Amount"
            required
            type="number"
            min={minAmount}
            max={luxToDusk(maxSpendableAmount)}
            step="0.000000001"
          />
          <DuskIcon />
        </div>

        <div class="operation__input-wrapper">
          <p>Memo{isSendingToBep20Bridge ? "" : " (optional)"}</p>
          <Switch
            aria-label="Include memo"
            on:change={() => {
              if (!isMemoShown) {
                memo = "";
              }
            }}
            onSurface
            bind:value={isMemoShown}
          />
        </div>
        {#if isMemoShown}
          <Textbox
            required
            className={sendMemoTextboxClasses}
            aria-label="Memo"
            type="multiline"
            bind:value={memo}
          />

          {#if isMemoValid === false}
            <Banner variant="error" title="Invalid EVM address format">
              <p>
                EVM addresses are 40 hexadecimal characters, optionally prefixed
                with "0x".
              </p>
            </Banner>
          {/if}
        {/if}

        <GasSettings
          {formatter}
          fee={maxGasFee}
          limit={gasLimit}
          limitLower={gasLimits.gasLimitLower}
          limitUpper={gasLimits.gasLimitUpper}
          price={gasPrice}
          priceLower={gasLimits.gasPriceLower}
          on:gasSettings={(event) => {
            isGasValid = areValidGasSettings(
              event.detail.price,
              event.detail.limit,
              gasLimits
            );

            if (isGasValid) {
              gasPrice = event.detail.price;
              gasLimit = event.detail.limit;
            }
          }}
        />
        {#if !isBalanceSufficientForGas}
          <Banner variant="error" title="Insufficient balance for gas fees">
            <p>Add funds or lower the gas limit.</p>
          </Banner>
        {:else if sendAmountInLux > maxSpendableAmount}
          <Banner variant="error" title="Amount exceeds available balance">
            <p>Lower the amount to leave room for the fee.</p>
          </Banner>
        {:else if isSendingToBep20Bridge && memo.trim() === ""}
          <Banner variant="error" title="Memo required for bridge operation">
            <p>Enter the EVM address that receives the tokens.</p>
          </Banner>
        {/if}
      </div>
    </WizardStep>
    <!-- Review Step -->
    <WizardStep
      step={2}
      {key}
      backButton={{
        action: () => activeStep--,
      }}
      nextButton={{
        action: () => activeStep++,
        disabled: isRecipientBlocklisted,
        icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
        label: "Send",
        variant: "primary",
      }}
    >
      <div in:fade|global class="operation__send">
        <ReviewAmount label="Amount" value={formatter(sendAmount)} />

        <dl class="operation__review-transaction">
          <dt class="review-transaction__label">
            <span>To</span>
          </dt>
          {#if nameLookup?.[nameAddressType]}
            <dd class="operation__review-name">{nameLookup.name}</dd>
          {/if}
          <dd
            class="operation__review-address"
            class:operation__review-address--with-name={nameLookup?.[
              nameAddressType
            ]}
          >
            <span>{recipientAddress}</span>
          </dd>
        </dl>

        <dl class="operation__review-transaction">
          <dt class="review-transaction__label">
            <span>Type</span>
          </dt>
          <dd class="operation__review-type">
            {#if addressInfo.type === "address"}
              <Badge text="Shielded" />
              <span>Private</span>
            {:else}
              <Badge text="Public" />
              <span>Visible on chain</span>
            {/if}
          </dd>
        </dl>

        {#if transactionMemo}
          <dl class="operation__review-transaction">
            <dt class="review-transaction__label">
              <span>Memo</span>
            </dt>
            <dd class="operation__review-memo">
              <span>{transactionMemo}</span>
            </dd>
          </dl>
        {/if}

        <ReviewAmount
          label="Network fee (at most)"
          value={formatter(luxToDusk(maxGasFee))}
        />
        <ReviewAmount
          label="Total (at most)"
          value={formatter(luxToDusk(totalAmount))}
        />
      </div>
    </WizardStep>
    <!-- Result Step -->
    <WizardStep step={3} {key} showNavigation={false}>
      <TransactionResult
        {formatter}
        maxFee={maxGasFee}
        operation={sendTransfer()}
      />
    </WizardStep>
  </Wizard>
</div>

<style lang="postcss">
  .operation {
    &__send {
      display: flex;
      flex-direction: column;
      gap: 1.2em;
    }
    &__review-address,
    &__review-memo {
      background-color: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);
      font-variant-numeric: tabular-nums;
      font-size: 0.875rem;
      padding: 0.75em 1em;
      width: 100%;
      line-break: anywhere;
    }

    /* Shown with a name, the address gives way to it. */
    &__review-address--with-name {
      color: var(--muted-color);
      font-size: 0.8125rem;
    }

    &__review-name {
      font-size: 1.125rem;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    &__address-wrapper,
    &__amount-wrapper,
    &__input-wrapper {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    &__input-wrapper {
      column-gap: var(--default-gap);
    }

    &__review-transaction {
      display: flex;
      flex-direction: column;
      gap: 0.625em;
    }

    &__review-type {
      display: flex;
      align-items: baseline;
      gap: var(--small-gap);
      font-size: 0.875em;
      line-height: 1.4;
    }

    &__name-options {
      display: flex;
      flex-direction: column;
      gap: 0.625em;
    }

    &__name-option {
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);

      &:focus-within {
        box-shadow: 0 0 0 2px var(--focus-ring-color);
      }
    }

    &__name-option--picked {
      border-color: var(--primary-color);
      background-color: var(--non-button-control-bg-color);
    }

    &__name-option-body {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      outline: none;

      &[role="radio"] {
        cursor: pointer;
      }
    }

    &__name-option--disabled &__name-option-body {
      opacity: 0.5;
      /* Its hint, below, stands in for its line. */
      padding-bottom: 0;

      &[role="radio"] {
        cursor: not-allowed;
      }
    }

    &__name-option-mark {
      flex-shrink: 0;
      width: 1rem;
      height: 1rem;
      margin-top: 0.2rem;
      border: 0.125rem solid var(--checkbox-control-border-color);
      border-radius: 50%;
    }

    &__name-option--picked &__name-option-mark {
      background-color: var(--checkbox-control-checked-bg-color);
      box-shadow: inset 0 0 0 0.15rem var(--non-button-control-bg-color);
    }

    &__name-option-text {
      display: flex;
      flex-direction: column;
      gap: 0.25em;
      min-width: 0;
      font-size: 0.875em;
      line-height: 1.4;
    }

    &__name-option-title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.5em;
      font-size: 1rem;

      & samp {
        color: var(--muted-color);
        font-family: var(--mono-font-family);
        font-size: 0.75rem;
      }
    }

    &__name-hint {
      font-size: 0.875em;
      line-height: 1.4;
    }

    &__name-option &__name-hint {
      /* In line with the option's text, past its radio mark. */
      padding: 0.25em 1rem 0.75rem 2.75rem;
    }

    /* A name's one address has no radio mark to pass. */
    &__name-option--single &__name-hint {
      padding-left: 1rem;
    }
  }

  .review-transaction__label {
    display: inline-flex;
    align-items: center;
    gap: var(--small-gap);
  }

  :global(
    .dusk-textbox.operation__send-address,
    .dusk-textbox.operation__send-memo
  ) {
    resize: vertical;
    min-height: 5em;
    max-height: 10em;
  }

  :global(.dusk-textbox.operation__send-address--invalid) {
    color: var(--badge-error-color);
  }

  :global(.dusk-textbox.operation__send-address--blocked) {
    color: var(--badge-error-color);
    border-color: var(--badge-error-color);
  }

  :global(.dusk-textbox.operation__send-memo--invalid) {
    border-color: var(--badge-error-color);
  }

  :global(.allocate-button) {
    width: 100%;
  }
</style>
