import React, { useState } from "react";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle login
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        backgroundColor: "#F8FAFC",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "100px 24px 48px",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Logo Area */}
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: "#4F46E5",
            margin: "0 auto 8px",
          }}
        />
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#0F172A",
            margin: 0,
          }}
        >
          Pencil
        </h1>
      </div>

      {/* Login Card */}
      <div
        style={{
          width: "100%",
          maxWidth: 342,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#0F172A",
            textAlign: "center",
            margin: 0,
          }}
        >
          Welcome back
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "#64748B",
            textAlign: "center",
            margin: 0,
          }}
        >
          Sign in to your account to continue
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Email Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 14, fontWeight: 500, color: "#0F172A" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                height: 44,
                padding: "0 12px",
                backgroundColor: "#F1F5F9",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 14, fontWeight: 500, color: "#0F172A" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%",
                height: 44,
                padding: "0 12px",
                backgroundColor: "#F1F5F9",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Forgot Password */}
          <a
            href="#"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#4F46E5",
              textAlign: "right",
              textDecoration: "none",
              alignSelf: "flex-end",
            }}
          >
            Forgot password?
          </a>

          {/* Sign In Button */}
          <button
            type="submit"
            style={{
              width: "100%",
              height: 48,
              backgroundColor: "#4F46E5",
              color: "#FFFFFF",
              fontSize: 16,
              fontWeight: 600,
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Sign In
          </button>
        </form>
      </div>

      {/* Divider */}
      <div
        style={{
          width: "100%",
          maxWidth: 342,
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "24px 0",
        }}
      >
        <div style={{ flex: 1, height: 1, backgroundColor: "#E2E8F0" }} />
        <span style={{ fontSize: 12, color: "#64748B" }}>or</span>
        <div style={{ flex: 1, height: 1, backgroundColor: "#E2E8F0" }} />
      </div>

      {/* Sign Up Link */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 14, color: "#64748B" }}>
          Don&apos;t have an account?{" "}
        </span>
        <a
          href="#"
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "#4F46E5",
            textDecoration: "none",
          }}
        >
          Sign up
        </a>
      </div>
    </div>
  );
}
