type Contract = {
	heading: string,
	icon: object,
	id: string,
	operations: Array<{icon: ButtonIconProp, id: string, label: string}>,
	statuses: Array<Status>
}

type Transaction = {
	amount: number,
	block: number,
	fee: number,
	hash: string,
	method: string
}
