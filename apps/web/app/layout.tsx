import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrightLoop — Usage billing without the busywork",
  description:
    "BrightLoop is the billing control room for usage-based SaaS: customers, plans, subscriptions, metered usage, invoices, and webhooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
