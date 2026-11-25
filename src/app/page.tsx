import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">RosterWise</h1>
      <p className="text-muted-foreground">
        Smart roster management for multi-brand customer operations. Scaffold only: master data, the
        scheduling engine and the roster views arrive in the next phases.
      </p>
      <div>
        <Button disabled>Open roster (coming soon)</Button>
      </div>
    </main>
  );
}
