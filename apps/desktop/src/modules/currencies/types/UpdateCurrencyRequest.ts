export interface UpdateCurrencyRequest {
    id: string;

    code: string;

    name: string;

    symbol: string;

    isDefault: boolean;
}
