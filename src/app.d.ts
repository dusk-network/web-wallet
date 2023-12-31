type Contract = {
	heading: string,
	icon: object,
	id: string,
	operations: Array<{icon: ButtonIconProp, id: string, label: string, variant?: ButtonVariant, disabled?: boolean}>,
	statuses: Array<Status>
}

type Transaction = {
	amount: number,
	block_height: number,
	direction: string,
	fee: number,
	id: string,
	tx_type: string
}

type StakeType = "stake" | "withdraw-stake" | "withdraw-rewards";

type WalletStakeInfo = {
	amount: number,
	reward: number,
	has_key: boolean,
	has_staked: boolean
}
