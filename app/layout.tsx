import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    title: {
      default: "PaneFlow Operations",
      template: "%s | PaneFlow",
    },
    description:
      "Window distribution inventory, purchasing, receiving, fulfillment, and billing operations in one traceable workspace.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "PaneFlow Operations",
      description: "Know what is ordered, what is physically here, and what is financially owed.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1735, height: 908, alt: "PaneFlow — Window operations, clearly connected." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "PaneFlow Operations",
      description: "Know what is ordered, what is physically here, and what is financially owed.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
