<svelte:options immutable={true} />

<script>
  import { amountForField, readAmount } from "@dusk-network/app-core/amounts";
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiCheckCircleOutline,
    mdiQrcodeScan,
  } from "@mdi/js";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    NAME_SAVE_YES,
    lookAlikes,
    sameName,
  } from "@dusk-network/app-core/names";
  import {
    contactNameProblem,
    contactNameText,
    contactsStore,
    markContactNameChecked,
    markContactNameMoved,
    passesForDuskName,
    saveContact,
  } from "$lib/contacts";
  import {
    asDuskName,
    closeDuskName,
    isDuskName,
  } from "@duskdomains/sdk/names";
  import { page } from "$app/stores";
  import { BALANCE_MASK, withoutBalanceMask } from "$lib/constants";
  import {
    addBasePath,
    formDraft,
    gasToKeep,
    keptGas,
    pageTitle,
    reviewStep,
  } from "$lib/navigation";
  import { sentAlready } from "@dusk-network/app-core/requests";
  import {
    forgetSameUnsent,
    keepWaiting,
    sendGate,
    takeUnsentRefill,
    unsentRefill,
    waitingSends,
    waitingText,
  } from "$lib/transactions";
  import { onTheirWay } from "$lib/activity/sends";
  import { paidInSentence } from "$lib/activity/present";
  import { getAddressInfo } from "$lib/wallet";
  import { readPaymentLink } from "$lib/payment-requests";
  import { getBlocklistedRecipient } from "$lib/security/addressBlocklist";
  import { networkStore, settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import {
    openWalletName,
    profilesHere,
    walletAccountNames,
  } from "$lib/wallets";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatFee,
    formatTotal,
  } from "$lib/dusk/currency";
  import {
    amountProblem,
    readDuskInput,
  } from "$lib/components/Stake/stakeAmount";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import {
    isValidEvmAddress,
    makeClassName,
    randomUUID,
    shortenAddress,
  } from "$lib/dusk/string";
  import { AnchorButton, Button, Icon, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    AmountInCurrency,
    AmountQuestion,
    AppAnchor,
    BalanceValue,
    Banner,
    FieldLimit,
    FullAddress,
    GasSettings,
    MemoText,
    ScanQR,
    SectionHead,
    TransactionResult,
    UnsentSends,
  } from "$lib/components";

  /** @type {(to: string, amount: bigint, memo: string, gasPrice: bigint, gasLimit: bigint, toName?: string, gate?: import("$lib/transactions/sendGate").SendGate) => Promise<string>} */
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
   * The spendable balance the transfer is paid from, less what the sends
   * waiting to go out from it take (`waiting`).
   *
   * @type {bigint}
   */
  export let availableBalance;

  /**
   * What the sends waiting to go out from the balance that pays take of it,
   * at most: Available and Max count it out.
   */
  export let waiting = 0n;

  /**
   * Whether the balances were read from the network since the wallet or the
   * profile opened: nothing is said against one that wasn't yet.
   */
  export let balanceKnown = true;

  /**
   * The spendable shielded balance, which pays transfers to shielded addresses.
   *
   * @type {bigint}
   */
  export let shieldedBalance;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /**
   * What the public balance has to keep for what the wallet holds elsewhere,
   * which Max leaves in it (`$lib/wallet-reserve`).
   *
   * @type {import("$lib/wallet-reserve").FeeToKeep}
   */
  export let keepForLater = { lux: 0n, why: "" };

  /** @type {string} */
  export let shieldedAddress;

  /** @type {string} */
  export let publicAddress;

  /** @type {undefined | string} */
  export let bep20BridgeAddress = undefined;

  /** The recipient the page starts with, as from Send again or a link. */
  export let initialRecipient = "";

  /** The amount a link opened the page with, as the amount field reads it. */
  export let initialAmount = "";

  /** The memo a link opened the page with. */
  export let initialMemo = "";

  /** Why the link the page was opened with fills in nothing. */
  export let initialProblem = "";

  /**
   * The web wallet of the network the link the page was opened with is for,
   * where it's another network's, with the same request.
   *
   * @type {{ href: string, network: string } | null}
   */
  export let initialElsewhere = null;

  /**
   * Whether the amount the page was opened with is the wallet's own, as a
   * payment that came in sent back: it's hidden with the balances, as Max's.
   */
  export let initialAmountHidden = false;

  /** Whether the page was opened to send a payment back, filled in from it. */
  export let isSendBack = false;

  /**
   * `.dusk` names of past counterparties, for "Did you mean …?" along with
   * the contacts' names.
   *
   * @type {string[]}
   */
  export let knownNames = [];

  /**
   * The profile's history, newest first: what it sent that's on its way, and
   * a payment the one typed would make again.
   *
   * @type {ActivityRow[]}
   */
  export let historyRows = [];

  const draft = formDraft("send");

  /** What the page was opened for, to tell another link from this one. */
  const openedFor = initialRecipient
    ? [initialRecipient, initialAmount, initialMemo].join("\n")
    : "";

  /**
   * What a send that never went out held in the form, as the form takes it
   * again: what it showed, where the form's own wasn't kept.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend} send
   */
  const typedOf = ({ lux, memo, to, typed }) => ({
    amount:
      typeof typed.amount === "string"
        ? typed.amount
        : amountForField(
            formatDuskPlain(BigInt(lux)),
            getDecimalSeparator($settingsStore.language)
          ),
    gas: /** @type {{ limit: string, price: string } | undefined} */ (
      typed.gas
    ),
    isMax: typed.isMax === true,
    isOwn: typed.isOwn === true,
    memo: typeof typed.memo === "string" ? typed.memo : memo,
    picks: /** @type {Record<string, "account" | "address">} */ (
      typed.picks && typeof typed.picks === "object" ? typed.picks : {}
    ),
    to: typeof typed.to === "string" ? typed.to : to,
  });

  /** Whether a lock, a reload or a failed send kept what was typed. */
  const draftBefore = draft.read();

  /**
   * A send that never went out, to fill the form in with again where that's
   * asked, for the profile it's sent from: in place of what was typed.
   */
  const refilled = takeUnsentRefill({
    account: publicAddress,
    network: $networkStore.networkName,
  });

  /**
   * What was typed before a lock, a reload or a failed send, unless a link to
   * someone else, or for something else, opens the page now. A link refused is
   * one too: what it opens on is no transfer of anyone's asking. A send that
   * never went out, asked to be sent again, comes first.
   *
   * @type {any}
   */
  const typedBefore = refilled
    ? typedOf(refilled)
    : ((before) =>
        before &&
        !initialProblem &&
        (!initialRecipient || before.link === openedFor)
          ? before
          : null)(draftBefore);

  /** The amount as typed, in DUSK: nothing until it is. */
  let sendAmount = typedBefore?.amount ?? initialAmount;

  /** Whether Max filled the amount in: it's hidden with the balances. */
  let isMaxAmount = typedBefore?.isMax ?? false;

  /** Whether the amount is the wallet's own otherwise: hidden as Max's is. */
  let isOwnAmount = typedBefore?.isOwn ?? initialAmountHidden;

  /** @type {string} */
  let sendToAddress = typedBefore?.to ?? initialRecipient;

  /** @type {string} */
  let memo = typedBefore?.memo ?? initialMemo;

  /** Why the last link given fills in nothing: another network's, or unreadable. */
  let linkProblem = initialProblem;

  /** Where the last link given can be paid, as another network's. */
  let linkElsewhere = initialElsewhere;

  /** Whether a link filled the form in, until what's in To changes. */
  let isFromLink = Boolean(
    !typedBefore && initialRecipient && (initialAmount || initialMemo)
  );

  /** The recipient that link gave, or the send that never went out. */
  let linkRecipient = refilled ? typedBefore.to : initialRecipient;

  /**
   * Whether the form was filled in with a send that never went out, until
   * what's in To changes.
   */
  let isRefilled = Boolean(refilled);

  /**
   * The send that never went out the form was filled in with: sent from
   * here, it takes its place. Null for none.
   *
   * @type {import("$lib/transactions/unsentSends").UnsentSend | null}
   */
  let refill = refilled;

  /**
   * Whether the review shows as soon as the form can be sent, as it holds a
   * send that never went out, asked to be sent now: not once anything's
   * typed.
   */
  let reviewWhenReady = Boolean(refilled);

  /** Whether the page shows still: its screen says how a send ended. */
  let isShown = true;

  /** @type {import("qr-scanner").default} */
  let scanner;

  /** Whether there's a camera to scan with: else a code is read from an image. */
  let hasCamera = false;

  /** @type {import("..").ScanQR} */
  let scanQrComponent;

  /**
   * Where the transfer is: the form, its review, or sent.
   *
   * @type {"done" | "form" | "review"}
   */
  let step = "form";

  /**
   * The transfer once sent, the most it can cost, and what calls it off
   * until it goes out.
   *
   * @type {{ gate: import("$lib/transactions/sendGate").SendGate, maxFee: bigint, memo: string, operation: Promise<string>, what: string } | null}
   */
  let sent = null;

  /** Whether the transfer failed with nothing sent: it can be tried again. */
  let canTryAgain = false;

  /**
   * Whether a recipient that isn't valid is pointed out: once it is pasted,
   * left or confirmed with Enter, not while it is being typed.
   *
   * @type {boolean}
   */
  let isRecipientChecked = Boolean(typedBefore?.to || initialRecipient);

  /** @type {boolean} */
  let isGasValid = false;

  /** @type {boolean} */
  let isMemoValid = true;

  /** @type {DuskNameResolution | null} */
  let nameLookup = null;

  /**
   * The name asked last, as an object for each time it's asked: an answer
   * counts for that ask alone, so an old one can't come back, or overwrite a
   * newer one, when the same name is entered again.
   *
   * @type {{ name: string } | null}
   */
  let nameAsk = null;

  /**
   * The answer to an ask.
   *
   * @type {{ ask: { name: string }, result: DuskNameResolution } | null}
   */
  let nameAnswer = null;

  /**
   * The address the user picked for each `.dusk` name with both a public
   * account and a shielded address. A pick stays with its name, through
   * lookups of the same name, until the user makes another; any other name
   * starts at its public account.
   *
   * @type {Record<string, "account" | "address">}
   */
  let namePicks = typedBefore?.picks ?? {};

  /**
   * Names the user chose to send to although a contact keeps another
   * address for them, with the address chosen.
   *
   * @type {Record<string, string>}
   */
  let newAddressTaken = {};

  /** The lookup last noted on the contacts of its name. */
  /** @type {DuskNameResolution | null} */
  let checkedLookup = null;

  /** The contact whose `.dusk` name was last checked as its address was picked. */
  let savedNameChecked = "";

  /**
   * Whether a lookup has said where its name points: not while it runs, nor
   * when it found no address.
   *
   * @param {DuskNameResolution | null} lookup
   * @returns {lookup is DuskNameResolution}
   */
  const hasPointed = (lookup) =>
    Boolean(lookup && !lookup.error && (lookup.account || lookup.address));

  /**
   * The address a lookup says a contact's name points to now, of the kind
   * the contact keeps: "" for none of that kind.
   *
   * @param {DuskNameResolution} lookup
   * @param {Contact} saved
   */
  const pointedTo = (lookup, saved) =>
    (saved.type === "address" ? lookup.address : lookup.account) ?? "";

  /**
   * Notes on a contact what a lookup of its `.dusk` name found: still its
   * address, or moved.
   *
   * @param {Contact} saved
   * @param {string} pointsTo
   */
  function noteName(saved, pointsTo) {
    if (pointsTo === saved.address) {
      markContactNameChecked(saved);
    } else {
      markContactNameMoved(saved, pointsTo);
    }
  }

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

    noteName(saved, pointedTo(resolution, saved));
  }

  /**
   * What is wrong with the amount typed, in the words the page shows: ""
   * for nothing typed yet, or an amount that can go. Nothing is said against
   * a balance not read yet.
   *
   * @param {string} text
   * @param {bigint | null} amount
   * @param {{ available: bigint, hidden: boolean, known: boolean, locale: string, maxSpendable: bigint }} balance
   */
  function amountErrorOf(
    text,
    amount,
    { available, hidden, known, locale, maxSpendable }
  ) {
    if (!text.trim()) {
      return "";
    }

    if (amount === null) {
      return amountProblem(text, locale);
    }

    if (amount === 0n) {
      return "Enter an amount greater than 0.";
    }

    if (!known) {
      return "";
    }

    // With balances hidden, these don't say what's held.
    if (amount > available) {
      return hidden
        ? "More than you have."
        : `More than your ${formatDuskExact(available, locale)} DUSK.`;
    }

    if (amount <= maxSpendable) {
      return "";
    }

    return hidden
      ? "That leaves too little for the network fee."
      : `That leaves too little for the network fee: send up to ${formatDuskExact(maxSpendable, locale)} DUSK.`;
  }

  /** Whether the recipient is being saved to the contacts, and as what. */
  let isSavingContact = false;
  let contactName = "";
  // The recipient a contact's name is being typed for.
  let savingContactFor = "";

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

  let { gasLimit, gasPrice } = keptGas(typedBefore?.gas, gasSettings);
  let defaultGas = gasSettings;

  /** The least a transfer sends: one LUX. */
  const minAmount = 1n;

  const dispatch = createEventDispatcher();
  const reviewHistory = reviewStep("sendReview");

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  onDestroy(() => {
    isShown = false;
  });

  /**
   * Fills the form in with a send that never went out, as asked while the
   * form shows, in place of what's typed: to be reviewed as if typed.
   *
   * @param {import("$lib/transactions/unsentSends").UnsentSend | null} send
   */
  function fillIn(send) {
    if (!send) {
      return;
    }

    const typed = typedOf(send);

    linkProblem = "";
    linkElsewhere = null;
    isFromLink = false;
    isRefilled = true;
    refill = send;
    reviewWhenReady = true;
    sendToAddress = typed.to;
    linkRecipient = typed.to;
    isRecipientChecked = Boolean(typed.to);
    typedLength = typed.to.length;
    sendAmount = typed.amount;
    isMaxAmount = typed.isMax;
    isOwnAmount = typed.isOwn;
    memo = typed.memo;
    namePicks = typed.picks;
    ({ gasLimit, gasPrice } = keptGas(typed.gas, gasSettings));
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

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

    sendAmount = amountForField(
      formatDuskPlain(maxKeeping),
      getDecimalSeparator(language)
    );
    isMaxAmount = true;
  }

  /** @param {Event} event */
  function typeAmount(event) {
    sendAmount = withoutBalanceMask(
      /** @type {HTMLInputElement} */ (event.currentTarget).value
    );
    isMaxAmount = false;
    isOwnAmount = false;
  }

  /** How long the recipient typed was, to tell a paste from a key. */
  let typedLength = 0;

  /** Whether the browser said a paste is coming, over a longer recipient too. */
  let isPasting = false;

  /**
   * What's put in To whole, as pasted, scanned or finished: a link asking for
   * a payment fills in what it asks, and one refused, as for another network,
   * says why and empties the form, so nothing in it reads as the refused
   * link's. Anything else is a recipient as it is, leaving what's typed in
   * the other fields. What's filled in is checked as if it were typed.
   *
   * @param {string} text
   */
  async function takeRecipient(text) {
    const asked = readPaymentLink(text, $nodeNetwork, language);

    // The field holds what was given until now: what takes its place, or
    // nothing, then shows, whatever it held before.
    await tick();

    linkProblem = asked?.problem ?? "";
    linkElsewhere = asked?.elsewhere ?? null;
    sendToAddress = asked ? asked.to : text;
    linkRecipient = sendToAddress;
    isFromLink = Boolean(asked?.amount || asked?.memo);
    isRecipientChecked = Boolean(sendToAddress);
    typedLength = sendToAddress.length;

    if (asked) {
      isMaxAmount = false;
      isOwnAmount = false;
      sendAmount = asked.amount;
      memo = asked.memo;
    }
  }

  /**
   * Much more at once than a key gives is a paste, however a phone's keyboard
   * does it: what's wrong with it is said at once, and a link is read.
   *
   * @param {Event} event
   */
  function handleRecipientInput({ target }) {
    const { value } = /** @type {HTMLInputElement} */ (target);

    if (isPasting || value.length - typedLength > 1) {
      isPasting = false;
      takeRecipient(value);
    } else {
      linkProblem = "";
      isFromLink = false;
      typedLength = value.length;
    }
  }

  /**
   * What's wrong with a code scanned, said where it's scanned: "" for a
   * payment link, a Dusk address or a `.dusk` name, which goes in To.
   *
   * @param {string} text
   */
  function scannedProblem(text) {
    const code = text.trim();

    return readPaymentLink(code, $nodeNetwork, language) ||
      isDuskName(code) ||
      getAddressInfo(code, shieldedAddress, publicAddress).isValid
      ? ""
      : "That QR isn't a Dusk address or payment link.";
  }

  /** A link typed out reads as it's finished: not at each key on the way. */
  function finishRecipient() {
    if (/^(dusk:|https?:\/\/)/i.test(sendToAddress.trim())) {
      takeRecipient(sendToAddress);
    }

    isRecipientChecked = true;
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
      finishRecipient();

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
    const ask = name ? { name } : null;

    nameAsk = ask;

    if (ask) {
      resolveName(name).then((result) => {
        if (nameAsk === ask) {
          nameAnswer = { ask, result };
        }
      });
    }
  }

  function lookUpNameAgain() {
    nameAnswer = null;
    lookUpName(recipientName);
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
   * The contacts saved with a `.dusk` name.
   *
   * @param {Contact[]} contacts
   * @param {string} name
   */
  const savedWithName = (contacts, name) =>
    name
      ? contacts.filter((contact) => contact.duskName === name.toLowerCase())
      : [];

  /**
   * The contact saved with the `.dusk` name entered, of the kind of address
   * picked of it: the one saved with the address it goes to, else the
   * first. Its address is the one compared with the address the name
   * points to now, whichever contact that address is saved for.
   *
   * @param {Contact[]} contacts
   * @param {string} name
   * @param {string} address
   * @param {"account" | "address"} type The kind of address picked
   * @returns {Contact | null}
   */
  function contactNamed(contacts, name, address, type) {
    const named = savedWithName(contacts, name).filter(
      (contact) => contact.type === type
    );

    return (
      named.find((contact) => address && contact.address === address) ??
      named[0] ??
      null
    );
  }

  /**
   * The contact's name a question about it was asked of at Save: it's saved
   * only as the person says so, and asked again once it's typed again.
   */
  let contactAskedOf = "";

  /**
   * Saves the recipient to the contacts: never one of the wallet's own
   * accounts, nor with a profile's name; with a name that asks a question,
   * only once it's answered (`answered`), with a click or a tap on its Yes:
   * the question never takes the focus, so Enter in the name, again, asks
   * it again and saves nothing.
   *
   * @param {boolean} [answered]
   */
  function saveRecipient(answered = false) {
    const name = contactName.trim();

    if (!name || own || isFalseContactName || contactNameIssue?.refused) {
      return;
    }

    if (contactNameIssue && !answered) {
      contactAskedOf = contactName;

      return;
    }

    saveContact({
      address: recipientAddress,
      checkedAt: recipientName ? Date.now() : null,
      duskName: recipientName || null,
      name,
    });
    isSavingContact = false;
    contactName = "";
  }

  /**
   * Sends the transfer, with the `.dusk` name it goes to, as the lookup
   * gives it, for the history.
   */
  function send() {
    const toName = recipientName ? nameLookup?.name : undefined;
    const gate = sendGate();
    const what = `${hideBalances ? BALANCE_MASK : amountText} DUSK to ${recipientLabel}`;

    // It goes out now, as far as a reload can tell: nothing brings it back.
    draft.clear();

    const operation = execute(
      recipientAddress,
      sendAmountInLux,
      transactionMemo,
      gasPrice,
      gasLimit,
      toName,
      gate
    );

    // Until it goes out, Home says it waits, wherever the wallet is, its
    // amount as balances are shown there. It's kept on this device
    // meanwhile: where its page closes, reloads or locks before it goes
    // out, it's said once the wallet opens again.
    keepWaiting({
      address: recipientAddress,
      from,
      gate,
      kept: {
        account: publicAddress,
        // Sent from a send that never went out: in its place.
        id: isRefilled && refill ? refill.id : undefined,
        isSaid: () => isShown && sent?.operation === operation,
        network: $networkStore.networkName,
        typed: {
          amount: typed.amount,
          gas: typed.gas,
          isMax: typed.isMax,
          isOwn: typed.isOwn,
          memo: typed.memo,
          picks: typed.picks,
          to: typed.to,
        },
      },
      lux: sendAmountInLux,
      maxFee: maxGasFee,
      memo: transactionMemo,
      operation,
      to: recipientLabel,
    });
    // The same made again: one of it that never went out is said no more.
    forgetSameUnsent({
      account: publicAddress,
      lux: String(sendAmountInLux),
      memo: transactionMemo,
      network: $networkStore.networkName,
      to: recipientAddress,
    });
    sent = {
      gate,
      maxFee: maxGasFee,
      memo: transactionMemo,
      operation,
      what,
    };
    step = "done";
    // From its top, as the review shows: a phone on its side shows little.
    window.scrollTo(0, 0);
    reviewHistory.settle(operation, () => {
      canTryAgain = true;
      draft.keep(typed);
    });
  }

  /**
   * The review, where the summary takes the page and the focus: a step of its
   * own in the history, so that Back returns to the form, with what's filled
   * in.
   */
  async function showReview() {
    reviewHistory.enter();
    step = "review";
    window.scrollTo(0, 0);
    await tick();
    document.getElementById(`${id}-summary`)?.focus();
  }

  function goToReview() {
    if (canSend) {
      showReview();
    }
  }

  /** Back to the review of a transfer that failed with nothing sent. */
  function tryAgain() {
    sent = null;
    canTryAgain = false;
    showReview();
  }

  /**
   * The step where the browser's Back or Forward takes the history: a review
   * only of what can still be sent, and from a transfer that failed with
   * nothing sent, the form, with what's filled in.
   *
   * @param {boolean} isAtReview
   */
  function followHistory(isAtReview) {
    if (step !== "done") {
      step = isAtReview && canSend ? "review" : "form";
    } else if (canTryAgain && !isAtReview) {
      sent = null;
      canTryAgain = false;
      step = "form";
    }
  }

  $: followHistory(Boolean($page.state?.sendReview));

  // What's typed, kept as it's typed, for as long as it hasn't gone out.
  $: typed = {
    amount: sendAmount,
    gas: gasToKeep({ gasLimit, gasPrice }, defaultGas),
    isMax: isMaxAmount,
    isOwn: isOwnAmount,
    link: openedFor,
    memo,
    picks: namePicks,
    to: sendToAddress,
  };
  $: if (step !== "done" && publicAddress !== undefined) {
    draft.save(typed);
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
  $: parsedAmount = readDuskInput(sendAmount, language);
  $: sendAmountInLux = parsedAmount ?? 0n;

  // Calculate the maximum gas fee based on the gas limit and gas price.
  $: maxGasFee = gasLimit * gasPrice;

  // A balance can pay for a transfer if it covers the smallest amount
  // plus the maximum gas fee.
  $: canPayFromShieldedBalance = shieldedBalance >= maxGasFee + minAmount;

  // Check if the available balance is sufficient to cover the max gas fee.
  // This is a prerequisite for any transaction.
  $: isBalanceSufficientForGas = availableBalance >= maxGasFee;
  // Whether the fee's Edit can bring it down to what's there.
  $: canLowerFee =
    !isBalanceSufficientForGas &&
    availableBalance >= gasLimits.gasLimitLower * gasLimits.gasPriceLower;

  // Determine the maximum amount spendable for the transfer.
  // If the available balance is less than the max gas fee, set it to 0n to avoid negative values.
  $: maxSpendableAmount =
    availableBalance >= maxGasFee ? availableBalance - maxGasFee : 0n;

  // Said again as the balance or the fee changes, as an amount filled in
  // before the balance was read is checked against it once it is.
  $: amountError = amountErrorOf(sendAmount, parsedAmount, {
    available: availableBalance,
    hidden: hideBalances,
    known: balanceKnown,
    locale: language,
    maxSpendable: maxSpendableAmount,
  });

  // A shielded send leaves the public balance as it is.
  $: toKeep = isShielded ? 0n : keepForLater.lux;

  // What Max fills in: all of it, less what's kept for later if there's more
  // than that.
  $: maxKeeping =
    maxSpendableAmount > toKeep
      ? maxSpendableAmount - toKeep
      : maxSpendableAmount;

  // Too little left of the public balance for what the wallet holds elsewhere.
  $: leavesTooLittle =
    balanceKnown &&
    toKeep > 0n &&
    sendAmountInLux > 0n &&
    sendAmountInLux <= maxSpendableAmount &&
    sendAmountInLux > maxSpendableAmount - toKeep;

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

  // What the network takes.
  const MAX_MEMO_BYTES = 512;

  /** @param {string} text */
  const bytesOf = (text) => new TextEncoder().encode(text).length;

  /**
   * How many characters of a memo over the limit have to go.
   *
   * @param {string} text
   */
  function charactersOver(text) {
    const characters = Array.from(text);
    let bytes = bytesOf(text);
    let over = 0;

    while (bytes > MAX_MEMO_BYTES) {
      over += 1;
      bytes -= bytesOf(characters[characters.length - over]);
    }

    return over;
  }

  /**
   * An error that appears under the sticky Review stays in view, all of it.
   *
   * @param {HTMLElement} element
   */
  const staysInView = (element) => {
    element.scrollIntoView?.({ block: "nearest" });
  };

  $: memoBytes = bytesOf(transactionMemo);
  $: isMemoTooLong = memoBytes > MAX_MEMO_BYTES;
  // Said in characters, once there aren't many left.
  $: memoRoom = MAX_MEMO_BYTES - memoBytes;

  $: isAmountReady =
    isSendAmountValid &&
    isGasValid &&
    isTotalAmountWithinAvailableBalance &&
    isBalanceSufficientForGas &&
    isMemoValidForBridge &&
    !isMemoTooLong;

  /**
   * What's in To, as it's meant without its spaces and line breaks: an
   * address, a `.dusk` name or a link, which have none. A name typed, as a
   * contact's or a profile's, keeps them.
   *
   * @param {string} text
   */
  function withoutSpaces(text) {
    const joined = text.replace(/\s+/g, "");

    return /[\n\r\t]/.test(text) ||
      /^(dusk:|https?:\/\/)/i.test(joined) ||
      isDuskName(joined) ||
      isValidEvmAddress(joined) ||
      getAddressInfo(joined, shieldedAddress, publicAddress).isValid
      ? joined
      : text;
  }

  // A pasted recipient often brings spaces or line breaks, which no address
  // or name has.
  $: if (/\s/.test(sendToAddress)) {
    sendToAddress = withoutSpaces(sendToAddress);
  }

  $: if (!sendToAddress) {
    isRecipientChecked = false;
  }

  // Another recipient, as a contact picked, is no more the link's doing.
  $: if (sendToAddress) {
    linkProblem = "";
  }

  $: if (!linkProblem) {
    linkElsewhere = null;
  }

  $: if (sendToAddress !== linkRecipient) {
    isFromLink = false;
    isRefilled = false;
  }

  // A send that never went out, asked to be sent now: its review, once the
  // form can send it as it was, to the same address, with the same amount
  // and memo. Anything else stays for the form to say.
  $: if (
    reviewWhenReady &&
    step === "form" &&
    canSend &&
    isRefilled &&
    refill &&
    recipientAddress === refill.to &&
    sendAmountInLux === BigInt(refill.lux) &&
    transactionMemo === refill.memo
  ) {
    reviewWhenReady = false;
    showReview();
  }

  // Asked to be sent again while the form shows: it takes what's typed's
  // place.
  $: if ($unsentRefill && step !== "done") {
    fillIn(
      takeUnsentRefill({
        account: publicAddress,
        network: $networkStore.networkName,
      })
    );
  }

  $: recipientName = isDuskName(sendToAddress) ? sendToAddress.trim() : "";

  // What's known of the name in the field, read from the name itself: with
  // another name typed, the answer for the one before is out at once, so its
  // address can't be sent to. A lookup that set this itself would run too late,
  // after what reads it, as Svelte can't see an assignment inside a function
  // when it orders these statements.
  $: nameLookup = !recipientName
    ? null
    : nameAnswer?.ask === nameAsk && nameAsk?.name === recipientName
      ? nameAnswer.result
      : { name: recipientName };

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

  /**
   * Whether what's typed can mean a name: by its start, with its spaces or
   * without them, or the start of a word in it.
   *
   * @param {string} name
   * @param {string} typed
   */
  function canMean(name, typed) {
    const q = typed.toLowerCase().trim();
    const named = name.toLowerCase();

    return (
      Boolean(q) &&
      (named.startsWith(q) ||
        named.replace(/\s/g, "").startsWith(q.replace(/\s/g, "")) ||
        named.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q)))
    );
  }

  /**
   * A profile of this person's, as Send offers it, by what the wallets here
   * call it: "Your Profile 2" where it goes by its number, "Your profile
   * Savings" by a name.
   *
   * @param {string} name
   */
  const yourProfile = (name) =>
    /^Profile \d/.test(name) ? `Your ${name}` : `Your profile ${name}`;

  $: isNameTyped = sendToAddress && !recipientName && !addressInfo.isValid;

  // The profiles here a typed name can mean, but the one it goes from, and
  // the contacts: offered first, as a .dusk name of the same would be
  // somebody else's.
  $: namedProfiles = isNameTyped
    ? $profilesHere
        .filter(
          ({ address, name }) =>
            address !== publicAddress && canMean(name, sendToAddress)
        )
        .slice(0, 3)
    : [];
  $: namedContacts = isNameTyped
    ? contacts
        .filter((contact) => canMean(contact.name, sendToAddress))
        .slice(0, 3)
    : [];

  // A name typed without .dusk, as "alice": Send offers alice.dusk as it's
  // typed, and looks it up once taken. It isn't a wrong address. A profile's
  // or a contact's name comes first: the guess would be somebody else's.
  $: bareName =
    isNameTyped && !namedProfiles.length && !namedContacts.length
      ? asDuskName(sendToAddress)
      : null;

  // A .dusk name entered that's a profile's name here, once it's found to
  // go to none of the public accounts and shielded addresses of the wallets
  // here, which they all name.
  $: profileNamed =
    recipientName &&
    recipientAddress &&
    !$walletAccountNames.has(recipientAddress)
      ? $profilesHere.find(({ name }) =>
          sameName(name, recipientName.replace(/\.dusk$/i, ""))
        )
      : undefined;

  // Nothing is said of an empty field: Review stays off until there's one.
  $: isRecipientInvalid =
    isRecipientChecked &&
    sendToAddress !== "" &&
    !recipientName &&
    !addressInfo.isValid &&
    !bareName &&
    !namedProfiles.length &&
    !namedContacts.length;

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
  // Who the transfer goes to, as the Done screen says it: a contact whose
  // name looks like another's with its address.
  $: recipientLabel = contact
    ? recipientName
      ? `${contactNameText(contact.name)} (${shownName})`
      : isAlike
        ? `${contactNameText(contact.name)} (${shortenAddress(recipientAddress)})`
        : contactNameText(contact.name)
    : own && !recipientName
      ? ownLabel.replace(/^Your/, "your")
      : recipientName
        ? shownName
        : walletAccount || shortenAddress(recipientAddress);
  $: own = ownAccounts.find(
    (account) => recipientAddress && account.address === recipientAddress
  );
  // "Your Profile 2", where it goes by its number; a name stands on its own.
  $: ownLabel = /^Profile \d/.test(own?.label ?? "")
    ? `Your ${own?.label}`
    : (own?.label ?? "");
  // A profile of a wallet kept here, as the From line names its own: on the
  // card, the To line and the Done screen, after a contact or a `.dusk` name
  // entered.
  $: walletAccount = $walletAccountNames.get(recipientAddress) ?? "";
  $: contacts = $contactsStore;

  // Contacts whose names look like another's, a profile's or a contact's of
  // another address: each shows its address, and says so.
  $: alike = lookAlikes([...$profilesHere, ...contacts]);

  // The contact the `.dusk` name entered is saved for: the name is checked
  // against its address.
  $: nameContact = contactNamed(
    contacts,
    recipientName,
    recipientAddress,
    nameAddressType
  );

  // The contact a transfer goes to: the one saved with the address it goes
  // to, or else with the `.dusk` name entered.
  $: contact =
    contacts.find(
      (saved) => recipientAddress && saved.address === recipientAddress
    ) ?? nameContact;

  // Whether its name looks like another's: said wherever it's named, to the
  // review, as where it's picked.
  $: isAlike = Boolean(contact && alike.has(contact));

  // The address the contact's name points to now, of the kind the contact
  // keeps: null until the lookup has said.
  $: namePointsTo =
    nameContact && hasPointed(nameLookup)
      ? pointedTo(nameLookup, nameContact)
      : null;

  // A contact's name that points elsewhere now, to another contact's
  // address too: Send asks before it uses the new address.
  $: isContactMoved =
    namePointsTo !== null &&
    namePointsTo !== nameContact?.address &&
    newAddressTaken[recipientName.toLowerCase()] !== recipientAddress;

  // A contact's saved address, entered or picked: its name is checked.
  $: if (contact && !recipientName && addressInfo.isValid) {
    checkSavedName(contact);
  }

  // What a lookup of the name entered found, once it has: noted on each
  // contact saved with the name, still its address or moved, once a lookup.
  $: if (hasPointed(nameLookup) && nameLookup !== checkedLookup) {
    checkedLookup = nameLookup;

    for (const saved of savedWithName(contacts, recipientName)) {
      noteName(saved, pointedTo(nameLookup, saved));
    }
  }

  // One of the wallet's own accounts is never saved as a contact.
  $: if (own && isSavingContact) {
    isSavingContact = false;
    contactName = "";
  }

  // A name typed for one recipient isn't for the next.
  $: if (isSavingContact && recipientAddress !== savingContactFor) {
    isSavingContact = false;
    contactName = "";
  }

  $: isFalseContactName = passesForDuskName(contactName, recipientName);
  $: contactNameIssue = contactNameProblem(
    contactName,
    $profilesHere,
    undefined,
    recipientAddress
  );
  $: if (contactAskedOf && contactAskedOf !== contactName) {
    contactAskedOf = "";
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
      : isRecipientInvalid,
  });

  // A name as the lookup gives it, once it has: in its canonical form.
  $: shownName = nameLookup?.name ?? recipientName;

  /**
   * Who an account is to this wallet: a contact, one of its profiles or of
   * another wallet's here, the name it was sent to, or its short address.
   *
   * @param {string} address
   * @param {string | null} toName
   * @param {{ contacts: Contact[], ownAccounts: { address: string, label: string }[], walletNames: Map<string, string> }} known
   */
  function nameOf(address, toName, known) {
    const saved = known.contacts.find((c) => c.address === address);

    return saved
      ? contactNameText(saved.name)
      : (known.ownAccounts.find((account) => account.address === address)
          ?.label ??
          known.walletNames.get(address) ??
          toName ??
          shortenAddress(address));
  }

  /**
   * The same payment, made already, in a sentence: when a block took it, to
   * the second, as the request it paid and its Sent screen say it, or that
   * it's on its way: its time is a block's, once one has it.
   *
   * @param {ActivityRow} row
   * @param {Parameters<typeof paymentOf>[1]} known
   */
  const sentBefore = (row, known) =>
    `You sent ${paymentOf(row, known)}${row.memo?.trim() ? " with this memo" : ""}${
      row.status === "executed" && row.time !== null
        ? ` ${paidInSentence(row.time, known.locale)}.`
        : ". It's on its way."
    }`;

  /**
   * A payment sent, in a line: "0.01 DUSK to Profile 2", nothing of the
   * amount with the balances hidden.
   *
   * @param {ActivityRow} row
   * @param {{ contacts: Contact[], hidden: boolean, locale: string, ownAccounts: { address: string, label: string }[], walletNames: Map<string, string> }} known
   */
  const paymentOf = (row, known) =>
    `${known.hidden ? BALANCE_MASK : formatDuskExact(row.value, known.locale)} DUSK to ${nameOf(
      row.counterparty ?? "",
      row.toName,
      known
    )}`;

  $: ({ hideBalances, language } = $settingsStore);
  $: known = {
    contacts,
    hidden: hideBalances,
    locale: language,
    ownAccounts,
    walletNames: $walletAccountNames,
  };
  // What this profile sent that's on its way: a reload or another tab's
  // send doesn't hide it.
  $: underWay = onTheirWay(historyRows);
  // The same payment, made already: moments ago, or with the same memo.
  $: madeAgain = addressInfo.isValid
    ? sentAlready(historyRows, {
        lux: sendAmountInLux,
        memo: transactionMemo,
        to: recipientAddress,
      })
    : null;
  // The same send waiting to go out already, from the same balance.
  $: waitingAgain =
    addressInfo.isValid && sendAmountInLux > 0n
      ? ($waitingSends.find(
          (send) =>
            send.from === from &&
            send.address === recipientAddress &&
            send.lux === sendAmountInLux &&
            send.memo === transactionMemo
        ) ?? null)
      : null;
  // Said on the button too, which then sends it again.
  $: isRepeat =
    Boolean(madeAgain && madeAgain.time !== null) || Boolean(waitingAgain);
  $: isAmountMasked = hideBalances && (isMaxAmount || isOwnAmount);
  $: amountText = formatDuskExact(sendAmountInLux, language);
  $: isShielded = addressInfo.type === "address";

  // Once the send goes out, the review's step leaves the history, and the
  // browser puts the page back where the form was scrolled: the result shows
  // from its top again.
  $: if (step === "done" && !$page?.state?.sendReview) {
    window.scrollTo(0, 0);
  }
