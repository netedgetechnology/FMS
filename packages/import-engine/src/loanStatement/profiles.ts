// Optional lender adapters. The generic engine runs first and needs none of
// them; a profile may only add label synonyms for one lender's wording or
// refine a finished extraction. The engine ships with no profiles.

import type { FacilityBase, FieldId } from "./types";
import type { StatementDocument } from "./layout";

export interface LenderProfile {
    id: string;
    appliesTo(document: StatementDocument): boolean;
    /** Extra normalised-label patterns, tried alongside the generic ones. */
    labelAliases?: Partial<Record<FieldId, RegExp[]>>;
    /** Runs after generic extraction; must return facts the document states. */
    refine?(facility: FacilityBase, document: StatementDocument): FacilityBase;
}

export function selectProfile(
    document: StatementDocument,
    profiles: readonly LenderProfile[]
): LenderProfile | null {
    return profiles.find(profile => profile.appliesTo(document)) ?? null;
}
