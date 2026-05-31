import "dotenv/config";
import { runPlaywrightScraper } from "./playwright-scraper.js";

runPlaywrightScraper()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Playwright scraper failed:", err);
    process.exit(1);
  });
