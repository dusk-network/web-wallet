import { PRICE_CURRENCIES } from "@dusk-network/app-core/amounts";

/** What each currency is called here. */
const NAMES = Object.freeze({
  AED: "United Arab Emirates Dirham",
  ARS: "Argentine Peso",
  AUD: "Australian Dollar",
  BDT: "Bangladeshi Taka",
  BHD: "Bahraini Dinar",
  BMD: "Bermudian Dollar",
  BRL: "Brazilian Real",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CLP: "Chilean Peso",
  CNY: "Renminbi",
  CZK: "Czech Koruna",
  DKK: "Danish Krone",
  EUR: "Euro",
  GBP: "Pound Sterling",
  GEL: "Georgian Lari",
  HKD: "Hong Kong Dollar",
  HUF: "Hungarian Forint",
  IDR: "Indonesian Rupiah",
  ILS: "Israeli New Shekel",
  INR: "Indian Rupee",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  KWD: "Kuwaiti Dinar",
  LKR: "Sri Lankan Rupee",
  MMK: "Myanmar Kyat",
  MXN: "Mexican Peso",
  MYR: "Malaysian Ringgit",
  NGN: "Nigerian Naira",
  NOK: "Norwegian Krone",
  NZD: "New Zealand Dollar",
  PHP: "Philippine Peso",
  PKR: "Pakistani Rupee",
  PLN: "Polish Złoty",
  RUB: "Russian Ruble",
  SAR: "Saudi Riyal",
  SEK: "Swedish Krona",
  SGD: "Singapore Dollar",
  THB: "Thai Baht",
  TRY: "Turkish Lira",
  TWD: "New Taiwan Dollar",
  UAH: "Ukrainian Hryvnia",
  USD: "United States Dollar",
  VND: "Vietnamese Dồng",
  ZAR: "South African Rand",
});

/**
 * The currencies the wallet's amounts can be shown in: those CoinGecko gives
 * DUSK's price in (app-core's `PRICE_CURRENCIES`), by code.
 *
 * @type {ReadonlyArray<{ code: string, currency: string }>}
 */
const currencies = Object.freeze(
  PRICE_CURRENCIES.map((code) => ({
    code,
    currency: NAMES[/** @type {keyof typeof NAMES} */ (code)] ?? code,
  }))
);

export default currencies;
