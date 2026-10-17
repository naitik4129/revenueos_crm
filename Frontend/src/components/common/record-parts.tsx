import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Copy, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Shared parts of the HubSpot-style record pages (contact, company). */

/** "‹ Contacts" strip above a record. */
export function BackLink({
  to,
  children,
}: {
  to: "/contacts" | "/companies" | "/deals";
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 border-b bg-card px-4 py-2">
      <Link
        to={to}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {children}
      </Link>
    </div>
  );
}

/** Initials in a circle (people) or a rounded square (companies). */
export function Avatar({
  name,
  square,
  className,
}: {
  name: string;
  square?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center bg-primary/10 text-[11px] font-semibold text-primary",
        square ? "rounded-md" : "rounded-full",
        className,
      )}
    >
      {initials(name || "?")}
    </span>
  );
}

/** A titled card in the record page's side columns. */
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex min-h-11 items-center justify-between border-b px-4 py-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

/** Round icon + label, HubSpot-style; a link when `href` is set. */
export function QuickAction({
  icon: Icon,
  label: text,
  onClick,
  href,
  disabledReason,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string | undefined;
  disabledReason?: string | undefined;
}) {
  const body = (
    <>
      <span className="grid size-9 place-items-center rounded-full border bg-background text-primary group-hover:bg-primary group-hover:text-primary-foreground group-disabled:text-muted-foreground group-disabled:group-hover:bg-background">
        <Icon className="size-4" />
      </span>
      <span className="text-[11px]">{text}</span>
    </>
  );
  const className =
    "group flex flex-col items-center gap-1 rounded-md py-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
  return href && !disabledReason ? (
    <a
      href={href}
      className={className}
      {...(/^https?:/.test(href) ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={Boolean(disabledReason)}
      title={disabledReason}
      aria-label={disabledReason ? `${text} (${disabledReason})` : text}
    >
      {body}
    </button>
  );
}

export function MenuItem({
  children,
  danger,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
        danger && "text-destructive",
      )}
    >
      {children}
    </button>
  );
}

export function CopyValue({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate">{value}</span>
      <button
        type="button"
        aria-label={`Copy ${value}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast.success("Copied"),
            () => toast.error("Could not copy"),
          )
        }
      >
        <Copy className="size-3.5" />
      </button>
    </span>
  );
}
