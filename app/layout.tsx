import type { Metadata } from "next";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  // Public metadata uses the configured site origin, never client-supplied headers.
  const baseUrl = "https://lineageguard.ugrp44group.chatgpt.site";
  const title = "LineageGuard — Watch an AI claim mutate";
  const description =
    "A free, local AI black-box replay that finds the first handoff where numbers, confidence, scope, or authority change.";

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: baseUrl,
      images: [
        {
          url: `${baseUrl}/og.png`,
          width: 1200,
          height: 630,
          alt: "LineageGuard visualizes the first mutation in an AI agent chain.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${baseUrl}/og.png`],
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
      <body>{children}</body>
    </html>
  );
}
