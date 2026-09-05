import { useRef } from "react";
import { toast } from "sonner";
import {
    IconUserCircle,
    IconCamera,
    IconLoader2,
    IconDeviceFloppy,
    IconCalendarTime,
    IconClockHour4,
} from "@tabler/icons-react";

import PageHeader from "@/components/common/PageHeader";
import SectionCard from "@/components/common/SectionCard";
import { FormField, FormGrid } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/core/formatting/useDateFormatter";

import { useProfile } from "../hooks/useProfile";

const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;

export default function ProfilePage() {
    const {
        profile,
        account,
        loading,
        saving,
        saved,
        error,
        updateField,
        saveProfile,
    } = useProfile();

    const formatDate = useDateFormatter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    function handlePhotoButtonClick() {
        fileInputRef.current?.click();
    }

    function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";

        if (!file) {
            return;
        }

        if (!file.type.startsWith("image/")) {
            return;
        }

        if (file.size > MAX_AVATAR_FILE_SIZE) {
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            if (typeof reader.result === "string") {
                updateField("avatar", reader.result);
            }
        };

        reader.readAsDataURL(file);
    }

    async function handleSave() {
        const success = await saveProfile();

        if (success) {
            toast.success("Profile updated successfully.");
        }
    }

    if (loading) {
        return (
            <div>
                <PageHeader
                    title="Profile"
                    subtitle="Manage your personal information and account details."
                />

                <div className="flex min-h-[360px] items-center justify-center">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <IconLoader2
                            size={18}
                            className="animate-spin"
                        />
                        Loading profile...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                title="Profile"
                subtitle="Manage your personal information and account details."
            />

            {error && (
                <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="space-y-5">

                <SectionCard title="Profile Information">
                    <div className="space-y-6">

                        <div className="flex items-center gap-4">
                            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F0EAFE] text-[#7C3AED]">
                                {profile.avatar ? (
                                    <img
                                        src={profile.avatar}
                                        alt="Profile"
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <IconUserCircle size={34} stroke={1.6} />
                                )}
                            </div>

                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handlePhotoChange}
                                />

                                <button
                                    type="button"
                                    onClick={handlePhotoButtonClick}
                                    className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    <IconCamera size={16} />
                                    Change Photo
                                </button>

                                <p className="mt-1.5 text-xs text-slate-500">
                                    JPG or PNG, up to 2MB.
                                </p>
                            </div>
                        </div>

                        <FormGrid>
                            <FormField label="Full Name" htmlFor="profile-full-name">
                                <Input
                                    id="profile-full-name"
                                    value={profile.fullName}
                                    onChange={(event) =>
                                        updateField("fullName", event.target.value)
                                    }
                                    placeholder="e.g. Hardik Acharya"
                                />
                            </FormField>

                            <FormField label="Display Name" htmlFor="profile-display-name">
                                <Input
                                    id="profile-display-name"
                                    value={profile.displayName}
                                    onChange={(event) =>
                                        updateField("displayName", event.target.value)
                                    }
                                    placeholder="Name shown across FinanceOS"
                                />
                            </FormField>

                            <FormField label="Email Address" htmlFor="profile-email">
                                <Input
                                    id="profile-email"
                                    type="email"
                                    value={profile.email}
                                    onChange={(event) =>
                                        updateField("email", event.target.value)
                                    }
                                    placeholder="you@example.com"
                                />
                            </FormField>

                            <FormField label="Phone Number" htmlFor="profile-phone">
                                <Input
                                    id="profile-phone"
                                    type="tel"
                                    value={profile.phone}
                                    onChange={(event) =>
                                        updateField("phone", event.target.value)
                                    }
                                    placeholder="Optional"
                                />
                            </FormField>
                        </FormGrid>

                    </div>
                </SectionCard>

                <SectionCard title="Personal Information">
                    <div className="space-y-6">

                        <FormGrid>
                            <FormField label="Date of Birth" htmlFor="profile-dob">
                                <Input
                                    id="profile-dob"
                                    type="date"
                                    value={profile.dateOfBirth}
                                    onChange={(event) =>
                                        updateField("dateOfBirth", event.target.value)
                                    }
                                />
                            </FormField>

                            <FormField label="Country" htmlFor="profile-country">
                                <Input
                                    id="profile-country"
                                    value={profile.country}
                                    onChange={(event) =>
                                        updateField("country", event.target.value)
                                    }
                                    placeholder="Optional"
                                />
                            </FormField>

                            <FormField label="City" htmlFor="profile-city">
                                <Input
                                    id="profile-city"
                                    value={profile.city}
                                    onChange={(event) =>
                                        updateField("city", event.target.value)
                                    }
                                    placeholder="Optional"
                                />
                            </FormField>
                        </FormGrid>

                        <FormField label="Address" htmlFor="profile-address">
                            <Textarea
                                id="profile-address"
                                value={profile.address}
                                onChange={(event) =>
                                    updateField("address", event.target.value)
                                }
                                placeholder="Optional"
                                className="min-h-20"
                            />
                        </FormField>

                        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                            <span className="text-sm text-slate-500">
                                {saving
                                    ? "Saving changes..."
                                    : saved
                                        ? "All changes saved"
                                        : "Unsaved changes"}
                            </span>

                            <Button
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={saving || saved}
                                className="h-10 rounded-xl px-5"
                            >
                                {saving ? (
                                    <IconLoader2
                                        size={16}
                                        className="animate-spin"
                                    />
                                ) : (
                                    <IconDeviceFloppy size={16} />
                                )}

                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>

                    </div>
                </SectionCard>

                <SectionCard title="Account Information">
                    <div className="grid gap-5 sm:grid-cols-3">

                        <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <IconCalendarTime size={18} stroke={1.8} />
                            </div>

                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Account Created
                                </div>

                                <div className="mt-0.5 text-sm font-medium text-slate-900">
                                    {account.createdAt
                                        ? formatDate(account.createdAt)
                                        : "—"}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <IconClockHour4 size={18} stroke={1.8} />
                            </div>

                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Last Updated
                                </div>

                                <div className="mt-0.5 text-sm font-medium text-slate-900">
                                    {account.lastUpdated
                                        ? formatDate(account.lastUpdated)
                                        : "—"}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Account Status
                                </div>

                                <div className="mt-1.5">
                                    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                        {account.status}
                                    </span>
                                </div>
                            </div>
                        </div>

                    </div>
                </SectionCard>

            </div>
        </div>
    );
}
