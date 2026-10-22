import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai, Prompt, Sarabun } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const noto = Noto_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-noto", display: "swap" });
const prompt = Prompt({ subsets: ["thai", "latin"], weight: ["500", "600", "700"], variable: "--font-prompt", display: "swap" });
const sarabun = Sarabun({ subsets: ["thai", "latin"], weight: ["400", "700"], variable: "--font-sarabun", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ระบบสารสนเทศนักเรียน", template: "%s · TSR-SIS" },
  description: "ระบบสารสนเทศนักเรียน โรงเรียนอนุบาลเทพสุนทรินทร์",
  manifest: "/manifest.webmanifest",
  applicationName: "TSR-SIS",
  appleWebApp: { capable: true, title: "TSR-SIS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1E3A8A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// ตั้งขนาดตัวอักษรก่อนวาดหน้าจอ เพื่อไม่ให้หน้ากระพริบ
const fontScaleScript = `try{var s=localStorage.getItem("tsr-font-scale");if(s)document.documentElement.style.setProperty("--font-scale",s)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${noto.variable} ${prompt.variable} ${sarabun.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fontScaleScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
