import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://miguelacm.es/tools/linux-terminal";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Simulated Linux Terminal — Free Online Tool", template: "%s | Simulated Linux Terminal" },
  description: "Learn real bash with zero risk: a virtual filesystem, 45+ commands, pipes (ls | grep), chmod permissions, SSH to a simulated remote machine and 5 guided lessons. 100% in your browser.",
  authors: [{ name: "Miguel Ángel Colorado Marin", url: "https://miguelacm.es" }],
  creator: "Miguel Ángel Colorado Marin",
  openGraph: { title: "Simulated Linux Terminal — Free Online Tool", description: "Learn real bash with zero risk: a virtual filesystem, 45+ commands, pipes (ls | grep), chmod permissions, SSH to a simulated remote machine and 5 guided lessons. 100% in your browser.", url: SITE_URL, siteName: "Simulated Linux Terminal — MACM", type: "website" },
  twitter: { card: "summary_large_image", title: "Simulated Linux Terminal — Free Online Tool", description: "Learn real bash with zero risk: a virtual filesystem, 45+ commands, pipes (ls | grep), chmod permissions, SSH to a simulated remote machine and 5 guided lessons. 100% in your browser." },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="author" href="https://miguelacm.es" />
        <meta name="author" content="Miguel Ángel Colorado Marin" />
        <meta name="copyright" content="Miguel Ángel Colorado Marin — miguelacm.es" />
      </head>
      <body className="antialiased">
        {children}
        <footer className="pb-8 text-center text-xs text-text-muted/40">
          ⚡ by{" "}
          <a href="https://miguelacm.es" target="_blank" rel="noopener noreferrer" className="text-text-muted/60 transition-colors hover:text-text-muted underline-offset-2 hover:underline">MACM · miguelacm.es</a>
          {" · "}
          <a href="https://github.com/m-a-c-m/LinuxTerminal" target="_blank" rel="noopener noreferrer" className="text-text-muted/60 transition-colors hover:text-text-muted underline-offset-2 hover:underline">Open source</a>
        </footer>
      </body>
    </html>
  );
}
