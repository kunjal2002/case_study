import "dotenv/config";
import { runScraper } from "./scraper.js";

runScraper()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Scraper failed:", err);
    process.exit(1);
  });
