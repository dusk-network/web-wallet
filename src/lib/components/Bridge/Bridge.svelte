<svelte:options immutable={true} />

<script>
  import { amountForField, readAmount } from "@dusk-network/app-core/amounts";
  import AmountQuestion from "../AmountQuestion/AmountQuestion.svelte";
  import { browser } from "$app/environment";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import {
    mdiArrowDown,
    mdiArrowLeft,
    mdiArrowUpBoldBoxOutline,
    mdiChevronDown,
    mdiClockOutline,
  } from "@mdi/js";
  import { formatUnits } from "viem";
  import {
    call as callEvm,
    estimateGas,
    estimateMaxPriorityFeePerGas,
    getBlock,
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
    FullAddress,
    GasSettings,
    OperationResult,
    ReviewWallet,
    SectionHead,
  } from "$lib/components";
  import {
    amountProblem,
    readDuskInput,
  } from "$lib/components/Stake/stakeAmount";
  import NetworkMark from "$lib/components/NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "$lib/components/NetworkPicker/NetworkPicker.svelte";
  import SwapCard from "$lib/components/SwapCard/SwapCard.svelte";
  import nodeNetwork from "$lib/stores/nodeNetwork";

  import "./routeReview.css";
  import {
    cardRoutes,
    choosePair,
    flipRoute,
    fromChoices as fromChoicesOf,
    notRunning,
    openingRoute,
    routeBetween,
    toChoices as toChoicesOf,
  } from "$lib/bridge/cardRoutes";

  import ArrivalNotice from "./ArrivalNotice.svelte";
  import MigrationRoute from "./MigrationRoute.svelte";
  import RouteStatusLine from "./RouteStatusLine.svelte";
  import ServiceRoute from "./ServiceRoute.svelte";
  import {
    account,
    duskEvm,
    modal,
    wagmiConfig,
  } from "$lib/web3/walletConnection";
  import { contractLabel } from "$lib/activity/knownContracts";
  import { configuredBridge } from "$lib/bridge/bridgeCalls";
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
  import { withdrawalStart } from "$lib/bridge/withdrawals";
  import { GAS_PRICE_ORACLE, duskEvmFee } from "$lib/bridge/duskEvmFee";
  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import { beforeProofText } from "@dusk-network/networks/duskevm";
  import {
    DEPOSIT,
    WITHDRAWAL,
    routeTime,
    routeTimeText,
  } from "$lib/bridge/routeTimes";
  import {
    figureWidth,
    formatDusk,
    formatDuskExact,
    formatFee,
    formatTotal,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { shortenAddress } from "$lib/dusk/string";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import { formDraft, gasToKeep, keptGas } from "$lib/navigation";
  import { sendPasswordFor } from "$lib/security/sendPassword";
  import { settingsStore, walletStore } from "$lib/stores";
  import {
    CHECK_EVM_WALLET_FIRST,
    describeFailure,
    nothingWentOut,
    outcomeUnknown,
    unconfirmedHash,
  } from "$lib/transactions";
  import { walletDataName, walletDataScope } from "$lib/wallets/dataNames";
  import { LAST_WITHDRAWAL_KEY as LAST_WITHDRAWAL_TX_HASH_KEY } from "$lib/bridge/bridgeRecordKeys";

  /**
   * DuskEVM uses duskEvm.nativeCurrency.decimals (currently 18). DuskDS uses 9 decimals (Lux).
   * This converts from EVM base units (1e18) to Lux units (1e9), which amounts are shown from.
   * @type {bigint}
   */
  const EVM_TO_LUX_SCALE_FACTOR =
    10n ** BigInt(duskEvm.nativeCurrency.decimals - 9);

  const WITHDRAWAL_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

  /** Why a withdrawal didn't go: its fee wasn't worked out for it. */
  const NO_FEE =
    "The network fee couldn't be worked out for this withdrawal, so nothing was sent.";

  /** Why a withdrawal didn't go: it was reviewed for other accounts. */
  const ACCOUNT_CHANGED =
    "The EVM account or the profile changed after the review, so nothing was sent.";

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

  /**
   * What the public balance has to keep for what the wallet holds elsewhere,
   * which Max leaves in it (`$lib/wallet-reserve`).
   *
   * @type {import("$lib/wallet-reserve").FeeToKeep}
   */
  export let keepForLater = { lux: 0n, why: "" };

  /** @type {import('@wagmi/core').GetBalanceReturnType | undefined} */
  export let evmDuskBalance;

  /** A public transfer's gas, for the routes out to another chain. */
  /** @type {ContractGasSettings} */
  export let transferGasSettings = gasSettings;

  /** @type {GasStoreContent} */
  export let transferGasLimits = gasLimits;

  /** The route a link names (`?route=bsc-to-dusk`), or none. */
  /** @type {string | null} */
  export let linkedRoute = null;

  /**
   * The EVM chain the connected wallet is kept on for the route picked:
   * DuskEVM's, a migration's chain, or none for a transfer out.
   *
   * @type {number | undefined}
   */
  export let evmChainId = undefined;

  const draft = formDraft("bridge");

  /**
   * The route and what was typed before a lock, a reload or a failed transfer,
   * unless a link to another route opens the page now.
   *
   * @type {any}
   */
  const typedBefore = ((before) =>
    before && (!linkedRoute || before.link === linkedRoute) ? before : null)(
    draft.read(),
  );

  /** @type {string} */
  let amount = typedBefore?.amount ?? "";

  /**
   * Whether Max filled the amount in, since it was last typed: worked out
   * from one side's balance, it doesn't come over a swap to the other, also
   * after a lock or a reload, which keep it with the amount.
   */
  let isMaxAmount = typedBefore?.isMax === true;

  /** What the open review is of (`reviewOf`): it closes once that's not it. */
  let reviewed = "";

  /**
   * Whether Max was worked out again at a review's fee, more than the one
   * it left aside: the form says so.
   */
  let isMaxLower = false;

  /** @param {Event} event */
  function typeAmount(event) {
    amount = /** @type {HTMLInputElement} */ (event.currentTarget).value;
    isMaxAmount = false;
  }

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
  let { gasLimit, gasPrice } = keptGas(typedBefore?.gas, gasSettings);

  /** Whether the first step, where the gas can be edited, shows. */
  let isEditing = true;

  let defaultGas = gasSettings;

  /**
   * The withdrawal's quote for its review: the call it was quoted for, from
   * the EVM account and to the public account it was reviewed for, the most
   * DuskEVM can charge it, in wei, and the gas limit and price caps the EVM
   * wallet is asked for as it sends it, which keep the fee to that. Nothing
   * goes out without it.
   *
   * @type {(import("$lib/bridge/duskEvmFee").DuskEvmQuote & { account: `0x${string}`, call: { data: `0x${string}`, to: `0x${string}`, value: bigint }, feeWei: bigint, recipient: string }) | null}
   */
  let withdrawalQuote = null;

  /** Whether the review's quote couldn't be read: nothing goes out. */
  let isQuoteMissing = false;

  $: withdrawalFeeWei = withdrawalQuote?.feeWei ?? null;

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
   * Quotes the DuskEVM fee of a withdrawal of the given amount: the most the
   * chain can charge it, its L1 data and operator fees included, at the gas
   * limit the EVM wallet is then asked for.
   *
   * @param {bigint} value The amount, in wei: whole lux.
   */
  async function estimateWithdrawalFee(value) {
    const sender = /** @type {`0x${string}`} */ ($account.address);
    const recipient = unshieldedAddress;
    const call = withdrawalStart({
      amountWei: value,
      sender,
      to: recipient,
    });
    const chainId = duskEvm.id;

    const quote = await duskEvmFee(
      {
        baseFee: async () =>
          (await getBlock(wagmiConfig, { chainId })).baseFeePerGas ?? null,
        estimateGas: () =>
          estimateGas(wagmiConfig, {
            account: sender,
            chainId,
            data: call.data,
            to: call.to,
            value: call.value,
          }),
        gasPrice: loadEvmGasPrice,
        oracle: async (data) =>
          (await callEvm(wagmiConfig, { chainId, data, to: GAS_PRICE_ORACLE }))
            .data,
        tip: () => estimateMaxPriorityFeePerGas(wagmiConfig, { chainId }),
      },
      call.data,
    );

    return { ...quote, account: sender, call, recipient };
  }

  /** Gets the fee a withdrawal's review shows. */
  function prepareWithdrawalReview() {
    reviewRequests += 1;

    const request = reviewRequests;

    withdrawalQuote = null;
    isQuoteMissing = false;
    estimateWithdrawalFee(amountWei)
      .then(
        (quote) => quote,
        () => null,
      )
      .then((quote) => {
        // Only for the review asked for last, while it's open: one that
        // closed since, as what it's of changed, is asked for again as it
        // opens again.
        if (request !== reviewRequests) {
          return;
        }

        const { feeWei, maxFeePerGas, maxPriorityFeePerGas } = quote ?? {};

        if (quote && feeWei && maxFeePerGas && maxPriorityFeePerGas !== null) {
          withdrawalQuote = { ...quote, feeWei };
        } else {
          isQuoteMissing = true;
        }
      });
  }

  /**
   * The amount to bridge, as the amount field shows it.
   *
   * @param {bigint} lux
   */
  const toAmountText = (lux) =>
    amountForField(
      formatUnits(lux > 0n ? lux : 0n, 9),
      getDecimalSeparator(language),
    );

  /**
   * Bridges all it can: on DuskDS what the public balance holds past the
   * fee, on DuskEVM what is left after the most the withdrawal's fee can be.
   * With no quote of that, there's no maximum.
   */
  async function setMaxAmount() {
    isMaxLower = false;

    if (isDepositing) {
      const all = unshieldedBalance - fee;

      amount = toAmountText(
        all > keepForLater.lux ? all - keepForLater.lux : all,
      );
      isMaxAmount = true;
      return;
    }

    if (!evmDuskBalance) {
      return;
    }

    maxRequests += 1;

    const request = maxRequests;
    const scope = maxScope;
    // A lux's withdrawal takes the gas any other amount does.
    const quote = await estimateWithdrawalFee(EVM_TO_LUX_SCALE_FACTOR).catch(
      () => null,
    );

    // The amount, the direction or a wallet changed while the fee was
    // quoted, or the maximum was asked for again: this one is dropped.
    if (
      request !== maxRequests ||
      scope !== maxScope ||
      !evmDuskBalance ||
      !quote?.feeWei
    ) {
      return;
    }

    amount = toAmountText(
      (evmDuskBalance.value - quote.feeWei) / EVM_TO_LUX_SCALE_FACTOR,
    );
    isMaxAmount = true;
  }

  /**
   * Works Max out again at a review's fee, which leaves too little of the
   * DuskEVM balance for what Max filled in: the review closes, as its amount
   * changes, for the new one to be reviewed.
   *
   * @param {bigint} feeWei
   */
  function maxAtReviewFee(feeWei) {
    if (!evmDuskBalance) {
      return;
    }

    amount = toAmountText(
      (evmDuskBalance.value - feeWei) / EVM_TO_LUX_SCALE_FACTOR,
    );
    isMaxLower = true;
  }

  /**
   * A DuskEVM balance in LUX.
   *
   * @param {{ value: bigint }} balance
   */
  const evmLux = (balance) => balance.value / EVM_TO_LUX_SCALE_FACTOR;

  /**
   * The most a withdrawal's fee can be, in whole LUX, as its review quoted
   * it: what the password goes by, and what Max leaves.
   *
   * @param {bigint} feeWei
   */
  const withdrawalFeeBound = (feeWei) =>
    (feeWei + EVM_TO_LUX_SCALE_FACTOR - 1n) / EVM_TO_LUX_SCALE_FACTOR;

  // What this screen sends, it sends from the wallet it was drawn for, and
  // keeps for that wallet.
  const forThisWallet = walletStore.forThisWallet();
  const stillOpen = walletStore.whileOpen();
  const records = walletDataScope();

  async function submitNativeWithdrawal() {
    if (!unshieldedAccount) {
      throw new Error("Dusk account is not available.");
    }

    if (!$account.address) {
      throw new Error("DuskEVM account is not available.");
    }

    // It goes as it was reviewed, or not at all: the very call its review
    // was quoted for, at that quote, from the EVM account and to the public
    // account of this wallet it was reviewed for.
    const quote = withdrawalQuote;

    if (!quote) {
      throw new Error(NO_FEE);
    }

    /** Whether the EVM wallet and the profile are still the review's. */
    const isAsReviewed = () =>
      $account.address?.toLowerCase() === quote.account.toLowerCase() &&
      unshieldedAddress === quote.recipient;

    if (!isAsReviewed()) {
      throw new Error(ACCOUNT_CHANGED);
    }

    const withdrawal = withdrawalStart({
      amountWei,
      sender: quote.account,
      to: quote.recipient,
    });

    if (
      quote.call.data !== withdrawal.data ||
      quote.call.to !== withdrawal.to ||
      quote.call.value !== withdrawal.value
    ) {
      throw new Error(NO_FEE);
    }

    // Above the amount chosen in Settings, with its fee, the password comes
    // first.
    await sendPasswordFor(
      amountLux + withdrawalFeeBound(quote.feeWei),
      $walletStore.walletKey,
    );
    stillOpen();

    await switchChain(wagmiConfig, { chainId: duskEvm.id });
    stillOpen();

    // Another account picked in the EVM wallet, or another profile here,
    // while the password was asked: nothing goes.
    if (!isAsReviewed()) {
      throw new Error(ACCOUNT_CHANGED);
    }

    // Once the EVM wallet was asked to send it, it may have, whatever
    // went wrong but its own refusals (describeFailure). It's asked to send
    // it from the account reviewed, whichever it shows now, for the gas
    // limit and the price caps the review's fee was quoted at, which keep
    // the fee to it.
    const hash = await sendTransaction(wagmiConfig, {
      account: quote.account,
      chainId: duskEvm.id,
      data: withdrawal.data,
      gas: quote.gasLimit,
      maxFeePerGas: /** @type {bigint} */ (quote.maxFeePerGas),
      maxPriorityFeePerGas: /** @type {bigint} */ (quote.maxPriorityFeePerGas),
      to: withdrawal.to,
      value: withdrawal.value,
    }).catch((error) => {
      throw outcomeUnknown(error);
    });

    rememberWithdrawalTxHash(hash, quote);
    return hash;
  }

  /**
   * A deposit whose answer got lost, as it was sent: kept for this wallet
   * once the chain has it.
   *
   * @type {{ account: `0x${string}`, amountLux: bigint, amountWei: bigint, hash: string } | null}
   */
  let lostDeposit = null;

  async function submitNativeDeposit() {
    if (!$account.address) {
      throw new Error("Account address is not available.");
    }

    const sent = { account: $account.address, amountLux, amountWei };
    const response = await forThisWallet(walletStore.depositEvmFunctionCall)(
      $account.address,
      amountLux,
      new Gas({ limit: gasLimit, price: gasPrice }),
    ).catch((error) => {
      const lost = unconfirmedHash(error);

      lostDeposit = lost ? { ...sent, hash: lost } : null;

      throw error;
    });
    const { hash } = response;

    // Sent: what's wrong with it from here doesn't say it wasn't.
    if (typeof hash !== "string") {
      throw outcomeUnknown(
        new Error("The Dusk transaction did not return a hash."),
      );
    }

    // Sent: kept for this wallet, whichever is open now.
    const remembered = rememberDepositTransaction(
      hash,
      { account: $account.address, amountLux, amountWei },
      records,
    );

    if (!remembered) {
      throw outcomeUnknown(
        new Error("The Dusk transaction returned an invalid hash."),
      );
    }

    void trackDepositTransaction(remembered.transactionHash, records);
    return remembered.transactionHash;
  }

  /**
   * The deposit whose answer got lost, now the chain has it: kept and
   * followed as one sent.
   *
   * @param {string} hash
   */
  function keepSeenDeposit(hash) {
    if (lostDeposit?.hash !== hash) {
      return;
    }

    const { account: from, amountLux: lux, amountWei: wei } = lostDeposit;
    const remembered = rememberDepositTransaction(
      hash,
      { account: from, amountLux: lux, amountWei: wei },
      records,
    );

    lostDeposit = null;

    if (remembered) {
      void trackDepositTransaction(remembered.transactionHash, records);
    }
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
   * @returns {"/dashboard/bridge/transactions/" | `/dashboard/bridge/transactions/?tx=${string}`}
   */
  function withdrawalStatusHref(hash = lastWithdrawalTxHash) {
    return WITHDRAWAL_TX_HASH_PATTERN.test(hash)
      ? `/dashboard/bridge/transactions/?tx=${hash}`
      : "/dashboard/bridge/transactions/";
  }

  /**
   * @param {string | undefined} hash
   * @param {{ account: `0x${string}`, recipient: string }} sent The accounts
   *   it was sent from and to, as reviewed
   */
  function rememberWithdrawalTxHash(hash, { account: from, recipient }) {
    if (!browser || !WITHDRAWAL_TX_HASH_PATTERN.test(hash ?? "")) {
      return hash;
    }

    lastWithdrawalTxHash = /** @type {string} */ (hash);

    // Sent: kept for this wallet, whichever is open now. It pays this
    // wallet's public account.
    const remembered = rememberWithdrawalTransaction(
      /** @type {`0x${string}`} */ (lastWithdrawalTxHash),
      { account: from, amountWei, recipient },
      records,
    );

    if (remembered) {
      void trackWithdrawalTransaction(remembered.transactionHash, {}, records);
    }

    return hash;
  }

  /** The route picked, by its ID; until one is, the one the card opens on. */
  /** @type {string | null} */
  let routeId = typedBefore?.routeId ?? null;

  /**
   * Picks the route a From or a To choice makes, and starts its form over.
   *
   * @param {{ from?: string, to?: string }} choice
   */
  function pickRoute({ from, to }) {
    const next = from
      ? choosePair(list, from, destinationNetwork)
      : to
        ? routeBetween(list, originNetwork, to)
        : null;

    if (next && next.id !== route?.id) {
      flipped = "";
      routeId = next.id;
      amount = "";
      isMaxAmount = false;
      step = "form";
    }
  }

  /** Goes the other way, where the network has it. */
  function flip() {
    const back = flipRoute(list, route);

    if (back) {
      routeId = back.id;
      step = "form";

      // A maximum is the other side's balance's: it doesn't come over.
      if (isMaxAmount) {
        amount = "";
        isMaxAmount = false;
      }

      flipped =
        back.kind === "migration"
          ? `From ${back.chain.name} to Dusk`
          : back.kind === "service"
            ? `From Dusk to ${back.chain.name}`
            : "From the other side";
    }
  }

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

  /** Where the card is: the form, the review, or what came of it. */
  /** The direction the swap just changed to, as a screen reader hears it. */
  let flipped = "";

  /** How often the Bridge tab asked for a new transfer: a route starts over. */
  let restarts = 0;

  /** @type {"form" | "result" | "review"} */
  let step = "form";

  /** Whether this card's own transfer was asked for, and hasn't failed since. */
  let isSent = false;

  /** What Send started: shown once the card moves on to it. */
  /** @type {Promise<string>} */
  let operation = Promise.resolve("");

  function review() {
    isEditing = false;
    reviewed = reviewOf;

    if (isWithdrawing) {
      prepareWithdrawalReview();
    }

    step = "review";
  }

  function edit() {
    isEditing = true;
    step = "form";
    // A fee asked for a review that closed is for none: a review asks again.
    reviewRequests += 1;
  }

  function send() {
    // It goes out now, as far as a reload can tell: nothing brings it back.
    isSent = true;
    draft.clear();
    operation = bridge();
    operation.catch((error) => {
      if (nothingWentOut(error)) {
        draft.keep(typed);
      }
    });
    step = "result";
  }

  /** Back to the review of a transfer that failed with nothing sent. */
  function tryAgain() {
    isSent = false;
    review();
  }

  function primaryAction() {
    if (!isConnected) {
      modal.open();
    } else if (primary.ready) {
      review();
    }
  }

  // The route picked, and what's typed on the card's own routes, kept as it's
  // typed, for as long as it hasn't gone out: another route keeps its own.
  $: typedHere =
    route?.kind === "migration" || route?.kind === "service" ? "" : amount;
  $: typed =
    routeId || typedHere
      ? {
          amount: typedHere,
          gas: gasToKeep({ gasLimit, gasPrice }, defaultGas),
          isMax: isMaxAmount,
          link: linkedRoute,
          routeId,
        }
      : {};
  $: if (!isSent) {
    draft.save(typed);
  }

  $: list = cardRoutes($nodeNetwork);
  $: route =
    list.find(({ id }) => id === routeId) ?? openingRoute(list, linkedRoute);
  $: originNetwork = route?.origin ?? "duskDs";
  $: destinationNetwork = route?.destination ?? "duskEvm";
  $: evmChainId = !route
    ? undefined
    : route.kind === "migration"
      ? route.chain.chainId
      : route.kind === "service"
        ? undefined
        : duskEvm.id;
  $: problem = amountProblem(amount, language);
  $: fee = gasLimit * gasPrice;

  // The default gas can change while the form is open, as when the node's
  // price arrives: the form takes it while its gas can be edited, unless it
  // was edited here, and keeps the gas a review shows.
  $: if (isEditing && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings,
    ));
    defaultGas = gasSettings;
  }

  $: isDepositing =
    originNetwork === "duskDs" && destinationNetwork === "duskEvm";
  $: isWithdrawing =
    originNetwork === "duskEvm" && destinationNetwork === "duskDs";
  $: ({ address: evmAddress, isConnected } = $account);

  /** The side the amount is typed on, once the card shows one. */
  let amountSide = "";

  // A maximum is its side's balance's: it doesn't come over to the other,
  // however the direction changes, by the swap, a pick or a link to the
  // card that takes it to another route.
  $: if (originNetwork !== amountSide) {
    if (amountSide && isMaxAmount) {
      amount = "";
      isMaxAmount = false;
    }

    amountSide = originNetwork;
  }

  // What the maximum is asked for: new whenever the amount, the direction
  // or a wallet changes, so that an answer for an older one is dropped.
  $: maxScope = { amount, evmAddress, isWithdrawing, unshieldedAccount };
  $: incomingDepositLux = pendingDepositAmountLux(
    $account.address,
    $depositActivityStore,
  );
  $: amountLux = readDuskInput(amount, language) ?? 0n;
  // What arrives, as the To panel says it.
  $: arrivingText =
    amountLux === 0n ? "0" : formatDuskExact(amountLux, language);
  // Lux (1e9) in EVM base units (1e18).
  $: amountWei = amountLux * EVM_TO_LUX_SCALE_FACTOR;
  $: totalDepositLux = amountLux + fee;
  // Too little left of the public balance for what the wallet holds elsewhere.
  $: leavesTooLittle =
    isDepositing &&
    keepForLater.lux > 0n &&
    amountLux > 0n &&
    totalDepositLux <= unshieldedBalance &&
    unshieldedBalance - totalDepositLux < keepForLater.lux;
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

  $: primary = !route?.running
    ? { label: "Not running right now", ready: false }
    : !isConnected
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
            : { label: "Review", ready: true };

  /**
   * What a review is of: the route and its direction, the EVM account and
   * the public account it goes between, the amount, and a deposit's fee. A
   * withdrawal's fee is its review's own, read as it opens.
   */
  $: reviewOf = [
    route?.id ?? "",
    originNetwork,
    destinationNetwork,
    evmAddress ?? "",
    unshieldedAddress,
    amountLux,
    isDepositing ? fee : "",
  ].join(" ");

  // What an open review shows never changes under the person: once any of
  // what it's of changes, as with another account in the EVM wallet, another
  // profile, a link to the card that takes it to another route, or a
  // maximum worked out again, it closes, for that to be reviewed. Without
  // its EVM wallet too: the form offers to connect it.
  $: if (step === "review" && (!isConnected || reviewOf !== reviewed)) {
    edit();
  }

  // The review's fee, the most the chain can take for it, with the amount:
  // more than the DuskEVM balance, and the chain refuses it. It's never
  // offered: an amount Max filled in is worked out again at that fee, and
  // another is said to be more than there is.
  $: isShortOfFee =
    step === "review" &&
    isWithdrawing &&
    withdrawalQuote !== null &&
    Boolean(evmDuskBalance) &&
    amountWei + withdrawalQuote.feeWei >
      /** @type {{ value: bigint }} */ (evmDuskBalance).value;
  $: if (isShortOfFee && isMaxAmount && withdrawalQuote) {
    maxAtReviewFee(withdrawalQuote.feeWei);
  }

  // How long each way takes on this network: what its chains said, or none.
  $: depositTime = routeTime(DEPOSIT, $bridgeTimes);
  $: withdrawalTime = routeTime(WITHDRAWAL, $bridgeTimes);
  $: depositLine = routeLineOf(depositTime, [
    `fee up to ${formatFee(fee, language, { max: true })} DUSK`,
  ]);
  $: withdrawalLine = routeLineOf(withdrawalTime, ["send, prove, claim"]);
  $: routeLine = isDepositing ? depositLine : withdrawalLine;
  $: fromChoices = fromChoicesOf(list, originNetwork, $nodeNetwork);
  $: toChoices = toChoicesOf(
    list,
    originNetwork,
    destinationNetwork,
    $nodeNetwork,
    (each) =>
      each.kind === "duskevm-deposit"
        ? depositLine
        : each.kind === "duskevm-withdrawal"
          ? withdrawalLine
          : each.running
            ? routeTimeText(routeTime(each, { net: $nodeNetwork }))
            : notRunning($nodeNetwork),
  );
  $: canFlip = Boolean(flipRoute(list, route));

  // What's left once a withdrawal is sent: the proof, then the claim, with
  // the waits the chain said: "Claim 7 days after you prove. You can prove
  // about 30 minutes after sending."
  $: withdrawalNext =
    beforeProofText(withdrawalTime) || "Prove it on Dusk, then claim it.";

  onMount(() => {
    void bridgeTimes.load();
    lastWithdrawalTxHash =
      localStorage.getItem(walletDataName(LAST_WITHDRAWAL_TX_HASH_KEY)) ?? "";

    const unsubscribeAccount = account.subscribe((value) => {
      resumeDepositTracking(value.address);
      resumeWithdrawalTracking(value.address);
    });

    return unsubscribeAccount;
  });

  // A flow the person started shows its figures, with balances hidden too.
  $: ({ language } = $settingsStore);
  // The contract a deposit calls on Dusk, as the network's file names it.
  $: ({ name: networkName } = $nodeNetwork ?? { name: "" });
  $: depositContract = networkName ? configuredBridge().bridge : "";
