"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { getDefaultShortcut } from "@/lib/shortcuts"
import {
  formatShortcutKeys,
  formatShortcutKeysAria,
} from "@/lib/shortcuts/format"
import { useEffectiveShortcut } from "@/components/shortcuts/use-effective-shortcut"
import {
  DIALOG_PRIMARY_ACTION_SHORTCUT_ID,
  isDialogPrimaryAction,
  useDialogPrimaryActionSlot,
  type DialogPrimaryActionDeclaration,
} from "./dialog-primary-action"

/**
 * A dialog's primary action owes a chord and a visible hint (BUG-049).
 *
 * `primaryAction` is REQUIRED and is a union: the action, or `{ none }` plus
 * a written reason. A dialog therefore cannot be born with an unreachable
 * Send button — the same shape the command verb manifest uses one layer out.
 * `DialogFooter` renders the declared action itself, so the button, the chord
 * and the hint on its face all come from one declaration and cannot disagree.
 */
interface DialogPrimaryActionScope {
  declaration: DialogPrimaryActionDeclaration
  /** Set by whichever descendant printed the chord, so a declared action that
   *  advertises nothing is caught in development rather than in the hands of
   *  the operator who cannot find it. */
  /** Call from the hint's commit phase. A context value may not be mutated. */
  publish: () => void
}

const DialogPrimaryActionContext =
  React.createContext<DialogPrimaryActionScope | null>(null)

/** The manifest's own default, used until the registry has loaded the
 *  operator's overrides. The hint is therefore on the button from the first
 *  paint: it never appears late, so it never moves the button under a hand. */
function dialogPrimaryActionDefaultKeys() {
  const declared = getDefaultShortcut(DIALOG_PRIMARY_ACTION_SHORTCUT_ID)
  if (!declared) {
    throw new Error(
      `Command verb manifest is missing ${DIALOG_PRIMARY_ACTION_SHORTCUT_ID}`
    )
  }
  return declared.keys
}

/** The chord the operator has bound, or the manifest default. */
function useDialogPrimaryActionKeys() {
  return (
    useEffectiveShortcut(DIALOG_PRIMARY_ACTION_SHORTCUT_ID) ??
    dialogPrimaryActionDefaultKeys()
  )
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "exa-overlay-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50",
        className
      )}
      {...props}
    />
  )
}

type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  showCloseButton?: boolean
  /** REQUIRED (BUG-049): the one action this dialog exists to take, or
   *  `{ none: '<why not>' }`. */
  primaryAction: DialogPrimaryActionDeclaration
}

/**
 * Rendered INSIDE the Radix content, so it mounts exactly when the dialog is
 * on screen. Registering the primary action from `DialogContent` itself would
 * publish it while the dialog is closed — every provider-level `<Dialog>` in
 * the tree renders its content element whether or not it is open — and ⌘⏎
 * would then press a Send button nobody can see.
 */
function DialogPrimaryActionScopeProvider({
  declaration,
  children,
}: {
  declaration: DialogPrimaryActionDeclaration
  children: React.ReactNode
}) {
  const spec = isDialogPrimaryAction(declaration) ? declaration : null
  useDialogPrimaryActionSlot(spec)
  const published = React.useRef(false)
  // The provider owns the ref and exposes a stable callback. Handing the ref
  // itself through context and mutating it downstream is what
  // `react-hooks/immutability` rejects, in render or in an effect.
  const publish = React.useCallback(() => {
    published.current = true
  }, [])
  const scope = React.useMemo<DialogPrimaryActionScope>(
    () => ({ declaration, publish }),
    [declaration, publish]
  )
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production" || !spec || published.current) {
      return
    }
    console.error(
      "A dialog declared a primary action and printed no chord. Render it " +
        "through DialogFooter, or place DialogPrimaryActionHint on the button " +
        "that runs it."
    )
  }, [spec])
  return (
    <DialogPrimaryActionContext.Provider value={scope}>
      {children}
    </DialogPrimaryActionContext.Provider>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  primaryAction,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "exa-material-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      >
        <DialogPrimaryActionScopeProvider declaration={primaryAction}>
          {children}
        </DialogPrimaryActionScopeProvider>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

/**
 * The dialog's primary button, rendered from the declaration on
 * `DialogContent` rather than hand-composed per dialog. It prints the chord
 * that presses it on its own face — the register the ⌘W close confirm
 * established with `Close ⏎` — so the keyboard path and the button can never
 * drift apart. macOS default-button placement: last in the footer, rightmost.
 */
function DialogPrimaryButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  const scope = React.useContext(DialogPrimaryActionContext)
  const keys = useDialogPrimaryActionKeys()
  if (!scope || !isDialogPrimaryAction(scope.declaration)) return null
  const declaration = scope.declaration
  return (
    <Button
      data-slot="dialog-primary-action"
      type="button"
      variant={declaration.destructive ? "destructive" : "default"}
      onClick={declaration.run}
      disabled={declaration.disabled}
      aria-label={declaration.ariaLabel}
      aria-keyshortcuts={formatShortcutKeysAria(keys)}
      className={className}
      {...props}
    >
      {declaration.label}
      <DialogPrimaryActionHint />
    </Button>
  )
}

/**
 * The chord, printed where the action is. A dialog whose primary button is
 * its own bespoke chrome renders this inside that button instead of taking
 * `DialogPrimaryButton` whole; either way the glyph comes from the registry,
 * so a rebind moves it and it can never state a chord that does not work.
 *
 * It occupies its space unconditionally — the manifest default stands in
 * until the operator's overrides load — so it never appears late and never
 * shifts the button under a hand already moving toward it.
 */
function DialogPrimaryActionHint({
  className,
}: {
  className?: string
}) {
  const scope = React.useContext(DialogPrimaryActionContext)
  const keys = useDialogPrimaryActionKeys()
  // Publish in the commit phase rather than during render. A render React
  // discards must not claim the chord was shown, and mutating a ref while
  // rendering is what `react-hooks/immutability` rejects. Child effects run
  // before parent effects, so this still lands before the provider's
  // dev-only check reads it.
  React.useEffect(() => {
    scope?.publish()
  }, [scope])
  if (!scope || !isDialogPrimaryAction(scope.declaration)) return null
  return (
    <span
      aria-hidden
      data-slot="dialog-primary-action-hint"
      className={cn("font-mono text-chrome-micro opacity-75", className)}
    >
      {formatShortcutKeys(keys)}
    </span>
  )
}

function DialogFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimaryButton />
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogPrimaryActionHint,
  DialogPrimaryButton,
  DialogTitle,
  DialogTrigger,
}
export type { DialogPrimaryActionDeclaration } from "./dialog-primary-action"
