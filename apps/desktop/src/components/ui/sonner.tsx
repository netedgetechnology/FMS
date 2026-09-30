import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

import { getToasterPlacement } from "@/components/layout/layoutMetrics"

// One global notification area for every toast (success / error /
// warning / info / loading) - see getToasterPlacement.
const placement = getToasterPlacement()

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      // Top centre of the content column, inside AppHeader's empty
      // centre (see getToasterPlacement): page content - titles,
      // subtitles, header actions - starts right below the 64px header,
      // so a toast placed below it would sit on top of every page title.
      // The horizontal shift over the content column is applied in
      // globals.css via --finance-toaster-center-shift.
      offset={{ top: placement.top }}
      mobileOffset={{ top: placement.top }}
      closeButton
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--finance-surface)",
          "--normal-text": "var(--finance-text)",
          "--normal-border": "var(--finance-border)",
          "--border-radius": "0.875rem",
          "--finance-toaster-center-shift": placement.centerShift,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
