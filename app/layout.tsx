import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Fiutran Scheduler",
  description: "Find a meeting time that works across time zones. Prototype with sample data.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <Header />
          <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
