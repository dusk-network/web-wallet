<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount, tick } from "svelte";
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiCheckCircleOutline,
    mdiQrcodeScan,
  } from "@mdi/js";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    closeDuskName,
    contactsStore,
    markContactNameChecked,
    markContactNameMoved,
    saveContact,
  } from "$lib/contacts";
  import { asDuskName, isDuskName } from "$lib/dusk-domains";
  import { addBasePath } from "$lib/navigation";
  import { getAddressInfo } from "$lib/wallet";
  import { getBlocklistedRecipient } from "$lib/security/addressBlocklist";
  import { settingsStore } from "$lib/stores";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatTotal,
  } from "$lib/dusk/currency";
  import {
    normalizeDuskInput,
    parseDuskInput,
  } from "$lib/components/Stake/stakeAmount";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import {
    isValidEvmAddress,
    makeClassName,
    randomUUID,
    shortenAddress,
  } from "$lib/dusk/string";
  import { Button, Icon, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    AppAnchor,
    BalanceValue,
    Banner,
    FullAddress,
    GasSettings,
    ScanQR,
    SectionHead,
    TransactionResult,
  } from "$lib/components";

  /** @type {(to: string, amount: bigint, memo: string, gasPrice: bigint, gasLimit: bigint, toName?: string) => Promise<string>} */
  export let execute;

  /** @type {(name: string) => Promise<DuskNameResolution>} */
  export let resolveName;

  /**
   * The wallet's own public accounts and shielded addresses, with how the
   * wallet names their profile: never offered as contacts.
   *
   * @type {{ address: string, label: string }[]}
   */
  export let ownAccounts = [];

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

  /** The recipient the page starts with, as from Send again. */
  export let initialRecipient = "";

  /**
   * `.dusk` names of past counterparties, for "Did you mean …?" along with
   * the contacts' names.
   *
   * @type {string[]}
   */
  export let knownNames = [];

  /** The amount as typed, in DUSK: nothing until it is. */
  let sendAmount = "";

  /** @type {string} */
  let sendToAddress = initialRecipient;

  /** @type {string} */
  let memo = "";

  /** @type {import("qr-scanner").default} */
  let scanner;

  /** @type {import("..").ScanQR} */
  let scanQrComponent;

  /**
   * Where the transfer is: the form, its review (phones only), or sent.
   *
   * @type {"done" | "form" | "review"}
   */
  let step = "form";

  /**
   * The transfer once sent, and the most it can cost.
   *
   * @type {{ maxFee: bigint, memo: string, operation: Promise<string>, what: string } | null}
   */
  let sent = null;

  /**
   * Whether a recipient that isn't valid is pointed out: once it is pasted,
   * left or confirmed with Enter, not while it is being typed.
   *
   * @type {boolean}
   */
  let isRecipientChecked = false;

  /** @type {boolean} */
  let isGasValid = false;

  /** @type {boolean} */
  let isMemoValid = true;

  /** @type {DuskNameResolution | null} */
  let nameLookup = null;

  /**
   * The address the user picked for each `.dusk` name with both a public
   * account and a shielded address. A pick stays with its name, through
   * lookups of the same name, until the user makes another; any other name
   * starts at its public account.
   *
   * @type {Record<string, "account" | "address">}
   */
  let namePicks = {};

  /**
   * Names the user chose to send to although a contact keeps another
   * address for them, with the address chosen.
   *
   * @type {Record<string, string>}
   */
  let newAddressTaken = {};

  /** The lookup a contact's name was last noted checked for. */
  /** @type {DuskNameResolution | null} */
  let checkedLookup = null;

  /** The contact whose `.dusk` name was last checked as its address was picked. */
  let savedNameChecked = "";

  /**
   * Checks that a contact's `.dusk` name still points to the address saved
   * for it, as Send goes to that address: noted on the contact, moved or
   * not, so that Send and Contacts can say so. Once a contact.
   *
   * @param {Contact} saved
   */
  async function checkSavedName(saved) {
    const key = [saved.id, saved.address, saved.duskName].join("\n");

    if (!saved.duskName || savedNameChecked === key) {
      return;
    }

    savedNameChecked = key;

    const resolution = await resolveName(saved.duskName).catch(() => null);

    // A lookup that failed, or a network without names, checked nothing.
    if (
      !resolution ||
      resolution.error === "lookup-failed" ||
      resolution.error === "unsupported-network"
    ) {
      return;
    }

    const pointsTo =
      (saved.type === "address" ? resolution.address : resolution.account) ??
      "";

    if (pointsTo === saved.address) {
      markContactNameChecked(saved);
    } else {
      markContactNameMoved(saved, pointsTo);
    }
  }

  /**
   * What is wrong with the amount typed, in the words the page shows: ""
   * for nothing typed yet, or an amount that can go.
   *
   * @param {string} text
   * @param {bigint | null} amount
   */
  function amountErrorOf(text, amount) {
    const typed = text.trim();

    if (!typed) {
      return "";
    }

    if (amount === null) {
      return /^\d*\.\d{10,}$/.test(typed)
        ? "DUSK has 9 decimals at most."
        : "Enter an amount such as 10 or 10.5.";
    }

    if (amount === 0n) {
      return "Enter an amount greater than 0.";
    }

    if (amount > availableBalance) {
      return `More than your ${formatDuskExact(availableBalance, language)} DUSK.`;
    }

    return amount > maxSpendableAmount
      ? `That leaves too little for the network fee: send up to ${formatDuskExact(maxSpendableAmount, language)} DUSK.`
      : "";
  }

  /** Whether the recipient is being saved to the contacts, and as what. */
  let isSavingContact = false;
  let contactName = "";

  /**
   * The options shown for a `.dusk` name with both addresses, by type,
   * for the focus to follow the pick.
   *
   * @type {Partial<Record<"account" | "address", HTMLElement>>}
   */
  const nameOptionElements = {};

  const id = randomUUID();
  const invalidRecipientId = `${id}-invalid-recipient`;

  // Without the allocation page there is nowhere to link to for shielding.
  const canShield = import.meta.env.VITE_FEATURE_ALLOCATE === "true";

  let { gasLimit, gasPrice } = gasSettings;
  let defaultGas = gasSettings;

  /** The least a transfer sends: one LUX. */
  const minAmount = 1n;

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

    sendAmount = formatDuskPlain(maxSpendableAmount);
  }

  /**
   * Enter checks the recipient and moves on to the amount: no address or
   * name has a line break.
   *
   * @param {KeyboardEvent} event
   */
  function handleRecipientKeyDown(event) {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      isRecipientChecked = true;

      if (addressInfo.isValid) {
        document.getElementById(`${id}-amount`)?.focus();
      }
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
        visibility: "Not shown on the public chain",
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

  /**
   * The contact a transfer goes to: the one saved with the address it goes
   * to, or else with the `.dusk` name entered and the kind of address
   * picked of it, whose address is then compared with the one the name
   * points to now.
   *
   * @param {Contact[]} contacts
   * @param {string} name
   * @param {string} address
   * @param {"account" | "address"} type The kind of address picked
   * @returns {Contact | null}
   */
  const contactFor = (contacts, name, address, type) =>
    contacts.find((contact) => address && contact.address === address) ??
    (name
      ? (contacts.find(
          (contact) =>
            contact.duskName === name.toLowerCase() && contact.type === type
        ) ?? null)
      : null);

  function saveRecipient() {
    const name = contactName.trim();

    // Never one of the wallet's own accounts.
    if (name && !own) {
      saveContact({
        address: recipientAddress,
        checkedAt: recipientName ? Date.now() : null,
        duskName: recipientName || null,
        name,
      });
      isSavingContact = false;
      contactName = "";
    }
  }

  /**
   * Sends the transfer, with the `.dusk` name it goes to, as the lookup
   * gives it, for the history.
   */
  function send() {
    const toName = recipientName ? nameLookup?.name : undefined;

    sent = {
      maxFee: maxGasFee,
      memo: transactionMemo,
      operation: toName
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
          ),
      what: `${amountText} DUSK to ${recipientLabel}`,
    };
    step = "done";
  }

  // The gas settings depend on the recipient (public or shielded): the
  // form takes new ones while it shows, unless the gas was edited here, and
  // the review keeps the gas it shows.
  $: if (step === "form" && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  // A comma keyboard's "1,5" and digit grouping read as the amount meant.
  $: typedAmount = normalizeDuskInput(sendAmount, getDecimalSeparator());
  $: parsedAmount = parseDuskInput(typedAmount);
  $: sendAmountInLux = parsedAmount ?? 0n;
  $: amountError = amountErrorOf(typedAmount, parsedAmount);

  // Calculate the maximum gas fee based on the gas limit and gas price.
  $: maxGasFee = gasLimit * gasPrice;

  // A balance can pay for a transfer if it covers the smallest amount
  // plus the maximum gas fee.
  $: canPayFromShieldedBalance = shieldedBalance >= maxGasFee + minAmount;

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

  $: isAmountReady =
    isSendAmountValid &&
    isGasValid &&
    isTotalAmountWithinAvailableBalance &&
    isBalanceSufficientForGas &&
    isMemoValidForBridge;

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

  // A name typed without .dusk, as "alice": Send offers alice.dusk, and
  // looks it up once taken.
  $: bareName = isRecipientInvalid ? asDuskName(sendToAddress) : null;

  $: blocklistedRecipient = getBlocklistedRecipient(recipientAddress);
  $: isRecipientBlocklisted = Boolean(blocklistedRecipient);

  // The page shows the balance that pays: the shielded one for a shielded
  // address, the public one for anything else, including no recipient.
  $: recipientType = addressInfo.type;
  $: dispatch("keyChange", { type: recipientType });

  $: isSendingToBep20Bridge = recipientAddress.trim() === bep20BridgeAddress;

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

  // The account the transfer goes from, as the wallet names it.
  $: from = isShielded ? shieldedAddress : publicAddress;
  $: fromLabel =
    ownAccounts.find((account) => account.address === from)?.label ??
    (isShielded ? "Your shielded balance" : "Your public account");
  // Who the transfer goes to, as the Done screen says it.
  $: recipientLabel = contact
    ? recipientName
      ? `${contact.name} (${shownName})`
      : contact.name
    : own && !recipientName
      ? `your ${own.label}`
      : recipientName
        ? shownName
        : shortenAddress(recipientAddress);
  $: own = ownAccounts.find(
    (account) => recipientAddress && account.address === recipientAddress
  );
  $: contacts = $contactsStore;
  $: contact = contactFor(
    contacts,
    recipientName,
    recipientAddress,
    nameAddressType
  );

  // The address the contact's name points to now, of the kind the contact
  // keeps.
  $: namePointsTo =
    contact && recipientName && nameLookup && !nameLookup.error
      ? ((contact.type === "address"
          ? nameLookup.address
          : nameLookup.account) ?? "")
      : null;

  // A contact's name that points elsewhere now: Send asks before it uses
  // the new address.
  $: isContactMoved =
    namePointsTo !== null &&
    namePointsTo !== contact?.address &&
    newAddressTaken[recipientName.toLowerCase()] !== recipientAddress;

  // A contact's saved address, entered or picked: its name is checked.
  $: if (contact && !recipientName && addressInfo.isValid) {
    checkSavedName(contact);
  }

  // What a lookup of the contact's name found: noted on the contact, still
  // its address or moved, once a lookup.
  $: if (contact && namePointsTo !== null && nameLookup !== checkedLookup) {
    checkedLookup = nameLookup;

    if (namePointsTo === contact.address) {
      markContactNameChecked(contact);
    } else {
      markContactNameMoved(contact, namePointsTo);
    }
  }

  // One of the wallet's own accounts is never saved as a contact.
  $: if (own && isSavingContact) {
    isSavingContact = false;
    contactName = "";
  }

  $: suggestion =
    nameLookup?.error === "not-registered"
      ? closeDuskName(recipientName, [
          ...contacts.flatMap((c) => (c.duskName ? [c.duskName] : [])),
          ...knownNames,
        ])
      : null;

  $: isRecipientReady =
    addressInfo.isValid &&
    !isRecipientBlocklisted &&
    !isNameUnpayable &&
    !isContactMoved;

  $: canSend = isRecipientReady && isAmountReady;

  $: sendToAddressTextboxClasses = makeClassName({
    "send__to-input": true,
    "send__to-input--blocked": isRecipientBlocklisted,
    "send__to-input--invalid": recipientName
      ? nameLookup?.error
      : sendToAddress && !addressInfo.isValid,
  });

  // A name as the lookup gives it, once it has: in its canonical form.
  $: shownName = nameLookup?.name ?? recipientName;

  $: ({ language } = $settingsStore);
  $: amountText = formatDuskExact(sendAmountInLux, language);
  $: isShielded = addressInfo.type === "address";
</script>

{#if step === "done" && sent}
  <TransactionResult
    maxFee={sent.maxFee}
    memo={sent.memo}
    operation={sent.operation}
    what={sent.what}
  />
{:else}
  <div class="send" class:send--review={step === "review"}>
    <section aria-labelledby="{id}-title" class="send__form">
      <a class="send__back" href={addBasePath("/dashboard")}
        ><Icon path={mdiArrowLeft} />Home</a
      >
      <h2 class="send__title" id="{id}-title">Send</h2>

      <div class="send__field">
        <label class="send__label" for="{id}-to">To</label>
        <div class="send__to">
          <Textbox
            aria-describedby={isRecipientInvalid
              ? invalidRecipientId
              : undefined}
            aria-invalid={isRecipientInvalid}
            autocomplete="off"
            bind:value={sendToAddress}
            className={sendToAddressTextboxClasses}
            id="{id}-to"
            on:blur={() => {
              isRecipientChecked = true;
            }}
            on:keydown={handleRecipientKeyDown}
            on:paste={() => {
              isRecipientChecked = true;
            }}
            placeholder="Address or .dusk name"
            spellcheck="false"
            type="text"
          />
          {#if recipientName && nameLookup?.[nameAddressType]}
            <span class="send__verified"
              ><Icon path={mdiCheckCircleOutline} />Name found</span
            >
          {/if}
          <!-- Only with a camera, which ScanQR looks for without asking
            for permission. -->
          {#if scanner}
            <button
              aria-label="Scan a QR code"
              class="send__icon-button"
              on:click={() => {
                scanQrComponent.startScan();
              }}
              title="Scan a QR code"
              type="button"><Icon path={mdiQrcodeScan} /></button
            >
          {/if}
        </div>

        {#if contacts.length}
          <select
            aria-label="Send to a contact"
            class="send__contacts"
            id="{id}-contacts"
            on:change={(event) => {
              const picked = contacts.find(
                (c) => c.id === event.currentTarget.value
              );

              if (picked) {
                sendToAddress = picked.address;
                isRecipientChecked = true;
              }

              event.currentTarget.value = "";
            }}
          >
            <option value="">Choose a contact…</option>
            {#each contacts as option (option.id)}
              <option value={option.id}
                >{option.name} · {option.movedTo === undefined
                  ? (option.duskName ?? shortenAddress(option.address))
                  : shortenAddress(option.address)}</option
              >
            {/each}
          </select>
        {/if}

        {#if isRecipientInvalid}
          <p class="send__error" id={invalidRecipientId} role="alert">
            <strong>Not a valid address.</strong> Check it, or paste it again.
          </p>
          {#if bareName}
            <button
              class="send__link"
              on:click={() => {
                sendToAddress = bareName ?? sendToAddress;
              }}
              type="button">Did you mean {bareName}?</button
            >
          {/if}
        {/if}

        {#if nameLookup?.error}
          {@const [title, text] = nameErrors[nameLookup.error](nameLookup.name)}
          <div class="send__error" role="alert">
            <p><strong>{title}.</strong> {text}</p>
            {#if suggestion}
              <button
                class="send__link"
                on:click={() => {
                  sendToAddress = suggestion ?? sendToAddress;
                }}
                type="button">Did you mean {suggestion}?</button
              >
            {/if}
            {#if nameLookup.error === "lookup-failed"}
              <Button
                on:click={() => lookUpName(recipientName)}
                size="small"
                text="Try again"
                variant="secondary"
              />
            {/if}
          </div>
        {:else if recipientName && nameLookup && !nameLookup[nameAddressType]}
          <p class="send__hint">Looking up {nameLookup.name}…</p>
        {/if}

        {#if isContactMoved && contact}
          <div class="send__warning" role="alert">
            <p>
              {#if namePointsTo}
                <strong
                  >{shownName} now points to a different address from the one saved
                  for {contact.name}.</strong
                >
                Which do you want to send to?
              {:else}
                <strong
                  >{shownName} no longer points to the kind of address saved for
                  {contact.name}.</strong
                >
              {/if}
            </p>
            <div class="send__choices">
              <Button
                on:click={() => {
                  sendToAddress = contact?.address ?? sendToAddress;
                }}
                text="The saved address"
                variant="secondary"
              />
              {#if namePointsTo}
                <Button
                  on:click={() => {
                    newAddressTaken = {
                      ...newAddressTaken,
                      [recipientName.toLowerCase()]: recipientAddress,
                    };
                  }}
                  text="The new address"
                  variant="secondary"
                />
              {/if}
            </div>
          </div>
        {/if}

        {#if contact?.duskName && !recipientName && contact.movedTo !== undefined}
          <p class="send__hint" role="status">
            {contact.duskName} now points to a different address. You're sending to
            the address saved for {contact.name}.
          </p>
        {/if}

        {#if addressInfo.isValid && !isContactMoved}
          {@const isChoice = recipientName !== "" && nameOptions.length > 1}
          <div class="send__card">
            <p class="send__card-title" id="{id}-points">
              {#if contact}
                {contact.name}{recipientName ? ` · ${shownName}` : ""}
              {:else if own && !recipientName}
                Your {own.label}
              {:else if recipientName}
                {shownName} points to {isChoice
                  ? "two addresses"
                  : isShielded
                    ? "a shielded address"
                    : "a public account"}
              {:else}
                {isShielded ? "A shielded address" : "A public account"}
              {/if}
            </p>

            {#if isChoice}
              <!-- Radios only when there is a choice. -->
              <div
                aria-labelledby="{id}-points"
                class="send__name-options"
                role="radiogroup"
              >
                {#each nameOptions as option (option.type)}
                  {@const optionId = `${id}-${option.type}`}
                  {@const isPicked = option.type === nameAddressType}
                  <div
                    class="send__name-option"
                    class:send__name-option--disabled={option.disabled}
                    class:send__name-option--picked={isPicked}
                  >
                    <div
                      aria-checked={isPicked}
                      aria-describedby={option.disabled
                        ? `${optionId}-hint ${optionId}-address`
                        : `${optionId}-text ${optionId}-address`}
                      aria-disabled={option.disabled}
                      aria-labelledby="{optionId}-title"
                      bind:this={nameOptionElements[option.type]}
                      class="send__name-option-body"
                      on:click={() => pickNameAddress(option.type)}
                      on:keydown={(event) =>
                        handleNameOptionKeyDown(event, option.type)}
                      role="radio"
                      tabindex={isPicked ? 0 : -1}
                    >
                      <span class="send__name-option-mark"></span>
                      <span class="send__name-option-text">
                        <strong id="{optionId}-title">{option.title}</strong>
                        <samp id="{optionId}-address" title={option.address}
                          ><span aria-hidden="true"
                            >{shortenAddress(option.address)}</span
                          ><span class="sr-only">{option.address}</span></samp
                        >
                        {#if !option.disabled}
                          <span id="{optionId}-text">{option.visibility}</span>
                        {/if}
                      </span>
                    </div>
                    {#if option.disabled}
                      <p class="send__name-hint" id="{optionId}-hint">
                        Not enough shielded DUSK ·
                        {#if canShield}
                          <AppAnchor
                            className="text-link"
                            href="/dashboard/allocate">Shield first</AppAnchor
                          >
                        {:else}
                          Shield first
                        {/if}
                      </p>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <p class="send__card-address">
              <FullAddress address={recipientAddress} />
            </p>
            {#if isNameUnpayable}
              <p class="send__name-hint">
                Not enough shielded DUSK ·
                {#if canShield}
                  <AppAnchor className="text-link" href="/dashboard/allocate"
                    >Shield first</AppAnchor
                  >
                {:else}
                  Shield first
                {/if}
              </p>
            {/if}

            <div class="send__card-footer">
              <p class="send__privacy">
                {#if isShielded}
                  Shielded: not shown on the public chain. The person you pay
                  sees what you send them.
                {:else}
                  Public: the amount and both accounts are visible on chain.
                {/if}
              </p>
              {#if !contact && !own && !isSavingContact}
                <Button
                  on:click={() => {
                    isSavingContact = true;
                  }}
                  size="small"
                  text="Save to contacts"
                  variant="tertiary"
                />
              {/if}
            </div>

            {#if isSavingContact}
              <form class="send__save" on:submit|preventDefault={saveRecipient}>
                <label class="send__label" for="{id}-contact-name"
                  >Contact name</label
                >
                <div class="send__save-row">
                  <Textbox
                    bind:value={contactName}
                    id="{id}-contact-name"
                    maxlength={40}
                    type="text"
                  />
                  <Button
                    on:click={() => {
                      isSavingContact = false;
                    }}
                    text="Cancel"
                    variant="secondary"
                  />
                  <Button
                    disabled={!contactName.trim()}
                    text="Save"
                    type="submit"
                    variant="primary"
                  />
                </div>
                <p class="send__hint">Saved only on this device.</p>
              </form>
            {/if}
          </div>
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

      <div class="send__field">
        <label class="send__label" for="{id}-amount">Amount</label>
        <div class="send__amount">
          <Textbox
            aria-describedby="{id}-amount-error"
            aria-invalid={amountError ? "true" : undefined}
            autocomplete="off"
            bind:value={sendAmount}
            className="send__amount-input"
            id="{id}-amount"
            inputmode="decimal"
            placeholder="0"
            required
            type="text"
          />
          <span aria-hidden="true" class="send__unit">DUSK</span>
          <Button
            on:click={setMaxAmount}
            size="small"
            text="Max"
            variant="secondary"
          />
        </div>
        <p class="send__hint">
          Available <BalanceValue
            exact={formatDuskExact(availableBalance, language)}
            value={formatDusk(availableBalance, language)}
          /> DUSK from your {isShielded ? "shielded" : "public"} balance
        </p>
        {#if !isBalanceSufficientForGas}
          <p class="send__error" role="alert">
            <strong>Not enough for the network fee.</strong> Add funds or lower the
            gas limit.
          </p>
        {:else if amountError}
          <p class="send__error" id="{id}-amount-error" role="alert">
            {amountError}
          </p>
        {/if}
      </div>

      <div class="send__field">
        <label class="send__label" for="{id}-memo"
          >Memo{isSendingToBep20Bridge ? "" : " (optional)"}</label
        >
        <Textbox
          bind:value={memo}
          className={makeClassName({
            "send__memo-input": true,
            "send__memo-input--invalid": isMemoValid === false,
          })}
          id="{id}-memo"
          type="multiline"
        />
        {#if isMemoValid === false}
          <p class="send__error" role="alert">
            <strong>Not an EVM address.</strong> EVM addresses are 40 hexadecimal
            characters, optionally prefixed with "0x".
          </p>
        {:else if isSendingToBep20Bridge && memo.trim() === ""}
          <p class="send__error" role="alert">
            <strong>Enter the EVM address that receives the tokens.</strong>
          </p>
        {:else}
          <p class="send__hint">
            Visible on chain, for good: don't put personal details in it.
          </p>
        {/if}
      </div>
    </section>

    <aside aria-labelledby="{id}-summary" class="send__summary">
      <SectionHead id="{id}-summary">Summary</SectionHead>
      <dl class="send__rows">
        <div>
          <dt>From</dt>
          <dd>
            <span class="send__summary-name">{fromLabel}</span>
            {#if !isShielded && from}
              <span class="send__summary-code">{shortenAddress(from)}</span>
            {/if}
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>
            {#if !addressInfo.isValid}
              <span class="send__muted">Not set</span>
            {:else}
              {#if contact || recipientName}
                <span class="send__summary-name"
                  >{contact?.name ?? shownName}</span
                >
              {/if}
              <span class="send__summary-code"
                >{shortenAddress(recipientAddress)}</span
              >
            {/if}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{amountText} DUSK</dd>
        </div>
        {#if transactionMemo}
          <div>
            <dt>Memo</dt>
            <dd class="send__summary-memo">{transactionMemo}</dd>
          </div>
        {/if}
      </dl>
      {#if addressInfo.isValid && !isShielded}
        <p class="send__visible">
          {transactionMemo
            ? "Visible to everyone: the amount, both accounts and the memo."
            : "Visible to everyone: the amount and both accounts."}
        </p>
      {/if}
      <GasSettings
        fee={maxGasFee}
        limit={gasLimit}
        limitLower={gasLimits.gasLimitLower}
        limitUpper={gasLimits.gasLimitUpper}
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
        price={gasPrice}
        priceLower={gasLimits.gasPriceLower}
      />
      <dl class="send__rows send__rows--total">
        <div>
          <dt>Total</dt>
          <dd>
            Up to {formatTotal(totalAmount, availableBalance, language)} DUSK
          </dd>
        </div>
      </dl>
      <Button
        className="send__send"
        disabled={!canSend}
        on:click={send}
        text={sendAmountInLux > 0n ? `Send ${amountText} DUSK` : "Send"}
        variant="primary"
      />
      <p class="send__final">Sends can't be undone.</p>
      {#if step === "review"}
        <Button
          className="send__back"
          icon={{ path: mdiArrowLeft }}
          on:click={() => {
            step = "form";
          }}
          text="Back"
          variant="secondary"
        />
      {/if}
    </aside>

    <!-- Phones review before they send: the summary takes the page. -->
    {#if step === "form"}
      <div class="send__phone-bar">
        <Button
          className="send__review"
          disabled={!canSend}
          on:click={() => {
            step = "review";
            window.scrollTo(0, 0);
          }}
          text="Review"
          variant="primary"
        />
      </div>
    {/if}
  </div>
{/if}

<style lang="postcss">
  .send {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    align-items: start;
    gap: 2.5rem;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 2.25rem 3rem 3rem;
  }

  .send__form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
  }

  .send__back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.375rem;
    min-height: 44px;
    margin-bottom: -1rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
    text-decoration: none;

    &:hover {
      color: var(--calm-text);
    }

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
    }
  }

  .send__title {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .send__field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .send__label {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .send__to {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;

    & :global(.send__to-input) {
      flex: 1;
      min-width: 0;
      height: 3.25rem;
      font-size: 1rem;
    }
  }

  :global(.dusk-textbox.send__to-input--invalid) {
    color: var(--calm-danger);
  }

  :global(.dusk-textbox.send__to-input--blocked) {
    color: var(--calm-danger);
    border-color: var(--calm-danger);
  }

  .send__verified {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.5rem;
    color: var(--calm-text);
    font-size: 0.8125rem;
    white-space: nowrap;

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
      color: var(--calm-online);
    }
  }

  .send__icon-button {
    all: unset;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--calm-muted);
    cursor: pointer;

    &:hover {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .send__contacts {
    align-self: flex-start;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border: 0 none;
    border-radius: 0.625rem;
    background-color: var(--calm-s1);
    color: var(--calm-text);
    font-size: 0.875rem;
  }

  .send__card {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 1rem 1.125rem;
    border-radius: 0.875rem;
    background: var(--calm-s1);
    font-size: 0.875rem;
  }

  .send__card-title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .send__card-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .send__privacy {
    color: var(--calm-text);
  }

  .send__save {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .send__save-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;

    & > :global(input) {
      flex: 1 1 10rem;
    }
  }

  .send__name-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .send__name-option {
    border: 1px solid var(--calm-line2);
    border-radius: 0.75rem;

    &:focus-within {
      box-shadow: 0 0 0 2px var(--calm-focus);
    }
  }

  .send__name-option--picked {
    border-color: var(--calm-text);
  }

  .send__name-option-body {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    outline: none;
    cursor: pointer;
  }

  .send__name-option--disabled .send__name-option-body {
    opacity: 0.5;
    padding-bottom: 0;
    cursor: not-allowed;
  }

  .send__name-option-mark {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    margin-top: 0.2rem;
    border: 0.125rem solid var(--calm-muted);
    border-radius: 50%;
  }

  .send__name-option--picked .send__name-option-mark {
    border-color: var(--calm-text);
    background: var(--calm-text);
    box-shadow: inset 0 0 0 0.15rem var(--calm-s1);
  }

  .send__name-option-text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;

    & samp {
      color: var(--calm-muted);
      font-family: var(--code-font-family);
      font-size: 0.75rem;
    }
  }

  .send__name-hint {
    padding: 0.25rem 1rem 0.75rem 2.75rem;
    font-size: 0.875rem;
  }

  .send__amount {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    & :global(.send__amount-input) {
      flex: 1;
      min-width: 0;
      height: 3.25rem;
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
    }
  }

  .send__unit {
    color: var(--calm-muted);
  }

  :global(.dusk-textbox.send__memo-input) {
    resize: vertical;
    min-height: 3.25rem;
    max-height: 10em;
  }

  :global(.dusk-textbox.send__memo-input--invalid) {
    border-color: var(--calm-danger);
  }

  .send__hint {
    color: var(--calm-muted);
    font-size: 0.84375rem;
  }

  .send__error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    color: var(--calm-danger);
    font-size: 0.875rem;

    & p {
      color: var(--calm-text);
    }

    & strong {
      color: var(--calm-danger);
    }
  }

  .send__warning {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--calm-pending);
    border-radius: 0.875rem;
    font-size: 0.875rem;
  }

  .send__choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .send__link {
    all: unset;
    color: var(--calm-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .send__summary {
    position: sticky;
    top: calc(var(--header-height, 0px) + 1.5rem);
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.5rem;
    border-radius: 1rem;
    background: var(--calm-s1);
  }

  .send__rows {
    display: flex;
    flex-direction: column;
    margin: 0;

    & > div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.625rem 0;
      border-top: 1px solid var(--calm-line);
      font-size: 0.875rem;
    }

    & dt {
      color: var(--calm-muted);
    }

    & dd {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      margin: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
      min-width: 0;
    }
  }

  .send__rows--total dd {
    font-weight: 500;
  }

  .send__summary-name {
    overflow-wrap: anywhere;
  }

  .send__summary-code {
    color: var(--calm-muted);
    font-family: var(--code-font-family);
    font-size: 0.75rem;
  }

  .send__summary-memo {
    overflow-wrap: anywhere;
  }

  .send__muted {
    color: var(--calm-muted);
  }

  .send__final {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    text-align: center;
  }

  .send__visible {
    margin-top: -0.875rem;
    padding-top: 0.625rem;
    border-top: 1px solid var(--calm-line);
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .send__summary :global(.send__send),
  .send__summary :global(.send__back) {
    width: 100%;
  }

  .send__phone-bar {
    display: none;
  }

  /* Phones: the form, then a review of it before it is sent. */
  @media (max-width: 63.99rem) {
    .send {
      padding: 1.75rem 1.5rem 2rem;
    }
  }

  @media (max-width: 47.99rem) {
    .send {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
      padding: 1rem 1rem 0;
    }

    .send__summary {
      position: static;
      display: none;
    }

    .send--review .send__form {
      display: none;
    }

    .send--review .send__summary {
      display: flex;
    }

    .send__phone-bar {
      position: sticky;
      bottom: var(--keyboard-inset, 0px);
      z-index: 3;
      display: block;
      padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom));
      background: var(--calm-s0);
      box-shadow: 0 -1px 0 var(--calm-line);

      & :global(.send__review) {
        width: 100%;
      }
    }
  }
</style>
