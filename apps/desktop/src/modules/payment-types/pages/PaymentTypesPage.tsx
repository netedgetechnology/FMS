import { PageHeader, SectionCard } from "@/components/common";

import { PaymentTypeManager } from "../components";

// The one Payment Type management page (sidebar -> Payment Type, and
// Settings -> Payment Types links here). It hosts the single
// PaymentTypeManager - there is no other copy of it anywhere.
export default function PaymentTypesPage() {
    return (
        <div className="space-y-6">
            <PageHeader
                title="Payment Types"
                subtitle="Master data: the payment types you can choose throughout FinWea. Add your own, rename or deactivate them here - no other change is needed."
            />

            <SectionCard title="Payment Type List">
                <PaymentTypeManager />
            </SectionCard>
        </div>
    );
}
