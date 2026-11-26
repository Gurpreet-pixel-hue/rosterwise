import Link from "next/link";
import { RESOURCE_DEFS } from "@/components/setup/resources";
import { SetupNav } from "@/components/setup/setup-nav";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:flex-row">
      <aside className="md:w-52 md:shrink-0">
        <Link
          href="/setup"
          className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Setup
        </Link>
        <SetupNav items={RESOURCE_DEFS.map((d) => ({ slug: d.slug, title: d.title }))} />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
