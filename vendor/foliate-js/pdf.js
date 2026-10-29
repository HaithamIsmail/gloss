// PDFs are shown with Gloss's own pdf.js viewer (src/books/PdfBook.tsx), so the
// upstream module, which loads pdf.js from ./vendor/pdfjs, is not bundled.
export const makePDF = async () => {
    throw new Error('PDF files are opened with the PDF viewer, not foliate-js')
}
