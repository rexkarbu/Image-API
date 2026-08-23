"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface NavItem {
  name: string;
  href: string;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { name: "Overview", href: "/dashboard", exact: true },
  { name: "Usage", href: "/dashboard/usage" },
  { name: "API Keys", href: "/dashboard/api-keys" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex items-center space-x-1 sm:space-x-2">
      {navItems.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname?.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={clsx(
              "px-3 py-1.5 rounded-md text-xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600",
              isActive
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
