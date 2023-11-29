/**
 * Creates a locale aware currency formatter for fiat or DUSK
 *
 * @param {String} locale A BCP 47 language tag
 * @param {String} currency An ISO 4217 currency or "DUSK"
 * @returns {(value: number | bigint) => string}
 */
const createFormatter = (locale, currency) => {
	const formatter = currency.toUpperCase() === "DUSK"
		? new Intl.NumberFormat(locale, { minimumFractionDigits: 2 })
		: new Intl.NumberFormat(locale, { currency: currency, style: "currency" });

	return value => formatter.format(value);
};

export default createFormatter;
