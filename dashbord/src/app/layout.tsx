import type { Metadata, Viewport } from "next";
import { Inter, Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";

/* Self-hosted, subsetted, swap-loaded — no render-blocking CDN requests. */
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-orbitron",
  display: "swap",
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#050b18",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Mission Control · Smart Survey Robot",
    template: "%s · Mission Control",
  },
  description:
    "Mission Control — the operations dashboard for the ESP32 smart survey robot. Monitor telemetry, plan paths and command the robot over WiFi or Bluetooth.",
  applicationName: "Mission Control",
  icons: { icon: "/dashboard/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${rajdhani.variable} ${inter.variable}`}
    >
      <body className="bg-[#050b18] font-sans text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
