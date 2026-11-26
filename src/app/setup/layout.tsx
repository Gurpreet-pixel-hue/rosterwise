import Link from "next/link";
import { RESOURCE_DEFS } from "@/components/setup/resources";
import { SetupNav } from "@/components/setup/setup-nav";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-6 px-4 py-5 md:flex-row lg:px-6">
      <aside className="md:sticky md:top-5 md:w-44 md:shrink-0 md:self-start lg:w-52">
        <Link
          href="/setup"
          className="mb-3 block px-3 text-xs font-semibold uppercase tracking-wide text-foreground"
        >
          Setup
        </Link>
        <SetupNav items={RESOURCE_DEFS.map((d) => ({ slug: d.slug, title: d.title }))} />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
