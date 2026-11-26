"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ heading: string; slugs: string[] }> = [
  { heading: "Team", slugs: ["employees", "pods"] },
  { heading: "Demand", slugs: ["brands", "processes", "brand-processes", "assignments"] },
  { heading: "Calendar & Leave", slugs: ["holidays", "leaves", "comp-offs", "overrides"] },
];

export function SetupNav({ items }: { items: Array<{ slug: string; title: string }> }) {
  const path = usePathname();
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const groupedSlugs = new Set(GROUPS.flatMap((g) => g.slugs));
  const extra = items.filter((i) => !groupedSlugs.has(i.slug));

  const renderLink = (i: { slug: string; title: string }) => {
    const active = path === `/setup/${i.slug}`;
    return (
      <Link
        key={i.slug}
        href={`/setup/${i.slug}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "whitespace-nowrap border-l-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
          active && "border-primary bg-card font-medium text-foreground",
        )}
      >
        {i.title}
      </Link>
    );
  };

  return (
    <nav aria-label="Setup sections" className="flex gap-4 overflow-x-auto md:flex-col md:gap-4">
      {GROUPS.map((g) => {
        const list = g.slugs
          .map((s) => bySlug.get(s))
          .filter((x): x is { slug: string; title: string } => Boolean(x));
        if (list.length === 0) return null;
        return (
          <div key={g.heading} className="flex shrink-0 flex-col gap-0.5">
            <div className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">
              {g.heading}
            </div>
            <div className="flex md:flex-col">{list.map(renderLink)}</div>
          </div>
        );
      })}
      {extra.length > 0 && (
        <div className="flex shrink-0 flex-col gap-0.5">
          <div className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">Other</div>
          <div className="flex md:flex-col">{extra.map(renderLink)}</div>
        </div>
      )}
    </nav>
  );
}
