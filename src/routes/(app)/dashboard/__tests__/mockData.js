const now = new Date();

/** @type Transaction[] */
export default [{
	age: new Date(now.getTime() - 10 * 1000),
	block: 33455,
	fee: 1876,
	hash: "tg874534tddsghdtst54hdfh790h",
	type: 1
}, {
	age: new Date(now.getTime() - 60 * 1000),
	block: 33456,
	fee: 1876,
	hash: "tg874534tddsghdtst54hdfh791h",
	type: 1
}, {
	age: new Date(now.getTime() - 500 * 1000),
	block: 33457,
	fee: 1876,
	hash: "tg874534tddsghdtst54hdfh792h",
	type: 1
}];
