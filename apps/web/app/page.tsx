"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? "/dashboard" : "/login");
  }, [router]);

  return (
    <div className="empty" style={{ minHeight: "100vh", display: "grid", placeContent: "center" }}>
      <div className="brand">
        <span className="brand-mark">B</span> BrightLoop
      </div>
    </div>
  );
}
