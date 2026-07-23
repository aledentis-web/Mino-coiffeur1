import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111713",
        warm: "#f3f1e9",
        linen: "#fffef9",
        stonegold: "#9fca06",
        espresso: "#28332c"
      },
      boxShadow: {
        soft: "0 24px 70px rgba(17, 16, 14, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
