import type { NextConfig } from "next";

// Production backend on Render. Override locally via .env.local
const PROD_API = "https://case-study-ga4q.onrender.com";

const nextConfig: NextConfig = {
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.NODE_ENV === "production" ? PROD_API : "http://localhost:4000"),
  },
};

export default nextConfig;