</script>

{#if step === "done" && sent}
  <TransactionResult
    gate={sent.gate}
    maxFee={sent.maxFee}
    memo={sent.memo}
    onRetry={tryAgain}
    operation={sent.operation}
    tellArrival
    what={sent.what}
  />
{:else}
  <div
    class="send"
    class:send--fee-short={canLowerFee}
    class:send--review={step === "review"}
  >
    <!-- Anything typed holds the form until Review. -->
    <section
      aria-labelledby="{id}-title"
      class="send__form"
      on:input={() => {
        reviewWhenReady = false;
      }}
    >
      <a class="send__back" href={addBasePath("/dashboard")}
        ><Icon path={mdiArrowLeft} />Home</a
      >
      <h1 class="send__title" id="{id}-title" use:pageTitle={step !== "review"}>
        Send
      </h1>

      {#each underWay as row (row.hash)}
        <Banner
          className="send__under-way"
          role="status"
          title={`Your ${paymentOf(row, known)} is on its way.`}
          variant="info"
        >
          <AppAnchor
            className="text-link"
            href={`/dashboard/transactions?tx=${row.hash}`}
            >See in History</AppAnchor
          >
        </Banner>
      {/each}

      <UnsentSends />

      <div class="send__field">
        <label class="send__label" for="{id}-to">To</label>
        <div class="send__to">
          <Textbox
            aria-describedby={isRecipientInvalid
              ? invalidRecipientId
              : undefined}
            aria-invalid={isRecipientInvalid}
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            bind:value={sendToAddress}
            className={sendToAddressTextboxClasses}
            id="{id}-to"
            on:blur={finishRecipient}
            on:input={handleRecipientInput}
            on:keydown={handleRecipientKeyDown}
            on:paste={() => {
              isPasting = true;
              isRecipientChecked = true;
            }}
            placeholder="Address, .dusk name or payment link"
            spellcheck="false"
            type="text"
          />
          {#if recipientName && nameLookup?.[nameAddressType]}
            <span class="send__verified"
              ><Icon path={mdiCheckCircleOutline} />Name found</span
            >
          {/if}
          <!-- With a camera, which ScanQR looks for without asking for
            permission, or else from an image. -->
          <button
            aria-label={hasCamera
              ? "Scan a QR code"
              : "Scan a QR code from an image"}
            class="send__icon-button"
            on:click={() => {
              scanQrComponent.startScan();
            }}
            title={hasCamera
              ? "Scan a QR code"
              : "Scan a QR code from an image"}
            type="button"><Icon path={mdiQrcodeScan} /></button
          >
        </div>

        <!-- While what's typed names contacts, they're offered as links. -->
        {#if contacts.length && !namedContacts.length}
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
                >{contactNameText(option.name)} · {option.movedTo ===
                  undefined && !alike.has(option)
                  ? (option.duskName ?? shortenAddress(option.address))
                  : shortenAddress(option.address)}{alike.has(option)
                  ? " · name looks like another"
                  : ""}</option
              >
            {/each}
          </select>
        {/if}

        {#if linkProblem}
          <p class="send__error" role="alert"><strong>{linkProblem}</strong></p>
          {#if linkElsewhere}
            <AnchorButton
              className="send__elsewhere"
              href={linkElsewhere.href}
              size="small"
              text={`Switch to ${linkElsewhere.network}`}
              variant="secondary"
            />
          {/if}
        {:else if isRecipientInvalid}
          <p class="send__error" id={invalidRecipientId} role="alert">
            {#if isValidEvmAddress(sendToAddress)}
              <strong>That's an EVM address.</strong> To send to an EVM wallet, use
              the Bridge.
            {:else}
              <strong>Not a valid address.</strong> Check it, or paste it again.
            {/if}
          </p>
        {:else if namedProfiles.length || namedContacts.length}
          {#each namedProfiles as named (named.address)}
            <button
              class="send__link"
              on:click={() => {
                sendToAddress = named.address;
                isRecipientChecked = true;
              }}
              type="button"
              >{yourProfile(
                $walletAccountNames.get(named.address) ?? named.name
              )} · {shortenAddress(named.address)}</button
            >
          {/each}
          {#each namedContacts as named (named.id)}
            <button
              class="send__link"
              on:click={() => {
                sendToAddress = named.address;
                isRecipientChecked = true;
              }}
              type="button"
              >Your contact {contactNameText(named.name)} · {shortenAddress(
                named.address
              )}{alike.has(named) ? " · name looks like another" : ""}</button
            >
          {/each}
        {:else if bareName}
          <button
            class="send__link"
            on:click={() => {
              sendToAddress = bareName ?? sendToAddress;
            }}
            type="button">Did you mean {bareName}?</button
          >
        {/if}

        {#if isRefilled}
          <p class="send__hint" role="status">
            Filled in from the send that didn't go out. Check it before you
            send.
          </p>
        {:else if isFromLink}
          <p class="send__hint" role="status">
            {isSendBack
              ? "Filled in to send the payment back. Check it before you send."
              : "Filled in from the link. Check it before you send."}
          </p>
        {/if}

        {#if profileNamed}
          <p class="send__hint" role="status">
            {recipientName} is someone else's name, not your profile {profileNamed.name}.
          </p>
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
                on:click={lookUpNameAgain}
                size="small"
                text="Try again"
                variant="secondary"
              />
            {/if}
          </div>
        {:else if recipientName && nameLookup && !nameLookup[nameAddressType]}
          <p class="send__hint">Looking up {nameLookup.name}…</p>
        {/if}

        {#if isContactMoved && nameContact}
          <div class="send__warning" role="alert">
            <p>
              {#if namePointsTo}
                <strong
                  >{shownName} now points to a different address from the one saved
                  for {contactNameText(nameContact.name)}.</strong
                >
                Which do you want to send to?
              {:else}
                <strong
                  >{shownName} no longer points to the kind of address saved for
                  {contactNameText(nameContact.name)}.</strong
                >
              {/if}
            </p>
            <div class="send__choices">
              <Button
                on:click={() => {
                  sendToAddress = nameContact?.address ?? sendToAddress;
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
            the address saved for {contactNameText(contact.name)}.
          </p>
        {/if}

        {#if addressInfo.isValid && !isContactMoved}
          {@const isChoice = recipientName !== "" && nameOptions.length > 1}
          <div class="send__card">
            <p class="send__card-title" id="{id}-points">
              {#if contact}
                {contactNameText(contact.name)}{recipientName
                  ? ` · ${shownName}`
                  : ""}{isAlike ? " · name looks like another" : ""}
              {:else if own && !recipientName}
                {ownLabel}
              {:else if recipientName}
                {shownName} points to {isChoice
                  ? "two addresses"
                  : isShielded
                    ? "a shielded address"
                    : "a public account"}
              {:else if walletAccount}
                {walletAccount}
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
              <!-- Not for an account of this wallet or another kept here. -->
              {#if !contact && !own && !walletAccount && !isSavingContact}
                <Button
                  on:click={() => {
                    savingContactFor = recipientAddress;
                    isSavingContact = true;
                  }}
                  size="small"
                  text="Save to contacts"
                  variant="tertiary"
                />
              {/if}
            </div>

            {#if isSavingContact}
              <form
                class="send__save"
                on:submit|preventDefault={() => saveRecipient()}
              >
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
                    disabled={!contactName.trim() ||
                      isFalseContactName ||
                      contactNameIssue?.refused}
                    text="Save"
                    type="submit"
                    variant="primary"
                  />
                </div>
                <FieldLimit limit={40} value={contactName} />
                {#if isFalseContactName}
                  <p class="send__hint" role="alert">
                    That looks like a .dusk name. Choose another name.
                  </p>
                {:else if contactNameIssue}
                  <p class="send__hint" role="alert">
                    {contactNameIssue.words}
                  </p>
                  <!-- Asked at Save: saved only as the answer says so. -->
                  {#if !contactNameIssue.refused && contactAskedOf === contactName}
                    <Button
                      className="send__save-yes"
                      on:click={() => saveRecipient(true)}
                      size="small"
                      text={NAME_SAVE_YES}
                      variant="secondary"
                    />
                  {/if}
                {/if}
                <p class="send__hint">
                  Saved only in this wallet, on this device.
                </p>
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
          bind:hasCamera
          bind:this={scanQrComponent}
          bind:scanner
          check={scannedProblem}
          on:scan={(event) => takeRecipient(event.detail)}
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
            aria-describedby={isAmountMasked
              ? `${id}-amount-hidden`
              : `${id}-amount-error`}
            aria-invalid={amountError ? "true" : undefined}
            autocomplete="off"
            className="send__amount-input"
            id="{id}-amount"
            inputmode="decimal"
            on:input={typeAmount}
            placeholder="0"
            required
            type="text"
            value={isAmountMasked ? BALANCE_MASK : sendAmount}
          />
          {#if isAmountMasked}
            <span hidden id="{id}-amount-hidden">hidden</span>
          {/if}
          <span aria-hidden="true" class="send__unit">DUSK</span>
          <Button
            on:click={setMaxAmount}
            size="small"
            text="Max"
            variant="secondary"
          />
        </div>
        <!-- What it comes to in the person's money, once it reads. -->
        <AmountInCurrency
          className="send__hint send__in-currency"
          hidden={isAmountMasked}
          lux={parsedAmount}
        />
        <p class="send__hint">
          Available <BalanceValue
            exact={formatDuskExact(availableBalance, language)}
            value={formatDusk(availableBalance, language)}
          /> DUSK from your {isShielded ? "shielded" : "public"} balance{waiting >
          0n
            ? ", after what's waiting to go out"
            : ""}
        </p>
        {#if leavesTooLittle}
          <p class="send__hint send__keep" role="status">
            That leaves too little {keepForLater.why}.
          </p>
        {:else if isMaxAmount && toKeep > 0n && sendAmountInLux === maxKeeping}
          <p class="send__hint">
            Max keeps {hideBalances
              ? "the fee"
              : `${formatFee(toKeep, language, { max: true })} DUSK`}
            {keepForLater.why}.
          </p>
        {/if}
        {#if readAmount(sendAmount, language).question}
          <!-- Either of two: a tap on one puts it in the field. -->
          <AmountQuestion
            className="send__error"
            id="{id}-amount-error"
            {language}
            on:choose={(event) => {
              sendAmount = event.detail;
              isMaxAmount = false;
              isOwnAmount = false;
            }}
            text={sendAmount}
          />
        {:else if amountError && (isBalanceSufficientForGas || sendAmountInLux > availableBalance || parsedAmount === null)}
          <p class="send__error" id="{id}-amount-error" role="alert">
            {amountError}
          </p>
        {:else if balanceKnown && !isBalanceSufficientForGas && availableBalance > 0n}
          <p class="send__error" role="alert">
            <strong>Not enough for the network fee.</strong> Add DUSK{canLowerFee
              ? ", or lower the fee under Edit"
              : ""}.
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
        {#if isMemoTooLong}
          <p class="send__error send__memo-error" role="alert" use:staysInView>
            <strong>That memo is too long.</strong>
            Take out {charactersOver(transactionMemo)}
            {charactersOver(transactionMemo) === 1
              ? "character"
              : "characters"}.
          </p>
        {:else if isMemoValid === false}
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
            {#if memoRoom <= 100}
              Room for {memoRoom} more
              {memoRoom === 1 ? "character" : "characters"}.
            {/if}
          </p>
        {/if}
      </div>
    </section>

    <aside aria-labelledby="{id}-summary" class="send__summary">
      <SectionHead id="{id}-summary" tabindex="-1"
        >{step === "review" ? "Review" : "Summary"}</SectionHead
      >
      <dl class="send__rows">
        <div>
          <dt>From</dt>
          <dd>
            <!-- With more than one wallet, the one it goes from first. -->
            <span class="send__summary-name"
              >{$openWalletName
                ? `${$openWalletName} · ${fromLabel}`
                : fromLabel}</span
            >
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
              {#if contact || recipientName || walletAccount}
                <span class="send__summary-name"
                  >{contact && recipientName
                    ? `${contactNameText(contact.name)} · ${shownName}`
                    : contact
                      ? contactNameText(contact.name)
                      : recipientName
                        ? shownName
                        : walletAccount}</span
                >
                {#if isAlike}
                  <span class="send__summary-alike"
                    >Name looks like another</span
                  >
                {/if}
              {/if}
              <!-- The review is the last it shows of it before it goes. -->
              {#if step === "review"}
                <FullAddress address={recipientAddress} />
              {:else}
                <span class="send__summary-code"
                  >{shortenAddress(recipientAddress)}</span
                >
              {/if}
            {/if}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            <BalanceValue hidden={isAmountMasked} value={amountText} /> DUSK
            <AmountInCurrency
              className="send__summary-currency"
              hidden={isAmountMasked}
              lux={parsedAmount}
            />
          </dd>
        </div>
        {#if transactionMemo}
          <div>
            <dt>Memo</dt>
            <dd class="send__summary-memo">
              <MemoText text={transactionMemo} />
            </dd>
          </div>
        {/if}
      </dl>
      {#if step === "review" && leavesTooLittle}
        <p class="send__keep" role="status">
          That leaves too little {keepForLater.why}.
        </p>
      {/if}
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
            Up to <BalanceValue
              hidden={isAmountMasked}
              value={formatTotal(totalAmount, availableBalance, language)}
            /> DUSK
          </dd>
        </div>
      </dl>
      {#if waitingAgain}
        <!-- Said, not stopped, as for one sent: the same twice can be meant. -->
        <Banner
          className="send__again"
          role="alert"
          title={`The same send is waiting to go out already: ${waitingText(waitingAgain, { hidden: hideBalances, locale: language })}${waitingAgain.memo.trim() ? ", with this memo" : ""}.`}
          variant="warning"
        />
      {:else if madeAgain && madeAgain.time !== null}
        <!-- Said, not stopped: the same payment twice can be meant. -->
        <Banner
          className="send__again"
          role="alert"
          title={sentBefore(madeAgain, known)}
          variant="warning"
        />
      {/if}
      {#if step === "review"}
        <!-- A step of its own: nothing goes before it, and Send, new with it,
          takes no click meant for Review. A payment made already, found while
          it shows, makes it anew: Send again takes no click meant for Send. -->
        {#key isRepeat}
          <Button
            className="send__send"
            confirm
            disabled={!canSend}
            on:click={send}
            text={`Send${sendAmountInLux > 0n ? ` ${isAmountMasked ? BALANCE_MASK : amountText} DUSK` : ""}${isRepeat ? " again" : ""}`}
            variant="primary"
          />
        {/key}
        <p class="send__final">Sends can't be undone.</p>
        <Button
          className="send__back"
          icon={{ path: mdiArrowLeft }}
          on:click={() => {
            step = "form";
            history.back();
          }}
          text="Back"
          variant="secondary"
        />
      {:else}
        <!-- On a phone, the one thing of the summary that shows with the form. -->
        <div class="send__review-bar">
          <Button
            className="send__review"
            disabled={!canSend}
            on:click={goToReview}
            text="Review"
            variant="primary"
          />
        </div>
      {/if}
    </aside>
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
    line-height: 1.15;
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

  /* Compact, with a field's edge and surface. */
  /* However long a contact's name, the box stays on the screen: the phone's
    own list shows each name in full. */
  .send__contacts {
    align-self: flex-start;
    min-width: 0;
    max-width: 100%;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border: 1px solid var(--calm-field-edge);
    border-radius: 0.625rem;
    background-color: var(--calm-field);
    color: var(--calm-text);
    font-size: 0.875rem;
  }

  @media (max-width: 47.99rem), (pointer: coarse) {
    .send__contacts {
      min-height: 44px;
    }
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
    overflow-wrap: anywhere;
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

  .send__summary :global(.send__summary-currency) {
    display: block;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .send__save :global(.send__save-yes) {
    align-self: flex-start;
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

  .send__field :global(.send__elsewhere) {
    align-self: flex-start;
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

  /* As the picker and History mark it. */
  .send__summary-alike {
    color: var(--calm-pending);
    font-size: 0.8125rem;
  }

  .send__summary-code {
    color: var(--calm-muted);
    font-family: var(--code-font-family);
    font-size: 0.75rem;
  }

  /* Lines of text someone reads: from the left, as any text. */
  .send__rows dd.send__summary-memo {
    align-items: stretch;
    text-align: left;
  }

  .send__memo-error {
    scroll-margin-block-end: 6rem;
  }

  .send__keep {
    color: var(--calm-danger);
    font-size: 0.84375rem;
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

  .send__summary :global(.section-head:focus) {
    outline: none;
  }

  .send__summary :global(.send__send),
  .send__summary :global(.send__review),
  .send__summary :global(.send__back) {
    width: 100%;
  }

  /* The review: the summary takes the page, in a column of its own. */
  .send--review {
    grid-template-columns: minmax(0, 30rem);
    justify-content: center;
  }

  .send--review .send__form {
    display: none;
  }

  .send--review .send__summary {
    position: static;
  }

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

    .send--review {
      grid-template-columns: minmax(0, 1fr);
    }

    /* The form first: of the summary, only Review, kept above the keyboard. */
    .send:not(.send--review) .send__summary {
      display: contents;
    }

    .send:not(.send--review) .send__summary > :global(:not(.send__review-bar)) {
      display: none;
    }

    /* What's short is the fee: its Edit is the way on, with the form. */
    .send--fee-short:not(.send--review)
      .send__summary
      > :global(.gas-settings) {
      display: block;
    }

    .send__review-bar {
      position: sticky;
      bottom: var(--keyboard-inset, 0px);
      z-index: 3;
      padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom));
      background: var(--calm-s0);
      box-shadow: 0 -1px 0 var(--calm-line);
    }
  }
</style>
