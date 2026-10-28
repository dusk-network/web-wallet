/**
 * Contracts or operations disabled here will stay
 * disabled regardless of other conditions like
 * the sync status.
 *
 * @type {ContractDescriptor[]}
 */
export default [
  {
    enabled: import.meta.env.VITE_FEATURE_TRANSFER === "true",
    id: "send",
    label: "Send",
    operations: [],
  },
  {
    enabled: import.meta.env.VITE_FEATURE_TRANSFER === "true",
    id: "receive",
    label: "Receive",
    operations: [],
  },
  {
    enabled: import.meta.env.VITE_FEATURE_STAKE === "true",
    id: "stake",
    label: "Stake",
    operations: [
      {
        disabled: false,
        id: "stake",
        label: "Stake",
        primary: true,
      },
      {
        disabled: false,
        id: "unstake",
        label: "Unstake",
        primary: false,
      },
      {
        disabled: false,
        id: "claim-rewards",
        label: "Claim rewards",
        primary: false,
      },
    ],
  },
  {
    enabled: import.meta.env.VITE_FEATURE_ALLOCATE === "true",
    id: "allocate",
    label: "Shield",
    operations: [
      {
        disabled: false,
        id: "send",
        label: "Send",
        primary: true,
      },
    ],
  },
  {
    // Migrations into Dusk are routes of the Bridge, as moving DUSK to
    // DuskEVM and out to BNB Smart Chain are.
    enabled:
      (import.meta.env.VITE_FEATURE_BRIDGE === "true" ||
        import.meta.env.VITE_FEATURE_MIGRATE === "true") &&
      import.meta.env.VITE_REOWN_PROJECT_ID !== "",
    id: "bridge",
    label: "Bridge",
    operations: [
      {
        disabled: false,
        id: "connect",
        label: "Connect",
        primary: true,
      },
    ],
  },
];
