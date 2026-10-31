"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthArt } from "@/components/AuthArt";
import { apiFetch } from "@/lib/api";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("Verifying your email address…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("failed");
      setMessage("This verification link is missing its token.");
      return;
    }
    apiFetch<{ verified: boolean }>("/auth/verify-email", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setState("done");
        setMessage("Your email is verified. You can sign in now.");
      })
      .catch((error: unknown) => {
        setState("failed");
        setMessage(error instanceof Error ? error.message : "Verification failed.");
      });
  }, []);

  return (
    <div className="auth-shell">
      <AuthArt />
      <section className="auth-panel">
        <div className="auth-card">
          <div className="brand" style={{ marginBottom: 38 }}>
            <span className="brand-mark">B</span>
            <span>BrightLoop</span>
          </div>
          <h2>{state === "done" ? "Email verified" : state === "failed" ? "Link not valid" : "One moment"}</h2>
          <p className="muted">{message}</p>
          <div style={{ marginTop: 26 }}>
            <Link className="btn primary" href={state === "done" ? "/login" : "/register"}>
              {state === "done" ? "Sign in" : "Back to sign up"}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
