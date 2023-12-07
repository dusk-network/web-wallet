import { Readable } from "svelte/store";

type TransactionsStoreContent = { transactions: Transaction[] };

type TransactionsStore = Readable<TransactionsStoreContent>;
