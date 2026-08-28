export const SETTINGS_KEYS = {
    WORKSPACE_NAME: "general.workspace_name",
    DEFAULT_CURRENCY: "general.default_currency",
    DATE_FORMAT: "general.date_format",
    FIRST_DAY_OF_WEEK: "general.first_day_of_week",

    THEME: "display.theme",
    DENSITY: "display.density",
    NUMBER_FORMAT: "display.number_format",
} as const;

export const SETTINGS_DEFAULTS = {
    [SETTINGS_KEYS.WORKSPACE_NAME]: "Personal",
    [SETTINGS_KEYS.DEFAULT_CURRENCY]: "USD",
    [SETTINGS_KEYS.DATE_FORMAT]: "DD/MM/YYYY",
    [SETTINGS_KEYS.FIRST_DAY_OF_WEEK]: "MONDAY",

    [SETTINGS_KEYS.THEME]: "LIGHT",
    [SETTINGS_KEYS.DENSITY]: "COMFORTABLE",
    [SETTINGS_KEYS.NUMBER_FORMAT]: "STANDARD",
} as const;

export const DATE_FORMAT_OPTIONS = [
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];

export const FIRST_DAY_OPTIONS = [
    { value: "MONDAY", label: "Monday" },
    { value: "SUNDAY", label: "Sunday" },
];

export const THEME_OPTIONS = [
    { value: "LIGHT", label: "Light" },
    { value: "DARK", label: "Dark" },
    { value: "SYSTEM", label: "System" },
];

export const DENSITY_OPTIONS = [
    { value: "COMFORTABLE", label: "Comfortable" },
    { value: "COMPACT", label: "Compact" },
];

export const NUMBER_FORMAT_OPTIONS = [
    { value: "STANDARD", label: "Standard" },
    { value: "INDIAN", label: "Indian" },
];
