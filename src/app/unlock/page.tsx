import { UnlockForm } from "@/components/unlock-form";
import { currentSession } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unlock editing · RosterWise" };

export default async function UnlockPage() {
  const session = await currentSession();
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-lg font-semibold tracking-tight">Unlock editing</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Everyone can view rosters, issues and setup. Changing anything (generating, editing,
        applying a change, publishing, setup) needs the shared passcode. The name you enter is
        recorded in the audit log next to each change.
      </p>
      <UnlockForm currentName={session?.name ?? null} />
    </main>
  );
}
