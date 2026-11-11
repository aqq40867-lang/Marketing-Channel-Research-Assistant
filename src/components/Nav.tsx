"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { store, useStoreVersion } from "@/lib/storage";

const LINKS = [
  { href: "/", label: "Research" },
  { href: "/leads", label: "Follow-up board" },
  { href: "/stats", label: "Stats" },
  { href: "/history", label: "History" },
];

export function Nav() {
  const path = usePathname();
  // “Research” returns to the last viewed results; the logo at top left starts a new blank research
  const v = useStoreVersion();
  const lastId = v >= 0 ? store.getLastResearchId() : null;
  const hrefOf = (href: string) => (href === "/" && lastId ? `/?id=${lastId}` : href);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-sm text-white">M</span>
          Marketing Channel Research Assistant
        </Link>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={hrefOf(l.href)}
                className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-brand-soft font-medium text-brand" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
