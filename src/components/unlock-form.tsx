"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UnlockForm({ currentName }: { currentName: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(currentName ?? "");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, name }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setPasscode("");
        setError(body.message ?? "Could not unlock.");
        return;
      }
      router.push("/roster");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" aria-label="Unlock editing">
      {currentName ? (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Already unlocked as <strong className="text-foreground">{currentName}</strong>. Submit to
          switch name or renew the 12-hour session.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="unlock-name">Your name</Label>
        <Input
          id="unlock-name"
          name="name"
          autoComplete="name"
          maxLength={60}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="unlock-passcode">Passcode</Label>
        <Input
          id="unlock-passcode"
          name="passcode"
          type="password"
          autoComplete="off"
          required
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !name.trim() || !passcode}>
        {busy ? "Checking…" : "Unlock"}
      </Button>
    </form>
  );
}
