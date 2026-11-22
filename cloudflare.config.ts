import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "writer-web",
    "compatibilityDate": "2026-11-17",
    "domains": ["writer.samrose.me"],
    "observability": {
      "enabled": true
    },
    "assets": {
      "notFoundHandling": "single-page-application"
    }
  }
});
