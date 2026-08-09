import { Button } from "@/components/ui/button";

export interface FormActionsProps {
    loading?: boolean;
    submitLabel?: string;
    cancelLabel?: string;
    onCancel?(): void;
}

export function FormActions({
    loading = false,
    submitLabel = "Save",
    cancelLabel = "Cancel",
    onCancel,
}: FormActionsProps) {
    return (
        <div className="flex justify-end gap-2 pt-4 border-t">
            {onCancel && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                >
                    {cancelLabel}
                </Button>
            )}

            <Button
                type="submit"
                disabled={loading}
            >
                {submitLabel}
            </Button>
        </div>
    );
}