</script>

<SwapCard label="Bridge">
  <div class="swap-top" slot="top">
    <nav aria-label="Bridge and transfers" class="swap-tabs">
      <a
        aria-current="page"
        class="swap-tab"
        href={resolve("/dashboard/bridge/")}
        on:click={() => {
          restarts += 1;
        }}>Bridge</a
      >
      <a class="swap-tab" href={resolve(withdrawalStatusHref())}>Transfers</a>
    </nav>
  </div>

  <p class="sr-only" role="status">{flipped}</p>
  {#if !route}
    <p class="bridge__none">The bridge has no routes on this network.</p>
  {:else if route.kind === "migration"}
    {#key `${route.id} ${restarts}`}
      <MigrationRoute
        {canFlip}
        focusSwap={Boolean(flipped)}
        {fromChoices}
        net={$nodeNetwork}
        on:flip={flip}
        on:pick={({ detail }) => pickRoute(detail)}
        recipient={unshieldedAddress}
        {route}
        {toChoices}
      />
    {/key}
  {:else if route.kind === "service"}
    {#key `${route.id} ${restarts}`}
      <ServiceRoute
        {canFlip}
        focusSwap={Boolean(flipped)}
        {fromChoices}
        {keepForLater}
        gasLimits={transferGasLimits}
        gasSettings={transferGasSettings}
        net={$nodeNetwork}
        on:flip={flip}
        on:pick={({ detail }) => pickRoute(detail)}
        {route}
        {toChoices}
        {unshieldedAddress}
        {unshieldedBalance}
      />
    {/key}
  {:else if step === "form"}
    <div class="swap-panel">
      <div class="swap-panel__head">
        <span class="swap-panel__label">From</span>
        <NetworkPicker
          choices={fromChoices}
          on:pick={({ detail }) => pickRoute({ from: detail })}
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
          id="bridge-amount"
          inputmode="decimal"
          name="destination-amount"
          on:input={typeAmount}
          placeholder="0"
          spellcheck="false"
          type="text"
          value={amount}
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
                hidden={false}
                value={formatDusk(unshieldedBalance, language)}
              /> DUSK
            {:else if evmDuskBalance}
              <BalanceValue
                exact={formatDuskExact(evmLux(evmDuskBalance), language)}
                hidden={false}
                value={formatDusk(evmLux(evmDuskBalance), language)}
              /> DUSK
            {:else}
              {isConnected ? "checking" : "connect a wallet"}
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
          From your DuskEVM account <b title={evmAddress}
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
      {#if readAmount(amount, language).question}
        <!-- Either of two: a tap on one puts it in the field. -->
        <AmountQuestion
          className="swap-error"
          {language}
          on:choose={(event) => {
            amount = event.detail;
            isMaxAmount = false;
          }}
          text={amount}
        />
      {:else if problem}
        <p class="swap-error" role="alert">{problem}</p>
      {:else if leavesTooLittle}
        <p class="swap-error" role="status">
          Too little left {keepForLater.why}.
        </p>
      {:else if isDepositing && keepForLater.lux > 0n && amountLux > 0n && unshieldedBalance - totalDepositLux === keepForLater.lux}
        <p class="swap-note">
          Max leaves {formatFee(keepForLater.lux, language, { max: true })} DUSK
          {keepForLater.why}.
        </p>
      {:else if isMaxAmount && isMaxLower}
        <p class="swap-note" role="status">
          The network fee went up, so Max is less now.
        </p>
      {:else if amount !== "" && amountLux > 0n && isConnected && !isBalanceSufficient}
        <p class="swap-error" role="alert">
          {isDepositing
            ? "Not enough public balance for the amount and fee."
            : evmDuskBalance
              ? "Not enough on DuskEVM for the amount and gas."
              : "Checking your DuskEVM balance…"}
        </p>
      {/if}
    </div>

    <div class="swap-flip">
      {#if canFlip}
        <button
          aria-label="Swap From and To"
          class="swap-flip__button"
          on:click={flip}
          type="button"><Icon path={mdiArrowDown} /></button
        >
      {:else}
        <span aria-hidden="true"><Icon path={mdiArrowDown} /></span>
      {/if}
    </div>

    <div class="swap-panel">
      <div class="swap-panel__head">
        <span class="swap-panel__label">To</span>
        <NetworkPicker
          choices={toChoices}
          on:pick={({ detail }) => pickRoute({ to: detail })}
          side="To"
          title="Where it goes"
          value={destinationNetwork}
        />
      </div>
      <div class="swap-amount">
        <output
          class:swap-amount__empty={amountLux === 0n}
          for="bridge-amount"
          style:--figure-width={figureWidth(arrivingText)}
          >{arrivingText}</output
        >
        <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
      </div>
      <div class="swap-foot">
        <span>You receive</span>
        {#if isDepositing && incomingDepositLux > 0n}
          <span class="swap-foot__value"
            >+ <BalanceValue
              exact={formatDuskExact(incomingDepositLux, language)}
              hidden={false}
              value={formatDusk(incomingDepositLux, language)}
            /> DUSK on its way</span
          >
        {/if}
      </div>
      {#if isWithdrawing}
        <p class="swap-recipient">To your public balance</p>
      {:else if evmAddress}
        <p class="swap-recipient">
          To your DuskEVM account <b title={evmAddress}
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
        ><Icon path={mdiClockOutline} /><span class="swap-route__sum"
          ><span>{routeLine}</span>{#if route}<RouteStatusLine
              {amountLux}
              {route}
            />{/if}</span
        ><Icon
          className="swap-route__chevron section-chevron"
          path={mdiChevronDown}
        /></summary
      >
      <dl>
        {#if isDepositing}
          <div>
            <dt>Leaves your public balance</dt>
            <dd>
              up to {formatFee(totalDepositLux, language, { max: true })} DUSK
            </dd>
          </div>
        {:else}
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
    <!-- As Send's review: rows of what goes where and what it costs, one
      button, what can't be undone, then Back. -->
    <div class="route-review">
      <SectionHead>Review</SectionHead>
      <ReviewWallet />
      <dl class="route-review__rows">
        <div>
          <dt>Amount</dt>
          <dd>
            {formatDuskExact(amountLux, language)} DUSK
          </dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>
            <span class="route-review__name"
              >{isDepositing ? "Public account" : "DuskEVM"}</span
            >
            <FullAddress
              address={(isDepositing ? unshieldedAddress : address) ?? ""}
            />
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>
            <span class="route-review__name"
              >{isDepositing ? "DuskEVM" : "Your public account"}</span
            >
            <FullAddress
              address={(isDepositing ? address : unshieldedAddress) ?? ""}
            />
          </dd>
        </div>
        {#if isDepositing}
          <div>
            <dt>Fee up to</dt>
            <dd>{formatFee(fee, language, { max: true })} DUSK</dd>
          </div>
        {:else if withdrawalFeeWei !== null}
          <div>
            <dt>Fee on DuskEVM, up to</dt>
            <dd>
              {formatFee(withdrawalFeeBound(withdrawalFeeWei), language, {
                max: true,
              })} DUSK
            </dd>
          </div>
        {/if}
      </dl>
      {#if isDepositing}
        <dl class="route-review__rows route-review__rows--total">
          <div>
            <dt>Total up to</dt>
            <dd>
              {formatTotal(totalDepositLux, unshieldedBalance, language)} DUSK
            </dd>
          </div>
        </dl>
      {:else}
        <Banner title={withdrawalNext} variant="info">
          <p>Each step on Dusk takes a small fee from your public balance.</p>
        </Banner>
      {/if}
      <!-- The named contract a deposit calls, for whoever checks it: closed. -->
      {#if isDepositing && depositContract}
        <details class="route-review__details">
          <summary>Details</summary>
          <dl class="route-review__rows">
            <div>
              <dt>Contract</dt>
              <dd>
                <span class="route-review__name"
                  >{contractLabel(depositContract, networkName) ||
                    "DuskEVM bridge"}</span
                >
                <span class="route-review__code" title={depositContract}
                  >{shortenAddress(depositContract)}</span
                >
              </dd>
            </div>
          </dl>
        </details>
      {/if}
      {#if isShortOfFee && !isMaxAmount && evmDuskBalance}
        <p class="route-review__final" role="alert">
          Not enough DUSK on DuskEVM for this and its network fee: you have {formatDuskExact(
            evmLux(evmDuskBalance),
            language,
          )} DUSK.
        </p>
      {/if}
      {#if isWithdrawing && !withdrawalQuote}
        {#if isQuoteMissing}
          <p class="route-review__final" role="alert">
            Couldn't work out the network fee.
          </p>
          <Button
            className="route-review__back"
            on:click={prepareWithdrawalReview}
            text="Try again"
            variant="secondary"
          />
        {:else}
          <p class="route-review__final" role="status">
            Working out the network fee…
          </p>
        {/if}
      {/if}
      <Button
        className="route-review__primary"
        confirm
        disabled={isNextButtonDisabled ||
          !isConnected ||
          (isWithdrawing && !withdrawalQuote) ||
          isShortOfFee}
        icon={{ path: mdiArrowUpBoldBoxOutline, position: "before" }}
        on:click={send}
        text={isShortOfFee
          ? "Not enough DUSK"
          : `Bridge ${formatDuskExact(amountLux, language)} DUSK`}
        variant="primary"
      />
      <p class="route-review__final">Can't be undone.</p>
      <Button
        className="route-review__back"
        icon={{ path: mdiArrowLeft }}
        on:click={edit}
        text="Back"
        variant="secondary"
      />
    </div>
  {:else if isDepositing}
    <div class="bridge-result">
      <DepositResult
        onRetry={tryAgain}
        onSeen={keepSeenDeposit}
        {operation}
        what={`${formatDuskExact(amountLux, language)} DUSK to DuskEVM`}
      />
    </div>
  {:else}
    <div class="bridge-result">
      <OperationResult
        describeError={(error) =>
          describeFailure(error, { checkFirst: CHECK_EVM_WALLET_FIRST })}
        errorMessage="Bridging failed"
        {operation}
        pendingMessage="Sending"
        successMessage="Withdrawal sent"
      >
        <svelte:fragment slot="success-content" let:result={hash}>
          <p>{withdrawalNext}</p>
          <ArrivalNotice />
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
        <svelte:fragment slot="error-actions" let:error>
          {#if describeFailure(error).canRetry}
            <Button on:click={tryAgain} text="Try again" variant="primary" />
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

  .bridge__none {
    margin: 0;
    padding: 1rem 0.5rem;
    color: var(--calm-muted);
  }

  .bridge-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
  }
</style>
