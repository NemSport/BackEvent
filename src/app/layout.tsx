import type { Metadata, Viewport } from "next";
import { Ubuntu } from "next/font/google";
import "./globals.css";

const ubuntu = Ubuntu({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-ubuntu",
});

export const metadata: Metadata = {
  title: "BackEvent",
  description: "Backend for events, barer og beholdning",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BackEvent",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/backevent-icon.svg",
    apple: "/icons/backevent-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#e7352b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da">
      <body className={`${ubuntu.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
