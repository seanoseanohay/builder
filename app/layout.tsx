import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Kickstarter",
  description: "Brief → Research → PRD → Execution Plan → Drop-in Cursor files",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
