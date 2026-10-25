type ContractDescriptor = {
  enabled: boolean;
  id: string;
  label: string;
  operations: ContractOperation[];
};

type ContractGasSettings = {
  gasLimit: bigint;
  gasPrice: bigint;
};

type GasOperation =
  | "allocate"
  | "bridge"
  | "claim-rewards"
  | "public-transfer"
  | "shield"
  | "shielded-transfer"
  | "stake"
  | "unshield"
  | "unstake";

type ContractOperation = {
  disabled: boolean;
  id: string;
  label: string;
  primary: boolean;
};

type ContractStatus = {
  label: string;
  value: string | null;
};

type StakeType = "stake" | "unstake" | "claim-rewards";
