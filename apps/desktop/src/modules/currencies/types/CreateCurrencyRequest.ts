export interface CreateCurrencyRequest {
    code: string;

    name: string;

    symbol: string;

    isDefault?: boolean;
}
