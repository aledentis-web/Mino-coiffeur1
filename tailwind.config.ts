import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#11100e",
        warm: "#f4efe6",
        linen: "#fbf8f2",
        stonegold: "#b28a46",
        espresso: "#3d3329"
      },
      boxShadow: {
        soft: "0 24px 70px rgba(17, 16, 14, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
