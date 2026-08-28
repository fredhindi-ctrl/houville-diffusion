import { PDFDocument } from "pdf-lib";

// Les comptes rendus de Houville-la-Branche sont des PDF SCANNÉS (images), sans couche de
// texte — vérifié empiriquement sur 4 échantillons répartis de 2016 à 2026, tous à 0 caractère
// extractible via un parseur PDF classique. On passe donc par de l'OCR (OCR.space, tier
// gratuit : 25 000 requêtes/mois, largement suffisant pour ~1-2 comptes rendus/mois).
//
// Limite dure du tier gratuit OCR.space (vérifiée, pas spécifique à la clé demo) : 3 pages max
// par requête PDF. Nos PDF font 2 à 4 pages selon l'échantillon testé → on découpe tout PDF de
// plus de 3 pages en chunks de 3 pages max via pdf-lib, on OCR chaque chunk séparément, puis on
// concatène le texte dans l'ordre des pages.
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY;
const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const MAX_PAGES_PAR_REQUETE = 3;

if (!OCR_SPACE_API_KEY) {
  throw new Error(
    "OCR_SPACE_API_KEY doit être défini (inscription gratuite sur https://ocr.space/ocrapi — " +
      "la clé démo 'helloworld' est partagée entre tous les utilisateurs et n'est pas fiable pour un usage régulier)."
  );
}

interface OcrSpaceResponse {
  IsErroredOnProcessing: boolean;
  ErrorMessage?: string[];
  ParsedResults?: { ParsedText: string; FileParseExitCode: number }[];
}

async function ocrPdfBuffer(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("apikey", OCR_SPACE_API_KEY!);
  form.append("OCREngine", "2");
  form.append("isOverlayRequired", "false");
  form.append("filetype", "PDF");
  form.append("file", new Blob([Uint8Array.from(buffer)], { type: "application/pdf" }), filename);

  const response = await fetch(OCR_SPACE_ENDPOINT, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`OCR.space HTTP ${response.status}`);
  }
  const data = (await response.json()) as OcrSpaceResponse;

  // IsErroredOnProcessing peut être true à cause de la limite de 3 pages même si des pages
  // ont bien été traitées (ParsedResults contient alors le texte partiel) — on ne lève une
  // erreur bloquante que si on n'a vraiment aucun résultat exploitable.
  if (!data.ParsedResults || data.ParsedResults.length === 0) {
    throw new Error(`OCR.space n'a renvoyé aucun résultat : ${data.ErrorMessage?.join(", ") ?? "raison inconnue"}`);
  }

  return data.ParsedResults.map((r) => r.ParsedText.trim()).join("\n");
}

export async function extractPdfText(urlPdf: string): Promise<string> {
  const response = await fetch(urlPdf);
  if (!response.ok) {
    throw new Error(`Échec du téléchargement du PDF ${urlPdf} : HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const pdfDoc = await PDFDocument.load(buffer);
  const pageCount = pdfDoc.getPageCount();

  if (pageCount <= MAX_PAGES_PAR_REQUETE) {
    return ocrPdfBuffer(buffer, "document.pdf");
  }

  // Découpage en chunks de MAX_PAGES_PAR_REQUETE pages, OCR séquentiel (pas parallèle, pour
  // rester sous le rate limit de 500 requêtes/jour d'OCR.space), texte concaténé dans l'ordre.
  const morceaux: string[] = [];
  for (let debut = 0; debut < pageCount; debut += MAX_PAGES_PAR_REQUETE) {
    const indices = Array.from(
      { length: Math.min(MAX_PAGES_PAR_REQUETE, pageCount - debut) },
      (_, i) => debut + i
    );
    const chunkDoc = await PDFDocument.create();
    const pagesCopiees = await chunkDoc.copyPages(pdfDoc, indices);
    pagesCopiees.forEach((page) => chunkDoc.addPage(page));
    const chunkBuffer = Buffer.from(await chunkDoc.save());

    morceaux.push(await ocrPdfBuffer(chunkBuffer, `chunk-${debut}.pdf`));
  }

  return morceaux.join("\n");
}
