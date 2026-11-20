import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "public/sw.js", "playwright-report/**", "test-results/**", "mobile/**"] },
];
export default config;
