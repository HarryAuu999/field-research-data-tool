import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = path.resolve("assets", "App-icon2.svg");
for (const size of [180, 192, 512]) {
  const output = path.resolve("assets", `icon-${size}.png`);
  await sharp(source).resize(size, size).png().toFile(output);
  const stats = await fs.stat(output);
  console.log(`${path.basename(output)} ${stats.size} bytes`);
}
