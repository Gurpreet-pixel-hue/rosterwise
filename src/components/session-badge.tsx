"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/** Shows whether editing is unlocked, and who the audit log will name. Rendered by the layout from the server. */
export function SessionBadge({ name }: { name: string | null }) {
  const router = useRouter();

  async function lock() {
    await fetch("/api/lock", { method: "POST" });
    router.refresh();
  }

  return name ? (
    <div className="ml-auto flex items-center gap-2 text-xs" data-session="unlocked">
      <LockOpen className="size-3.5 text-emerald-700" aria-hidden />
      <span className="text-muted-foreground">
        Editing as <strong className="font-medium text-foreground">{name}</strong>
      </span>
      <Button variant="outline" size="sm" onClick={lock}>
        Lock
      </Button>
    </div>
  ) : (
    <div className="ml-auto flex items-center gap-2 text-xs" data-session="locked">
      <Lock className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">View only</span>
      <Link href="/unlock" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Unlock to edit
      </Link>
    </div>
  );
}
