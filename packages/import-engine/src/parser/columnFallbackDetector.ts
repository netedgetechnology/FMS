import type {
    ColumnMappingField,
    DetectedColumn,
} from "./columnDetector";

interface FallbackRule {
    field: ColumnMappingField;
    confidence: "medium" | "low";
    patterns: RegExp[];
}

const FALLBACK_RULES: FallbackRule[] = [
    {
        field: "date",
        confidence: "medium",
        patterns: [
            /\btxn\b.*\bdate\b/i,
            /\btran\b.*\bdate\b/i,
            /\btransaction\b.*\bdate\b/i,
            /\bposting\b.*\bdate\b/i,
            /\bvalue\b.*\bdate\b/i,
        ],
    },
    {
        field: "description",
        confidence: "medium",
        patterns: [
            /\btxn\b.*\bdesc/i,
            /\btran\b.*\bdesc/i,
            /\bnarrative\b/i,
            /\bparticular/i,
            /\bremarks?\b/i,
            /\bdetails?\b/i,
        ],
    },
    {
        field: "payee",
        confidence: "medium",
        patterns: [
            /\bpayee\b/i,
            /\bmerchant\b/i,
            /\bbeneficiar/i,
            /\brecipient\b/i,
        ],
    },
    {
        field: "debit",
        confidence: "medium",
        patterns: [
            /\bdebit\b.*\bamt/i,
            /\bwithdrawal\b.*\bamt/i,
            /\bwithdrawn\b/i,
            /\bdr\b.*\bamt/i,
        ],
    },
    {
        field: "credit",
        confidence: "medium",
        patterns: [
            /\bcredit\b.*\bamt/i,
            /\bdeposit\b.*\bamt/i,
            /\bdeposited\b/i,
            /\bcr\b.*\bamt/i,
        ],
    },
    {
        field: "type",
        confidence: "medium",
        patterns: [
            /\btxn\b.*\btype\b/i,
            /\btran\b.*\btype\b/i,
            /\bdebit\b.*\bcredit\b/i,
            /\bdr\b.*\bcr\b/i,
        ],
    },
    {
        field: "referenceNumber",
        confidence: "medium",
        patterns: [
            /\bchq\b.*\bref\b/i,
            /\bcheque\b.*\bref\b/i,
            /\bcheck\b.*\bref\b/i,
            /\bref\b.*\bno\b/i,
            /\bref\b.*\bnum/i,
            /\btransaction\b.*\bid\b/i,
            /\btxn\b.*\bid\b/i,
            /\butr\b/i,
        ],
    },
];

export function detectFallbackColumn(
    header: string
): DetectedColumn | null {
    const matches =
        FALLBACK_RULES.filter(rule =>
            rule.patterns.some(
                pattern =>
                    pattern.test(header)
            )
        );

    if (matches.length !== 1) {
        return null;
    }

    const rule = matches[0];

    if (!rule) {
        return null;
    }

    return {
        header,
        field: rule.field,
        confidence: rule.confidence,
    };
}
