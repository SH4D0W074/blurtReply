export async function readMaterial(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a file smaller than 12 MB, or paste a shorter section of your notes.');
  let text = '';
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 80) throw new Error('Choose an excerpt of up to 80 pages, or paste the section you want to rehearse.');
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const body = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').trim();
        if (body) pages.push(`[Page ${pageNumber}]\n${body}`);
      }
      text = pages.join('\n\n');
      if (text.replace(/\[Page \d+\]/g, '').trim().length < 80) throw new Error('This PDF doesn’t contain enough selectable text. Paste the text from your notes to continue; scanned pages aren’t supported.');
    } finally { await task.destroy(); }
  } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type === 'text/plain') text = await file.text();
  else throw new Error('Choose a PDF with selectable text, a .txt file, or a Markdown file.');
  if (text.trim().length < 80) throw new Error('Add a little more material—at least 80 characters gives the practice something to work with.');
  if (text.length > 30000) throw new Error('This material is longer than 30,000 characters. Paste a shorter section or choose a smaller excerpt.');
  return text.trim();
}
