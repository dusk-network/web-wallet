# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Accept `.dusk` names as send recipients on mainnet and testnet [#965]
- Send to the shielded address a `.dusk` name publishes [#965]
- Show the profiles' verified `.dusk` names in the profile switcher and on the Receive page [#965]
- Show on the Review step whether a transfer is public or shielded [#965]
- Hide all balances behind •••• with an eye button next to the total balance, and remember the choice [#968]
- Follow each transaction on the Done screen until it completes or fails, with its hash, a copy button and the fee it was charged
- Say when the recipient entered isn't a valid address
- Lock a wallet with a password after 5 or 15 minutes without activity, or never, as set in Settings
- Hint at how strong a new password is
- Warn while a gas price or limit is typed outside its bounds
- Show a withdrawal's network fee and its two steps on Dusk before it is sent
- Label the Bridge amount, with the balance available and Use max
- Show the connected DuskEVM account in the Bridge
- Show the account's transaction history from the node's archive, kept in the browser
- Add a top bar with Home, History and Staking, the network, the profile and a search of names, addresses and transactions (Ctrl K)
- Add a History page: transactions by day in a table, with filters, each one's details and a CSV export
- Show the latest activity beside the balance on Home, with filters
- Say what the public, shielded and staking balances are on Home
- Add a tab bar and a row of round actions on phones
- Say at the top of a test network that test DUSK has no value
- Add Contacts, kept on this device: a name for an address or a `.dusk` name, the last activity and Send, with a check that a contact's `.dusk` name still points to its address, marked in the list and in Send once it moved
- Offer the people paid as contacts while there are none
- Name the wallet's own accounts in Send, without offering to save them as contacts
- Send to a person found with Ctrl K on Enter, and copy their address with Shift+Enter
- Say what a call to Dusk Domains did, name the contracts the wallet knows in a transaction's details, and show who sent it, its gas price, its nonce and a link to its block
- Ask before sending to a contact's `.dusk` name when it points to another address now
- Show a saved contact's name in the activity and the history, with its `.dusk` name second, and save a counterparty to the contacts from a transaction's details
- Save a recipient to the contacts from Send, pick a contact there, and take "Did you mean …?" for a mistyped name the wallet knows
- Stake with Sozu, a third party's liquid staking, from the least amount that gets stDUSK, and unstake from it, with the stDUSK a stake gets, Sozu's deposit fee and what is staked there
- Compare native and liquid staking side by side on the Staking page, with neither picked
- Add to a stake with Stake more
- Show in the history the DuskEVM address a bridge deposit went to, and a withdrawal's amount and when it can be claimed
- Say in Send's summary what a public send shows everyone, also on a phone's review
- Open the search with /, as with Ctrl K, unless typing in a field
- Offer alice.dusk for alice, or alice.dusk. with a dot after it, in Send and the search
- List in Bridge › Activity the withdrawals in the history, with their claim date and Claim, without an EVM wallet connected
- Say in liquid staking when Sozu has paused deposits or they can't be checked, and that a stake or an unstake can fail while it updates its pool
- Read Sozu's terms again before a stake is sent, and show them for another confirmation when they changed
- Show Sozu's fees in liquid staking: on deposits, on rewards, and none to unstake
- Say which `.dusk` name a registration registered, in the history and its details
- Say in a stake with Sozu's details what stDUSK it got
- Link the Terms of use and the Privacy policy under Settings › Support
- Show under the total balance what is staked, natively and with Sozu
- Show the exact most a transaction can cost beside its gas limit and price
- Say about what native staking and Sozu pay a year where you choose how to stake
- Migrate DUSK from BNB Smart Chain and Ethereum in the Bridge card
- Send DUSK to BNB Smart Chain from the Bridge card, to the connected wallet's address, less the 1 DUSK bridge fee
- Say when a route isn't running on this network
- List migrations and transfers to BNB Smart Chain in Bridge › Activity, until they're paid
- Keep History's filters in its address
- Open a block by its height from the search
- Find transactions in the search by memo, and by the label of their contract or account
- List this wallet's deposits to DuskEVM in Bridge › Activity without an EVM wallet, with when they arrived and where
- Say in Bridge › Activity whom a withdrawal pays, and list one that pays someone else and that this wallet hasn't proved under Sent to someone else, its step offered quietly
- Show when a deposit arrived on DuskEVM, and link its DuskEVM transaction, in its details
- Name the contract a deposit calls on its Review
- Name a name reservation after the registration that reveals it, else call it the first of two steps
- Refuse an unstake from Sozu too small to burn any stDUSK, saying the least

### Changed

- Show each Bridge and Migrate route's time for this network: DuskEVM's from its chains, migrations' as measured, and none where none is known
- Cut the Bridge and Migrate cards, reviews and results to what is needed to act
- Show Sozu's fees as its contract gives them: its cut of rewards and deposits in the staking comparison, and the deposit fee in the liquid staking summary
- Shorten and clarify the withdrawal statuses in the Bridge [#973]
- Migrate DuskEVM bridge flows to the current contracts and the published
  `@dusk/evm-sdk` beta [#946], [#948]
- Show each profile's `.dusk` name, or its shortened public account, under its label in the profile bar and switcher [#965]
- Give the address and the `.dusk` name on Receive their own copy buttons, replacing the Copy button [#965]
- Shorten warnings and notes, cut text that repeats what's already on screen, and drop "(Default)" from the first profile [#966]
- Name the public and shielded balances on the dashboard and Send, and show SCAN QR only with a camera [#966]
- Show the balance card on the dashboard only [#966]
- List the amount, network fee (max) and total (max) on Review in one style, without label icons [#966]
- Give each operation its own default and minimum gas limit, replacing
  `VITE_GAS_LIMIT_DEFAULT` and `VITE_GAS_LIMIT_LOWER` [#969]
- Show fees in DUSK, and before sending as the most they can cost
- Use the node's gas price by default, with one Custom gas switch for the price and the limit
- Open Settings with the preferences, and fold gas and the wallet creation block height under Advanced
- Call it the recovery phrase everywhere, and say to tap the words in order when checking it
- Keep the block height under Advanced when creating a wallet
- Sum up the terms before accepting them, with their own links to the Terms of Use and the Privacy Policy
- Offer Unlock only once a wallet is kept in the browser
- Name the eye button Show balances while balances are hidden
- Show a withdrawal's status once, and say DuskEVM instead of L2
- Swap the bridge direction with the arrow between From and To
- Offer only wallets when connecting to DuskEVM
- Turn the transaction history on unless `VITE_FEATURE_TRANSACTION_HISTORY` is `false`
- Fill the window instead of a fixed card, with a flow's buttons kept in view, above a phone's keyboard
- Give the wallet a calm look: neutral surfaces and pill buttons
- Call Allocate Shield
- Show addresses, hashes and block heights in Söhne Mono
- Show no money values or market data off mainnet
- Send from one page, with the summary beside the form, a review on phones, and a button that says what it sends
- Start Send with no amount, take one with at most 9 decimals as typed, with a decimal point or comma, and say what's wrong with it
- Show a Total at Max as the balance shows, rounded down, never more
- Say times are in your local time, with each one's own offset on hover, and keep a row's time and Public or Shielded on phones
- List a contact's activity by day
- Keep contact names out of the CSV export unless asked, and then in their own column
- Mark the rows not looked up yet in the export, say so above it, and leave undated rows out of a range of days
- Say Name found for a .dusk name, not Verified name
- Give each page its own title
- Close a transaction's details with Escape, back on its row
- Say in Send's summary which account it sends from, and on Receive what sharing an address shows
- Darken the hint grey to meet the contrast minimum
- Say on the Done screen what was sent to whom, with a link to its row in History, in a column with margins
- Show what is staked with Sozu next to what is staked natively, the ways to stake before their comparison, and Unstake and Claim only once something is staked
- Keep a contact's Save above a phone's keyboard, give Send a way back Home, and make phone tap targets 44 px
- Offer Unlock first when a wallet is kept in this browser
- Show amounts in one format, at most four decimals, and in full on hover, under review and in a transaction's details
- Round a fee up to four decimals when it is the most it can cost, and to the nearest when it was paid
- Show what is staked, its rewards and what can be staked on the Staking page, and why Unstake or Claim rewards can't be pressed
- Stake natively from one page with the minimum up front and nothing filled in, without the node notice step, and offer liquid staking under the minimum
- Show Bridge and Migrate as one card: From and To with their networks, the amount, what arrives, the route and one button, before an EVM wallet connects, with a way back Home
- Call the chains Migrate takes DUSK from Ethereum and BNB Smart Chain
- Set section heads in small Söhne Mono capitals between grey brackets, and labels and column heads in the same type
- Show the DUSK wordmark in the top bar, with WALLET on wide screens
- Show links in blue, and the focus ring in the same blue
- Shorten the Staking page's Choose how to stake to Stake
- Say on the Staking page that the rewards shown are the native stake's, and that what is staked with Sozu includes its rewards
- Say plainly what a stDUSK is worth and how it grows
- Say Shown in your local time, not Times in your local time
- Keep contacts encrypted, for the wallet that saved them only, and delete them on Reset
- Say plainly that a node for native staking needs keys made from this wallet's recovery phrase
- Give a withdrawal's claim date a line of its own in the activity, and in the history on phones
- Date a withdrawal's claim from its proof and its dispute game, in History, its details and Bridge › Activity, exact once the game has resolved, and say when the game is late or the proof must be made again
- Say before a proof how long after it a withdrawal can be claimed, and on one ready to prove from when it could be claimed if proved now
- Prove a withdrawal against a dispute game that has already resolved and that the Portal takes, where one covers it, so its claim date is exact
- Say that unstaking from Sozu pays the DUSK back in the same transaction, with no fee and no waiting
- Show what a stake with Sozu is worth now, once its deposit fee is off
- Give a stake with Sozu a gas limit of 5,000,000 and an unstake 10,000,000, and say that a failed call is charged its whole limit
- Leave a deposit's call on DuskEVM 200,000 gas, the DuskEVM SDK's default
- Show the contract a call went to under Technical details only
- Say that a stDUSK's worth usually rises with rewards, but can fall with a penalty
- Show the profile's `.dusk` name in the top bar below 976 px too, without `.dusk`, cut short where it doesn't fit
- Shorten the search's help to "Enter: open · Shift+Enter: copy"
- Say Sending… on the Done screen until the block is final, then when it was sent
- Name the network and profile buttons with what they show, for screen readers
- List deposits and withdrawals together in Bridge › Activity, what needs you first, each with its route, amount, date or claim date, and state
- Know the network by the chain ID its node gives, so a custom node gets that network's contracts, names and history
- Offer only the network's own chains when connecting an EVM wallet
- Name each contract in a transaction's details: Sozu pool, Sozu hub, DuskEVM bridge portal and the others
- Write dates in English, on your language's clock and with its digits
- Show amounts under 0.01 DUSK to two significant digits
- Shorten addresses and hashes with one ellipsis character
- Round the network fee paid in a transaction's details, with the exact fee under Technical details
- Open the Bridge on BNB Smart Chain's migration from Home's Migrate it to Dusk, shown only where a migration is running
- Link Run a node, to the docs on running one, where native staking says it needs your own node
- Link both sides of a bridge transfer in its details: Dusk's transactions in the network's Dusk explorer, DuskEVM's in its own
- Say "Not promised." after Sozu's yearly estimate, and work it out from the native estimate as shown
- Hide the DUSK of Sozu's deposit fee while balances are hidden
- Move Sozu's contract from the Liquid staking form to the summary's Edit
- Shorten IDs as the other Dusk apps do: Dusk's to six characters at each end, DuskEVM's to 0x and four at each end, an address with its checksum
- Call the exact fee under Technical details Fee paid
- Show the stDUSK a stake with Sozu got to four decimals, in full under Technical details
- Offer alice.dusk as alice is typed in Send, without calling it a wrong address
- Name transactions in the search as History does, with a call's method under the name
- Name the CSV export after the network, the profile and the local day, as the extension does
- Count a withdrawal's send on DuskEVM as the first of its three steps
- Call transfers to and from other chains in History by their chain, as the extension does, with the bridge's account named in their details, and list them under Bridge
- Update History when the public balance changes, and while a migration or a transfer out is under way
- Read the balance again as soon as History finds a new public transaction
- Retry History's requests when the node is busy
- Keep a shielded send's recipient in History
- Keep showing in History the amount a failed send tried to move

### Removed

- Remove the Migrate page, whose address now opens the Bridge
- Remove testnet's BEP-20 migration on Sepolia
- Remove the line about what a failed call to Sozu is charged

### Fixed

- Send nothing to Reown, WalletConnect or Coinbase, nor load their fonts, until Connect is pressed on the Bridge or Migrate page or a wallet was connected before, and leave out the Coinbase wallet SDKs and their telemetry
- Stop transaction attempts when prerequisite synchronization fails or is cancelled [#953].
- Prevent pending login migration or password setup from restoring reset wallet credentials [#953].
- Show the public spendable balance on Send while no valid recipient is entered [#965]
- Take Enter in the recipient field as Next, and drop the spaces and line breaks a pasted recipient brings
- Keep the last verified `.dusk` name in the profile switcher when looking it up fails
- Name the DUSK unit after amounts for screen readers
- Give controls on phones a tap area of at least 44 px
- Date a withdrawal found by its hash by its DuskEVM block, not by the lookup
- Say Nothing to unstake or claim beside the native stake, not under Unstake from Sozu
- Keep the top bar inside the window at every width from 320 px
- Open the network and profile menus inside the window on phones
- Forget the EVM wallets connected here on Reset, so none comes back and Bridge loads nothing from Reown after it
- Keep the labels in a staking summary on one line
- Say that no stake gets stDUSK while Sozu's deposit fee is 100%
- Keep the field typed in clear of a flow's buttons when the window or a phone's keyboard changes its height
- Give each page one heading with its name, and keep the top bar and the navigation out of its main content
- Look a `.dusk` name up once more before saying it couldn't be looked up
- Give the export's box, a contact's choice and the Bridge's Max a tap area of 44 px on phones
- Take amounts on the Shield page with your language's decimal separator
- Offer Claim on a DuskEVM withdrawal only once its claim date has come
- Show a deposit to DuskEVM as arrived once DuskEVM has its payment, where DuskEVM's adapter can't say
- Take amounts with a decimal comma in liquid and native staking
- Give the Bridge card's Max and the eye by the total balance a 44 px tap area on phones
- Give a deposit's time a line of its own in History on phones
- Forget the bridge's transfers and times on Reset, and another wallet's transfers on restoring a wallet
- Read contracts one at a time on a network without Multicall for Dusk, as devnet or a local node
- Name a `.dusk` name's records replaced as a records change in History
- Name a `.dusk` registration, and the reservation it reveals, only when its call checks out on the wallet's network
- Read a DuskEVM withdrawal in History only when it goes to Dusk's bridge
- Take a transfer to BNB Smart Chain as arrived only on a payout from the bridge's address
- Take a migration as paid only on a payout from its route's payout account
- Pay equal deposits to DuskEVM and equal transfers out one payment each, in the order they were sent, from any device
- Read a transfer out's memo as the bridge does: an address with nothing around it
- Wait for the archive to have every block a shielded history needs, rather than keep it incomplete
- Call a failed shield in History a shield, not a call of convert
- Show an unshield as shielded in History
- Offer Claim on a DuskEVM withdrawal only once its dispute game is read, resolved and taken by the Portal, and ask to prove it again when the challenger won the game or it was retired or blacklisted
- Prove a DuskEVM withdrawal only against a dispute game the Portal takes, and against an older resolved one after a rejected proof
- Offer no proof or claim for a DuskEVM withdrawal off the bridge's route, and no proof of one claimed or already proved by this account

## [1.8.0] - 2026-03-25

### Changed

- chore: dependency update to address newfound vulnerabilities [#939]

### Fixed

- fixed bug in `BigIntInput` input validation [#939]
- fixed `GasControls` reacting to `input` events instead of `change`s [#939]

## [1.7.3] - 2026-03-03

### Changed

- Updated `@dusk/w3sper` dependency to `1.6.0` for Rusk 1.6 compatibility.
- Updated bundled wallet core driver to `wallet_core-1.6.0.wasm`.

## [1.7.2] - 2026-02-18

### Fixed

- Fixed wrong logic for the `hasEnoughFunds` variable in allocate flow [#932]

## [1.7.1] - 2026-02-17

### Added

- Added spendable vs. total shielded balance label in allocate flow [#928]

## [1.7.0] - 2026-02-04

### Added

- Added EVM bridging interface dusk-network/rusk#3822
- Added EVM pending transaction screen dusk-network/rusk#3826
- Added EVM finalize transaction button dusk-network/rusk#3824
- Added EVM balance dusk-network/rusk#3821
- Added pending withdrawals badge on the bridge transaction history icon dusk-network/rusk#3953
- Added blocklist to block transfers to sanctioned, compromised or scam-related addresses dusk-network/rusk#3958

### Changed

- Update Transactions list design dusk-network/rusk#1922
- Withdrawal pending message explains status and shows finalization estimate dusk-network/rusk#3954
- Update dependencies to address potential security issues dusk-network/rusk#3982
- Replace `bip39` with `@scure/bip39`, which is an audited lib, for improved security dusk-network/rusk#3984

### Fixed

- Fixed incorrect DUSK balance formatting in Bridge view dusk-network/rusk#3927
- Fixed withdrawal flow no longer becomes unresponsive when attemping to withdraw more than available EVM balance dusk-network/rusk#3955

## [1.6.0] - 2025-06-13

### Added

- Add support for profile switching dusk-network/rusk#2083

## [1.5.0] - 2025-05-30

### Added

- Add BEP20 address and memo validation dusk-network/rusk#3746

### Fixed

- Fix polyfills not being loaded in time on Safari 16.3 dusk-network/rusk#3570

## [1.4.0] - 2025-03-04

### Added

- Add memo field to send flow dusk-network/rusk#3112
- Add "VITE_SYNC_INTERVAL" ENV variable dusk-network/rusk#3403

### Changed

- Auto-focus text field (Unlock page) dusk-network/rusk#3420

### Fixed

- Fix width discrepancy in footer icons dusk-network/rusk#3163
- Fix network methods not reusing the existing connection dusk-network/rusk#3486

## [1.3.0] - 2025-01-28

### Added

- Add support for partial unstake/claim rewards dusk-network/rusk#3009
- Add "Unstake" flow validation dusk-network/rusk#3009
- Store the wallet creation block height and show it in settings dusk-network/rusk#3381

### Changed

- Change Review step label to "Overview" (Send flow) dusk-network/rusk#3387

### Removed

- Remove gas settings from Overview step (Stake/Unstake flows) dusk-network/rusk#3009

### Fixed

- Fix creation of a new wallet causing the sync to start from genesis dusk-network/rusk#3362

## [1.2.0] - 2025-01-16

### Added

- Add ephemeral encryption to secure the seed while in memory dusk-network/rusk#3354

### Changed

- Ensure connected wallet is disconnected when closing the app dusk-network/rusk#3269
- Update Wallet Access terminology dusk-network/rusk#3356

### Removed

- Remove version number from app title dusk-network/rusk#3339

### Fixed

- Fix Migration UI sometimes stuck while loading balance dusk-network/rusk#3269
- Fix Reown modal's disconnect failing to disconnect dusk-network/rusk#3269

## [1.1.0] - 2025-01-09

### Changed

- Make Password setting enabled by default (Create/Restore Wallet flow) dusk-network/rusk#3287

### Removed

- Remove "Swap to nDUSK" step (Create Wallet flow) dusk-network/rusk#3333

## [1.0.0] - 2024-12-23

### Added

- Add "VITE_REOWN_PROJECT_ID" ENV variable dusk-network/rusk#3267
- Add additional notices to the Migrate flow dusk-network/rusk#3267

### Changed

- Prioritize Public Account in the interface and transaction flows dusk-network/rusk#3259
- Enhance Migrate flow layout, aligning it to the rest of the transaction-based flows dusk-network/rusk#3267
- Display the Migration Requirements details using the `Banner` component dusk-network/rusk#3267
- Update the Approval Success copy for clarity (Migrate flow) dusk-network/rusk#3267
- Trigger sync after a successful migration dusk-network/rusk#3267
- Disable source wallet option on migration initialization (Migrate flow) dusk-network/rusk#3270

### Removed

- Remove Beta ribbon dusk-network/rusk#3164
- Remove "UsageIndicator" component dusk-network/rusk#3245
- Remove "VITE_FEATURE_MOONLIGHT_TRANSACTIONS" flag dusk-network/rusk#3246

### Fixed

- Fix wrong error shown in the login screen dusk-network/rusk#3226 dusk-network/rusk#3097
- Fix wallet not waiting for the Wasm to load at startup dusk-network/rusk#3238
- Fix Public address icon in Receive flow dusk-network/rusk#3259
- Fix Public account icon hover text (Balance component) dusk-network/rusk#3259
- Fix labels in Stepper not displaying properly dusk-network/rusk#3265

## [0.10.1] - 2024-12-18

### Fixed

- Fix gas settings reset and validation in preferences dusk-network/rusk#3212

## [0.10.0] - 2024-12-17

### Added

- Add notice for stake maturity dusk-network/rusk#2981
- Add capability to maintain cache consistency in case of rejected blocks dusk-network/rusk#3156
- Add button to reset gas settings to their defaults dusk-network/rusk#3178

### Changed

- Reword "Staking" header to "Stake" dusk-network/rusk#3113
- Upgrade Migration Feature to Use Reown AppKit dusk-network/rusk#3129
- Update default gas settings values dusk-network/rusk#3178
- Update AddressPicker to show Default Profile label dusk-network/rusk#3179
- Enhanced migration workflow, activated new migration contracts dusk-network/rusk#3203

### Removed

- Remove "Network" section from Settings dusk-network/rusk#3160

### Fixed

- Fix dark mode button not being in sync with the stored value dusk-network/rusk#3178
- Fix `BigIntInput` properties not being reactive dusk-network/rusk#3178

## [0.9.0] - 2024-12-03

### Added

- Add "Support" section under Settings dusk-network/rusk#3071
- Add user feedback for "Send" flow validation dusk-network/rusk#3098
- Add validation for self-referential transactions dusk-network/rusk#3099

### Changed

- Reword "Withdraw Rewards" operation to "Claim Rewards" dusk-network/rusk#3076
- Reword "Shield/Unshield" operation to "Allocate" dusk-network/rusk#3081
- Update `@media` rules to remove outer padding on small screens dusk-network/rusk#2945

### Removed

- Remove "Shield More Dusk" CTA (Send flow) dusk-network/rusk#3073

### Fixed

- Fix "passphrase" terminology usage with "Mnemonic Phrase" dusk-network/rusk#3069
- Fix "Stake" flow validation dusk-network/rusk#3089

## [0.8.1] - 2024-11-26

### Added

- Add "Reset Wallet" explanatory copy (Settings) dusk-network/rusk#3061

### Changed

- Update stake warning's text dusk-network/rusk#3028

### Fixed

- Fix UI not scrolling to top after wizard and sub-route navigation dusk-network/rusk#2997
- Fix edge case in Dusk to Lux conversion dusk-network/rusk#3032
- Fix inconsistent terminology usage for "Mnemonic Phrase" dusk-network/rusk#3035
- Fix auto-sync not working after restoring a wallet dusk-network/rusk#3042
- Fix application crash on empty amount (Stake Flow) dusk-network/rusk#3036
- Fix incorrect fee deduction and negative UI display (Allocate flow) dusk-network/rusk#3056
- Fix button hover style in Dashboard Navigation Menu dusk-network/rusk#2999
- Fix balance overflowing on small screens dusk-network/rusk#2994

## [0.8.0] - 2024-11-19

### Added

- Added gas settings validation on Unstake / Withdraw Rewards flows dusk-network/rusk#2000
- Add temporary link to the block explorer on the dashboard dusk-network/rusk#2882
- Add Staking-Related Functionality Utilizing w3sper dusk-network/rusk#3006
- Add minimum stake amount supplied by w3sper instead of using an env var dusk-network/rusk#3010

### Changed

- Update `Stake` to use `Stepper` dusk-network/rusk#2436
- Update Mnemonic (Authenticate) Enter key behavior dusk-network/rusk#2879
- Enhance Error Handling on Wallet Access Page dusk-network/rusk#2932

### Fixed

- Suggested words in the Mnemonic (Authenticate) are accessible using Tab dusk-network/rusk#2879
- Enhance Allocate flow on full amount allocation dusk-network/rusk#2938
- Broken link in the stake warning dusk-network/rusk#2990
- Change "Transaction created" copy dusk-network/rusk#2991
- Fix Dashboard navigation menu padding dusk-network/rusk#3000

## [0.7.0] - 2024-11-11

### Added

- Added allocation (shield/unshield) page and UI dusk-network/rusk#2196
- Add auto-sync every five minutes dusk-network/rusk#2880
- Integrate Allocate UI with w3sper's SDK to enable Allocate functionalities dusk-network/rusk#2920

### Changed

- Update Balance component dusk-network/rusk#2863
- Update UI labels dusk-network/rusk#2888

### Fixed

- Fix web-wallet crashing after setting high gas price dusk-network/rusk#2878

## [0.6.0] - 2024-11-05

### Added

- Show current block height on Wallet Creation dusk-network/rusk#1561
- Add option to sync from a custom block height on Wallet Restoration dusk-network/rusk#1568
- Added token migration contract bindings dusk-network/rusk#2014
- Add validation for public account ("Send" flow) dusk-network/rusk#2176
- Add validation for "Use Max" button on Send / Stake flows dusk-network/rusk#2310
- Add Banner component dusk-network/rusk#2696
- Add BigIntInput component dusk-network/rusk#2776
- Add transaction history feature flag dusk-network/rusk#2807

### Changed

- Newly created Wallet does not sync from genesis dusk-network/rusk#1567
- Update Buttons to match the design system dusk-network/rusk#1606
- Update anchor colors to ensure better accessibility dusk-network/rusk#1765
- Update font-display to swap for custom fonts to improve performance dusk-network/rusk#2026
- Update `Stepper` component to new design dusk-network/rusk#2071
- Update dashboard to use routes instead of Tabs for navigation pattern dusk-network/rusk#2075
- Update `Send` to use `Stepper` dusk-network/rusk#2110
- Update dashboard by splitting the transfer operations into send and receive operations dusk-network/rusk#2175
- Update Balance UI to include an optional UsageIndicator for Moonlight tokens dusk-network/rusk#2234
- Restrict mnemonic step input to alphabetical characters (Restore Flow) dusk-network/rusk#2355
- Update `Send` to include allocation button dusk-network/rusk#2420
- Receive screen design updated, added UI support for displaying shielded/unshielded address dusk-network/rusk#2421
- Update ENV variables to the `VITE_FEATURE_*` naming convention dusk-network/rusk#2434
- Make address field only vertically resizable (Send flow) dusk-network/rusk#2435
- Update textfield input to use the small control sizing dusk-network/rusk#2498
- Update GasSettings and related properties to BigInt type dusk-network/rusk#2778
- Update to w3sper.js beta dusk-network/rusk#2821
- Update sync and balance to use w3sper.js dusk-network/rusk#2608
- Update login flows to use w3sper.js dusk-network/rusk#2460

### Removed

- Hide staking in the deployed wallet application until w3sper.js supports this.
- Hide transaction history in the deployed application until w3sper.js supports this.

### Fixed

- Fix Receive tab content overflows dusk-network/rusk#1901
- Add missing "Soehne Mono" and its @font-face definition dusk-network/rusk#2071
- The sync promise should be set to null after aborting a sync dusk-network/rusk#2118
- Fix rounding errors in migration amount input dusk-network/rusk#2303
- Fix number of leading zeros in migration amount input dusk-network/rusk#2406
- Fix Address field invalid state modifier not being applied dusk-network/rusk#2532

## [0.5.0] - 2024-03-27

### Added

- Add dark mode support dusk-network/rusk#1466
- Add autocomplete attribute on the login field dusk-network/rusk#1533

### Changed

- Change ribbon's label color dusk-network/rusk#1598
- Update font family and letter spacing in buttons, textboxes and selects dusk-network/rusk#1565
- Update copy on Reset Wallet while syncing dusk-network/rusk#1552
- Trigger the Restore flow if a user tries to access a new wallet dusk-network/rusk#1535
- Clear the login info storage on "Reset Wallet" (Settings) dusk-network/rusk#1551
- Update `OperationResult` to infer error messages from arbitrary values dusk-network/rusk#1524
- Update Tabs to use native scroll behavior dusk-network/rusk#1320

### Fixed

- Fix copy button appearance (AddressPicker component) dusk-network/rusk#1591
- Fix keydown behavior (AddressPicker component) dusk-network/rusk#1576
- Data load and sync UI appearing at the same time dusk-network/rusk#1545
- Fix error message overflowing in `ErrorDetails` component dusk-network/rusk#1547
- Fix missing focus border on switch component dusk-network/rusk#1537

## [0.4.0] - 2024-03-13

### Added

- Add message when no contracts have been enabled dusk-network/rusk#1317
- Add `eslint-config-prettier` as explicit dependency dusk-network/rusk#1509
- Add format check to CI and `checks` script dusk-network/rusk#1504
- Add `vitest-canvas-mock` dependency to replace `canvas` dusk-network/rusk#1506
- Add `AppImage` component dusk-network/rusk#1284
- Add possibility to serve the web wallet from a sub folder dusk-network/rusk#1362

### Changed

- Update to SvelteKit 2, Vite 5 and Vitest 1 dusk-network/rusk#1284
- Update all dependencies dusk-network/rusk#1284
- Refactor `mockReadableStore` to be not be writable dusk-network/rusk#1285
- Refactor beta notice as constant dusk-network/rusk#1469
- Refactor `settingsStore` and create readable `gasStore` to store `limitLower`, `limitUpper`, `priceLower` dusk-network/rusk#1308
- Refactor add Prettier for formatting and format all files dusk-network/rusk#1458

### Removed

- Remove box-shadow from components dusk-network/rusk#1519
- Remove orphan dependency `@zerodevx/svelte-toast` dusk-network/rusk#1509
- Remove `canvas` dependency dusk-network/rusk#1506
- Remove DAT file UI references dusk-network/rusk#1498
- Remove `mockDerivedStore` dusk-network/rusk#1285
- Remove extraneous code block in MnemonicAuthenticate dusk-network/rusk#1470
- Remove `limitLower`, `limitUpper`, `priceLower` from `settingsStore` dusk-network/rusk#1308

### Fixed

- Fix layout shift (Balance component) dusk-network/rusk#1514
- Fix animation not visible on landing screen dusk-network/rusk#1501
- Mismatch between param and JSDoc param's type definition (OperationResult.spec.js) dusk-network/rusk#1471
- Fix gas limits update on ENV change dusk-network/rusk#1308

## [0.3.0] - 2024-02-28

### Added

- Add Create Wallet flow tests dusk-network/rusk#1443
- Add visible version, commit hash and build date dusk-network/rusk#1441
- Add Address validation (Transfer flow) dusk-network/rusk#1377

### Changed

- Change Get Quote API Endpoint to env variable dusk-network/rusk#1311

### Removed

- Remove the use of `checkValidity()` in Send and Stake flow amounts validity checks dusk-network/rusk#1391

### Fixed

- Fix typo in routes/welcome/\_\_tests\_\_/page.spec.js dusk-network/rusk#1445
- Fix missing whitespace when Transaction list is empty dusk-network/rusk#1460

## [0.2.1] - 2024-02-20

### Added

- Add wallet restore flow tests dusk-network/rusk#1416
- Add missing login flow tests dusk-network/rusk#1423

### Fixed

- Fix restore flow allowing invalid mnemonic to be used to log in dusk-network/rusk#1416
- Fix can't unlock the wallet with upper case words dusk-network/rusk#1417

## [0.2.0] - 2024-02-15

### Added

- Add running node requirement notice in Staking flow dusk-network/rusk#1359
- Add `fiatPrice` optional property to Balance component dusk-network/rusk#1323
- Add ability to revert words when entering the mnemonic phrase dusk-network/rusk#1290
- Add missing error handling when querying the quote API dusk-network/rusk#1322
- Add gas settings validation to settings page dusk-network/rusk#1352
- Add forced log out on inactive tabs dusk-network/rusk#1373
- Add gas settings validation to block Send and Stake operations if invalid gas settings dusk-network/rusk#1354
- Add abortable sync dusk-network/rusk#1401
- Add `existing wallet notice` to wallet create, restore and login flows dusk-network/rusk#1360
- Add `userId` value to localStorage preferences object during wallet create and restore dusk-network/rusk#1360

### Changed

- Change Holdings component design dusk-network/rusk#1361
- Change `fiatCurrency`, `locale`, `tokenCurrency`, `token` to required properties in Balance component dusk-network/rusk#1323
- Change `package.json` fields to reflect repo change dusk-network/rusk#1367
- Change `walletStore.js` to receive gasPrice and gasLimit when `transfer` , `stake`, `unstake` and `withdrawRewards` are called dusk-network/rusk#1353
- Update deprecated Node actions in CI dusk-network/rusk#1343
- Change `setGasSettings` event to `gasSettings` and include `isValidGas` property in event data dusk-network/rusk#1354
- Change "withdraw stake" label to "unstake" dusk-network/rusk#1403
- Change logout flow to abort a sync if in progress dusk-network/rusk#1401
- Update dusk-wallet-js to from 0.3.2 to 0.4.2 dusk-network/rusk#1401

### Removed

- Remove `fiat` property from Balance component dusk-network/rusk#1323
- Remove `gasSettings` store update from `dashboard/+page.svelte.js` dusk-network/rusk#1353

### Fixed

- Fix Transactions table remains hidden for some screen resolutions dusk-network/rusk#1412
- Fix Stake button is always disabled dusk-network/rusk#1410
- Fix wizard progression on Stake flow dusk-network/rusk#1398
- Fix Seed Phrase words size dusk-network/rusk#1335
- Fix colors on red background dusk-network/rusk#1334
- Fix Transactions table design dusk-network/rusk#1309

## [0.1.0-beta] - 2024-02-02

### Added

- Add initial commit

<!-- ISSUES -->

dusk-network/rusk#1284: https://github.com/dusk-network/rusk/issues/1284
dusk-network/rusk#1285: https://github.com/dusk-network/rusk/issues/1285
dusk-network/rusk#1290: https://github.com/dusk-network/rusk/issues/1290
dusk-network/rusk#1308: https://github.com/dusk-network/rusk/issues/1308
dusk-network/rusk#1309: https://github.com/dusk-network/rusk/issues/1309
dusk-network/rusk#1311: https://github.com/dusk-network/rusk/issues/1311
dusk-network/rusk#1317: https://github.com/dusk-network/rusk/issues/1317
dusk-network/rusk#1320: https://github.com/dusk-network/rusk/issues/1320
dusk-network/rusk#1322: https://github.com/dusk-network/rusk/issues/1322
dusk-network/rusk#1323: https://github.com/dusk-network/rusk/issues/1323
dusk-network/rusk#1334: https://github.com/dusk-network/rusk/issues/1334
dusk-network/rusk#1335: https://github.com/dusk-network/rusk/issues/1335
dusk-network/rusk#1343: https://github.com/dusk-network/rusk/issues/1343
dusk-network/rusk#1352: https://github.com/dusk-network/rusk/issues/1352
dusk-network/rusk#1353: https://github.com/dusk-network/rusk/issues/1353
dusk-network/rusk#1354: https://github.com/dusk-network/rusk/issues/1354
dusk-network/rusk#1359: https://github.com/dusk-network/rusk/issues/1359
dusk-network/rusk#1360: https://github.com/dusk-network/rusk/issues/1360
dusk-network/rusk#1361: https://github.com/dusk-network/rusk/issues/1361
dusk-network/rusk#1362: https://github.com/dusk-network/rusk/issues/1362
dusk-network/rusk#1367: https://github.com/dusk-network/rusk/issues/1367
dusk-network/rusk#1373: https://github.com/dusk-network/rusk/issues/1373
dusk-network/rusk#1377: https://github.com/dusk-network/rusk/issues/1377
dusk-network/rusk#1391: https://github.com/dusk-network/rusk/issues/1391
dusk-network/rusk#1398: https://github.com/dusk-network/rusk/issues/1398
dusk-network/rusk#1401: https://github.com/dusk-network/rusk/issues/1401
dusk-network/rusk#1403: https://github.com/dusk-network/rusk/issues/1403
dusk-network/rusk#1410: https://github.com/dusk-network/rusk/issues/1410
dusk-network/rusk#1412: https://github.com/dusk-network/rusk/issues/1412
dusk-network/rusk#1416: https://github.com/dusk-network/rusk/issues/1416
dusk-network/rusk#1417: https://github.com/dusk-network/rusk/issues/1417
dusk-network/rusk#1423: https://github.com/dusk-network/rusk/issues/1423
dusk-network/rusk#1441: https://github.com/dusk-network/rusk/issues/1441
dusk-network/rusk#1443: https://github.com/dusk-network/rusk/issues/1443
dusk-network/rusk#1445: https://github.com/dusk-network/rusk/issues/1445
dusk-network/rusk#1458: https://github.com/dusk-network/rusk/issues/1458
dusk-network/rusk#1460: https://github.com/dusk-network/rusk/issues/1460
dusk-network/rusk#1466: https://github.com/dusk-network/rusk/issues/1466
dusk-network/rusk#1469: https://github.com/dusk-network/rusk/issues/1469
dusk-network/rusk#1470: https://github.com/dusk-network/rusk/issues/1470
dusk-network/rusk#1471: https://github.com/dusk-network/rusk/issues/1471
dusk-network/rusk#1498: https://github.com/dusk-network/rusk/issues/1498
dusk-network/rusk#1501: https://github.com/dusk-network/rusk/issues/1501
dusk-network/rusk#1504: https://github.com/dusk-network/rusk/issues/1504
dusk-network/rusk#1506: https://github.com/dusk-network/rusk/issues/1506
dusk-network/rusk#1509: https://github.com/dusk-network/rusk/issues/1509
dusk-network/rusk#1514: https://github.com/dusk-network/rusk/issues/1514
dusk-network/rusk#1519: https://github.com/dusk-network/rusk/issues/1519
dusk-network/rusk#1524: https://github.com/dusk-network/rusk/issues/1524
dusk-network/rusk#1533: https://github.com/dusk-network/rusk/issues/1533
dusk-network/rusk#1535: https://github.com/dusk-network/rusk/issues/1535
dusk-network/rusk#1537: https://github.com/dusk-network/rusk/issues/1537
dusk-network/rusk#1545: https://github.com/dusk-network/rusk/issues/1545
dusk-network/rusk#1547: https://github.com/dusk-network/rusk/issues/1547
dusk-network/rusk#1551: https://github.com/dusk-network/rusk/issues/1551
dusk-network/rusk#1552: https://github.com/dusk-network/rusk/issues/1552
dusk-network/rusk#1561: https://github.com/dusk-network/rusk/issues/1561
dusk-network/rusk#1565: https://github.com/dusk-network/rusk/issues/1565
dusk-network/rusk#1567: https://github.com/dusk-network/rusk/issues/1567
dusk-network/rusk#1568: https://github.com/dusk-network/rusk/issues/1568
dusk-network/rusk#1576: https://github.com/dusk-network/rusk/issues/1576
dusk-network/rusk#1591: https://github.com/dusk-network/rusk/issues/1591
dusk-network/rusk#1598: https://github.com/dusk-network/rusk/issues/1598
dusk-network/rusk#1606: https://github.com/dusk-network/rusk/issues/1606
dusk-network/rusk#1765: https://github.com/dusk-network/rusk/issues/1765
dusk-network/rusk#1901: https://github.com/dusk-network/rusk/issues/1901
dusk-network/rusk#1922: https://github.com/dusk-network/rusk/issues/1922
dusk-network/rusk#2026: https://github.com/dusk-network/rusk/issues/2026
dusk-network/rusk#2000: https://github.com/dusk-network/rusk/issues/2000
dusk-network/rusk#2014: https://github.com/dusk-network/rusk/issues/2014
dusk-network/rusk#2071: https://github.com/dusk-network/rusk/issues/2071
dusk-network/rusk#2075: https://github.com/dusk-network/rusk/issues/2075
dusk-network/rusk#2083: https://github.com/dusk-network/rusk/issues/2083
dusk-network/rusk#2110: https://github.com/dusk-network/rusk/issues/2110
dusk-network/rusk#2118: https://github.com/dusk-network/rusk/issues/2118
dusk-network/rusk#2175: https://github.com/dusk-network/rusk/issues/2175
dusk-network/rusk#2176: https://github.com/dusk-network/rusk/issues/2176
dusk-network/rusk#2196: https://github.com/dusk-network/rusk/issues/2196
dusk-network/rusk#2234: https://github.com/dusk-network/rusk/issues/2234
dusk-network/rusk#2303: https://github.com/dusk-network/rusk/issues/2303
dusk-network/rusk#2310: https://github.com/dusk-network/rusk/issues/2310
dusk-network/rusk#2355: https://github.com/dusk-network/rusk/issues/2355
dusk-network/rusk#2406: https://github.com/dusk-network/rusk/issues/2406
dusk-network/rusk#2420: https://github.com/dusk-network/rusk/issues/2420
dusk-network/rusk#2421: https://github.com/dusk-network/rusk/issues/2421
dusk-network/rusk#2434: https://github.com/dusk-network/rusk/issues/2434
dusk-network/rusk#2435: https://github.com/dusk-network/rusk/issues/2435
dusk-network/rusk#2436: https://github.com/dusk-network/rusk/issues/2436
dusk-network/rusk#2460: https://github.com/dusk-network/rusk/issues/2460
dusk-network/rusk#2498: https://github.com/dusk-network/rusk/issues/2498
dusk-network/rusk#2532: https://github.com/dusk-network/rusk/issues/2532
dusk-network/rusk#2696: https://github.com/dusk-network/rusk/issues/2696
dusk-network/rusk#2608: https://github.com/dusk-network/rusk/issues/2608
dusk-network/rusk#2776: https://github.com/dusk-network/rusk/issues/2776
dusk-network/rusk#2778: https://github.com/dusk-network/rusk/issues/2778
dusk-network/rusk#2807: https://github.com/dusk-network/rusk/issues/2807
dusk-network/rusk#2821: https://github.com/dusk-network/rusk/issues/2821
dusk-network/rusk#2863: https://github.com/dusk-network/rusk/issues/2863
dusk-network/rusk#2878: https://github.com/dusk-network/rusk/issues/2878
dusk-network/rusk#2879: https://github.com/dusk-network/rusk/issues/2879
dusk-network/rusk#2880: https://github.com/dusk-network/rusk/issues/2880
dusk-network/rusk#2882: https://github.com/dusk-network/rusk/issues/2882
dusk-network/rusk#2888: https://github.com/dusk-network/rusk/issues/2888
dusk-network/rusk#2920: https://github.com/dusk-network/rusk/issues/2920
dusk-network/rusk#2932: https://github.com/dusk-network/rusk/issues/2932
dusk-network/rusk#2938: https://github.com/dusk-network/rusk/issues/2938
dusk-network/rusk#2945: https://github.com/dusk-network/rusk/issues/2945
dusk-network/rusk#2981: https://github.com/dusk-network/rusk/issues/2981
dusk-network/rusk#2990: https://github.com/dusk-network/rusk/issues/2990
dusk-network/rusk#2991: https://github.com/dusk-network/rusk/issues/2991
dusk-network/rusk#2994: https://github.com/dusk-network/rusk/issues/2994
dusk-network/rusk#2997: https://github.com/dusk-network/rusk/issues/2997
dusk-network/rusk#2999: https://github.com/dusk-network/rusk/issues/2999
dusk-network/rusk#3000: https://github.com/dusk-network/rusk/issues/3000
dusk-network/rusk#3006: https://github.com/dusk-network/rusk/issues/3006
dusk-network/rusk#3009: https://github.com/dusk-network/rusk/issues/3009
dusk-network/rusk#3010: https://github.com/dusk-network/rusk/issues/3010
dusk-network/rusk#3028: https://github.com/dusk-network/rusk/issues/3028
dusk-network/rusk#3032: https://github.com/dusk-network/rusk/issues/3032
dusk-network/rusk#3035: https://github.com/dusk-network/rusk/issues/3035
dusk-network/rusk#3036: https://github.com/dusk-network/rusk/issues/3036
dusk-network/rusk#3042: https://github.com/dusk-network/rusk/issues/3042
dusk-network/rusk#3056: https://github.com/dusk-network/rusk/issues/3056
dusk-network/rusk#3061: https://github.com/dusk-network/rusk/issues/3061
dusk-network/rusk#3069: https://github.com/dusk-network/rusk/issues/3069
dusk-network/rusk#3071: https://github.com/dusk-network/rusk/issues/3071
dusk-network/rusk#3073: https://github.com/dusk-network/rusk/issues/3073
dusk-network/rusk#3076: https://github.com/dusk-network/rusk/issues/3076
dusk-network/rusk#3081: https://github.com/dusk-network/rusk/issues/3081
dusk-network/rusk#3097: https://github.com/dusk-network/rusk/issues/3097
dusk-network/rusk#3098: https://github.com/dusk-network/rusk/issues/3098
dusk-network/rusk#3099: https://github.com/dusk-network/rusk/issues/3099
dusk-network/rusk#3112: https://github.com/dusk-network/rusk/issues/3112
dusk-network/rusk#3113: https://github.com/dusk-network/rusk/issues/3113
dusk-network/rusk#3129: https://github.com/dusk-network/rusk/issues/3129
dusk-network/rusk#3156: https://github.com/dusk-network/rusk/issues/3156
dusk-network/rusk#3160: https://github.com/dusk-network/rusk/issues/3160
dusk-network/rusk#3163: https://github.com/dusk-network/rusk/issues/3163
dusk-network/rusk#3164: https://github.com/dusk-network/rusk/issues/3164
dusk-network/rusk#3178: https://github.com/dusk-network/rusk/issues/3178
dusk-network/rusk#3179: https://github.com/dusk-network/rusk/issues/3179
dusk-network/rusk#3203: https://github.com/dusk-network/rusk/issues/3203
dusk-network/rusk#3212: https://github.com/dusk-network/rusk/issues/3212
dusk-network/rusk#3226: https://github.com/dusk-network/rusk/issues/3226
dusk-network/rusk#3238: https://github.com/dusk-network/rusk/issues/3238
dusk-network/rusk#3245: https://github.com/dusk-network/rusk/issues/3245
dusk-network/rusk#3259: https://github.com/dusk-network/rusk/issues/3259
dusk-network/rusk#3265: https://github.com/dusk-network/rusk/issues/3265
dusk-network/rusk#3267: https://github.com/dusk-network/rusk/issues/3267
dusk-network/rusk#3269: https://github.com/dusk-network/rusk/issues/3269
dusk-network/rusk#3270: https://github.com/dusk-network/rusk/issues/3270
dusk-network/rusk#3287: https://github.com/dusk-network/rusk/issues/3287
dusk-network/rusk#3333: https://github.com/dusk-network/rusk/issues/3333
dusk-network/rusk#3339: https://github.com/dusk-network/rusk/issues/3339
dusk-network/rusk#3354: https://github.com/dusk-network/rusk/issues/3354
dusk-network/rusk#3356: https://github.com/dusk-network/rusk/issues/3356
dusk-network/rusk#3362: https://github.com/dusk-network/rusk/issues/3362
dusk-network/rusk#3381: https://github.com/dusk-network/rusk/issues/3381
dusk-network/rusk#3387: https://github.com/dusk-network/rusk/issues/3387
dusk-network/rusk#3403: https://github.com/dusk-network/rusk/issues/3403
dusk-network/rusk#3420: https://github.com/dusk-network/rusk/issues/3420
dusk-network/rusk#3486: https://github.com/dusk-network/rusk/issues/3486
dusk-network/rusk#3570: https://github.com/dusk-network/rusk/issues/3570
dusk-network/rusk#3746: https://github.com/dusk-network/rusk/issues/3746
dusk-network/rusk#3821: https://github.com/dusk-network/rusk/issues/3821
dusk-network/rusk#3822: https://github.com/dusk-network/rusk/issues/3822
dusk-network/rusk#3824: https://github.com/dusk-network/rusk/issues/3824
dusk-network/rusk#3826: https://github.com/dusk-network/rusk/issues/3826
dusk-network/rusk#3927: https://github.com/dusk-network/rusk/issues/3927
dusk-network/rusk#3953: https://github.com/dusk-network/rusk/issues/3953
dusk-network/rusk#3954: https://github.com/dusk-network/rusk/issues/3954
dusk-network/rusk#3955: https://github.com/dusk-network/rusk/issues/3955
dusk-network/rusk#3958: https://github.com/dusk-network/rusk/issues/3958
dusk-network/rusk#3982: https://github.com/dusk-network/rusk/issues/3982
dusk-network/rusk#3984: https://github.com/dusk-network/rusk/issues/3984
[#928]: https://github.com/dusk-network/web-wallet/issues/928
[#932]: https://github.com/dusk-network/web-wallet/issues/932
[#939]: https://github.com/dusk-network/web-wallet/issues/939
[#946]: https://github.com/dusk-network/web-wallet/issues/946
[#948]: https://github.com/dusk-network/web-wallet/issues/948
[#953]: https://github.com/dusk-network/web-wallet/pull/953
[#965]: https://github.com/dusk-network/web-wallet/issues/965
[#966]: https://github.com/dusk-network/web-wallet/issues/966
[#968]: https://github.com/dusk-network/web-wallet/issues/968
[#969]: https://github.com/dusk-network/web-wallet/issues/969
[#973]: https://github.com/dusk-network/web-wallet/pull/973

<!-- VERSIONS -->

[Unreleased]: https://github.com/dusk-network/web-wallet/tree/main
[1.8.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.8.0
[1.7.3]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.7.3
[1.7.2]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.7.2
[1.7.1]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.7.1
[1.7.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.7.0
[1.6.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.6.0
[1.5.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.5.0
[1.4.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.4.0
[1.3.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.3.0
[1.2.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.2.0
[1.1.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.1.0
[1.0.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.0.0
[0.10.1]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.10.1
[0.10.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.10.0
[0.9.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.9.0
[0.8.1]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.8.1
[0.8.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.8.0
[0.7.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.7.0
[0.6.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.6.0
[0.5.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v0.5.0
[0.4.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-0.4.0
[0.3.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-0.3.0
[0.2.1]: https://github.com/dusk-network/web-wallet/tree/web-wallet-0.2.1
[0.2.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-0.2.0
[0.1.0-beta]: https://github.com/dusk-network/web-wallet/tree/web-wallet-0.1.0-beta
