import { Card, CardContent } from "@/components/ui/card";
import { messageFromError } from "@/store";

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{label}</CardContent>
    </Card>
  );
}
export function ErrorBlock({ error }: { error: unknown }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-8 text-center text-sm text-destructive">
        {messageFromError(error)}
      </CardContent>
    </Card>
  );
}
