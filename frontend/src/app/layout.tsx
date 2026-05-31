import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PartSelect AI Chat | Refrigerator & Dishwasher Parts",
  description: "AI-powered chat assistant for finding, troubleshooting, and installing refrigerator and dishwasher replacement parts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
