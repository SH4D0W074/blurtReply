export interface MaterialReadProgress {
  phase: 'opening' | 'extracting';
  pagesRead: number;
  totalPages: number | null;
}

export interface ImportedMaterial {
  text: string;
  pageCount: number | null;
  emptyPages: number[];
}

interface ReadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MaterialReadProgress) => void;
}

const MAX_CHARACTERS = 30_000;
const TOO_LONG = 'This material is longer than 30,000 characters. Choose a smaller PDF excerpt or paste a shorter section. Your previous draft is unchanged.';

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Import cancelled.', 'AbortError'));
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Reads locally. Page labels stay in the editable text supplied to the practice. */
export async function readMaterial(file: File, options: ReadOptions = {}): Promise<ImportedMaterial> {
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a file of up to 12 MB, or paste a shorter section of your notes. Your previous draft is unchanged.');
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = window.setTimeout(() => controller.abort(new Error('Reading this file took too long. Try a smaller excerpt or paste your notes. Your previous draft is unchanged.')), 30_000);
  const { signal } = controller;
  let text = '';
  let pageCount: number | null = null;
  const emptyPages: number[] = [];
  try {
    signal.throwIfAborted();
    options.onProgress?.({ phase: 'opening', pagesRead: 0, totalPages: null });
    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      const [pdfjs, worker, data] = await abortable(Promise.all([
        import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'), file.arrayBuffer(),
      ]), signal);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ data: new Uint8Array(data) });
      let destroying: Promise<void> | undefined;
      const destroy = () => destroying ??= task.destroy().catch(() => {});
      const abortTask = () => { void destroy(); };
      signal.addEventListener('abort', abortTask, { once: true });
      try {
        const pdf = await abortable(task.promise, signal);
        pageCount = pdf.numPages;
        if (pageCount > 80) throw new Error('This PDF has more than 80 pages. Choose an excerpt of up to 80 pages. Your previous draft is unchanged.');
        const pages: string[] = [];
        let textLength = 0;
        let selectableCharacters = 0;
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          signal.throwIfAborted();
          options.onProgress?.({ phase: 'extracting', pagesRead: pageNumber - 1, totalPages: pageCount });
          const page = await abortable(pdf.getPage(pageNumber), signal);
          try {
            const content = await abortable(page.getTextContent(), signal);
            const body = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').trim();
            if (body) {
              const labelled = `[Page ${pageNumber}]\n${body}`;
              textLength += labelled.length + (pages.length ? 2 : 0);
              if (textLength > MAX_CHARACTERS) throw new Error(TOO_LONG);
              selectableCharacters += body.length;
              pages.push(labelled);
            } else emptyPages.push(pageNumber);
          } finally { page.cleanup(); }
          options.onProgress?.({ phase: 'extracting', pagesRead: pageNumber, totalPages: pageCount });
        }
        text = pages.join('\n\n');
        if (selectableCharacters < 80) throw new Error('This PDF has fewer than 80 characters of selectable text. Scanned or image-only pages cannot be read here. Paste the text from your notes instead. Your previous draft is unchanged.');
      } catch (failure) {
        if (signal.aborted) throw signal.reason;
        const name = failure instanceof Error ? failure.name : '';
        if (name === 'PasswordException') throw new Error('This PDF is password-protected. Open it with its password and save an unlocked copy, or paste the section you need. Your previous draft is unchanged.');
        if (name === 'InvalidPDFException' || name === 'UnknownErrorException' || name === 'FormatError') throw new Error('This PDF could not be read. It may be damaged or use an unsupported format. Export a new PDF or paste the text. Your previous draft is unchanged.');
        throw failure;
      } finally {
        signal.removeEventListener('abort', abortTask);
        await destroy();
      }
    } else if (/\.(txt|md|markdown)$/i.test(file.name) || file.type === 'text/plain') {
      text = await abortable(file.text(), signal);
    } else throw new Error('Choose a PDF with selectable text, a .txt file, or a Markdown file. Your previous draft is unchanged.');
    signal.throwIfAborted();
    if (text.trim().length < 80) throw new Error('Add a little more material: at least 80 characters gives the practice something to work with. Your previous draft is unchanged.');
    if (text.length > MAX_CHARACTERS) throw new Error(TOO_LONG);
    return { text: text.trim(), pageCount, emptyPages };
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
