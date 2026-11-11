import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { StorageErrorBanner } from "@/components/StorageErrorBanner";

export const metadata: Metadata = {
  title: "Marketing Channel Research Assistant",
  description: "Find promotion channels backed by public evidence, write honest outreach emails, and track follow-ups",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav />
        <StorageErrorBanner />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
