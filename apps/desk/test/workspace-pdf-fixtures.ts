// Synthetic PDF objects exercising native PDF.js text and image decoding.
export function syntheticPdf(objects: string[]) {
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}
export function japanesePdfBytes() {
  const stream = "BT /F1 20 Tf 20 200 Td <65e5672c> Tj ET\n";
  return syntheticPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /DW 1000 >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ]).buffer as ArrayBuffer;
}
export function imagePdfBytes(count = 6, size = 128) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${count} >>`,
  ];
  for (let i = 0; i < count; i++) {
    const base = 3 + i * 3;
    const stream = `q ${size} 0 0 ${size} 0 0 cm /Im Do Q`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size} ${size}] /Resources << /XObject << /Im ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${size * size * 3} >>\nstream\n${String.fromCharCode(33 + i).repeat(size * size * 3)}\nendstream`,
    );
  }
  return syntheticPdf(objects);
}
