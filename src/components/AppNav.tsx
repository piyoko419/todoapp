"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/intake", label: "メール取り込み" },
  { href: "/board", label: "案件ボード" },
  { href: "/liff", label: "スタッフ画面" },
  { href: "/todo", label: "ToDo" },
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 mb-8">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-4 py-2 rounded-full text-sm border transition-colors ${
              active
                ? "bg-violet-500 text-white border-violet-500"
                : "bg-white text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
