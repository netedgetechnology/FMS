export const SETTING_KEYS = {
    WORKSPACE_NAME: "workspace.name",
    DEFAULT_CURRENCY: "general.default_currency",
    DATE_FORMAT: "general.date_format",
    FIRST_DAY_OF_WEEK: "general.first_day_of_week",
    THEME: "display.theme",
    COMPACT_MODE: "display.compact_mode",
    SHOW_DECIMALS: "display.show_decimals",
} as const;

export const DEFAULT_SETTINGS = {
    [SETTING_KEYS.WORKSPACE_NAME]: "Personal",
    [SETTING_KEYS.DEFAULT_CURRENCY]: "INR",
    [SETTING_KEYS.DATE_FORMAT]: "DD/MM/YYYY",
    [SETTING_KEYS.FIRST_DAY_OF_WEEK]: "Monday",
    [SETTING_KEYS.THEME]: "System",
    [SETTING_KEYS.COMPACT_MODE]: "false",
    [SETTING_KEYS.SHOW_DECIMALS]: "true",
} as const;
