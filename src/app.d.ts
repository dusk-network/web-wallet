type Contract = {
	heading: string,
	icon: object,
	id: string,
	operations: Array<{icon: ButtonIconProp, id: string, label: string, variant?: ButtonVariant}>,
	statuses: Array<Status>
}

type Transaction = {
	amount: number,
	block_height: number,
	direction: string,
	fee: number,
	id: string,
}

type StakeType = "stake" | "withdraw-stake" | "withdraw-rewards";
