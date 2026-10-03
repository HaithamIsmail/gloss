// Turns slide decks (PPTX, PPT, ODP) into PDF so their pages can be rendered.
// Uses Microsoft PowerPoint when it is installed (Windows), otherwise
// LibreOffice. PDFs need no conversion: the browser renders them directly.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "./envs";

export type Converter = "powerpoint" | "libreoffice";

export const SLIDE_EXTENSIONS = [".pptx", ".ppt", ".pptm", ".ppsx", ".pps", ".odp"];

const isWin = process.platform === "win32";
const PS_SCRIPT = fileURLToPath(new URL("./pptx_to_pdf.ps1", import.meta.url));

async function hasPowerPoint(): Promise<boolean> {
  if (!isWin) return false;
  const res = await run("reg", ["query", "HKCR\\PowerPoint.Application\\CLSID"], { timeout: 5_000 });
  return res.code === 0;
}

async function findSoffice(): Promise<string | null> {
  const candidates = isWin
    ? [
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.exe"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.exe"),
      ]
    : ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice"];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;
  const res = await run(isWin ? "where" : "which", ["soffice"], { timeout: 5_000 });
  return res.code === 0 ? res.stdout.split(/\r?\n/)[0].trim() || null : null;
}

let detected: Promise<Converter | null> | null = null;

/** The slide converter available on this computer (checked once). */
export function slideConverter(): Promise<Converter | null> {
  detected ??= (async () => ((await hasPowerPoint()) ? "powerpoint" : (await findSoffice()) ? "libreoffice" : null))();
  return detected;
}

/** Converts a presentation to PDF and returns the PDF's path (next to the input). */
export async function presentationToPdf(input: string): Promise<{ pdf: string; converter: Converter }> {
  const converter = await slideConverter();
  if (!converter) {
    throw Object.assign(new Error("No converter for slides: install LibreOffice, or export the deck to PDF first."), {
      status: 501,
    });
  }
  const out = path.join(path.dirname(input), `${path.parse(input).name}.pdf`);

  if (converter === "powerpoint") {
    const res = await run(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "-In", input, "-Out", out],
      { timeout: 5 * 60_000 },
    );
    if (res.code !== 0 || !fs.existsSync(out)) {
      throw new Error(`PowerPoint could not convert the file. ${res.stderr.trim().split(/\r?\n/).slice(-3).join(" ")}`);
    }
    return { pdf: out, converter };
  }

  // LibreOffice, with its own throwaway profile so it works even if LibreOffice is open.
  const soffice = (await findSoffice())!;
  const profile = path.join(os.tmpdir(), `study-lo-${crypto.randomUUID()}`);
  try {
    const res = await run(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        path.dirname(input),
        input,
      ],
      { timeout: 5 * 60_000 },
    );
    if (res.code !== 0 || !fs.existsSync(out)) {
      throw new Error(`LibreOffice could not convert the file. ${res.stderr.trim().split(/\r?\n/).slice(-3).join(" ")}`);
    }
    return { pdf: out, converter };
  } finally {
    fs.rm(profile, { recursive: true, force: true }, () => undefined);
  }
}
