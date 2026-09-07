import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "compact" | "signature" | "mark";
  caption?: string;
  className?: string;
};

/** Shared, transparent artwork; the small mark omits text to stay legible. */
export function BrandLogo({ variant = "compact", caption, className }: BrandLogoProps) {
  if (variant === "mark") {
    return (
      <img
        src="/brand/motm-mark.svg"
        alt="MOTM Technologies"
        width={640}
        height={530}
        className={cn("size-9 shrink-0 object-contain", className)}
      />
    );
  }

  const signature = variant === "signature";
  return (
    <div
      className={cn(
        "flex shrink-0",
        signature ? "flex-col items-center gap-4" : "items-center gap-2.5",
        className,
      )}
    >
      <img
        src="/brand/motm-mark.svg"
        alt=""
        width={640}
        height={530}
        className={cn("shrink-0 object-contain", signature ? "h-28 w-36" : "size-10")}
      />
      <div className={cn("min-w-0", signature && "w-full text-center")}>
        <p
          className={cn(
            "whitespace-nowrap font-sans font-bold leading-tight tracking-tight text-foreground",
            signature ? "text-2xl" : "text-[15px]",
          )}
        >
          MOTM Technologies
        </p>
        {signature && (
          <p className="mt-3 border-t border-primary/30 pt-2 text-sm tracking-wide text-primary">
            Igniting Industrial Growth
          </p>
        )}
        {caption && (
          <p
            className={cn(
              "text-muted-foreground",
              signature ? "mt-4 text-xs" : "mt-1.5 text-[11px] leading-tight",
            )}
          >
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}
