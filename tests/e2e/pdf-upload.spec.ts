import { test, expect, type Page } from '@playwright/test';

const originalDraft = 'My saved notes explain how evidence supports a claim, how an example illustrates it, and where the conclusion remains uncertain.';
const ethics = ['Consequentialism evaluates actions by their consequences for everyone affected.', 'Deontology considers duties and constraints that can apply regardless of outcomes.'];
const biology = ['A cell membrane controls movement between the cell and its surroundings.', 'Passive transport follows a concentration gradient without a direct ATP requirement.'];

/** Small, real PDFs: parsing and extraction are never mocked. An empty page has no text layer. */
function pdf(pages: string[][]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach(lines => {
    const pageId = objects.length + 1;
    const stream = lines.length ? `BT /F1 9 Tf 40 740 Td 14 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')} ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let content = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

// A genuine password-protected blank PDF authored with pypdf; no secret or personal content.
const lockedPdf = Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDQ0MzBiZDgyNTU+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8Yzk0YmZlNjYwYTQ2YjNmOWQ3NWNiYzBkZDEwZDg1NTdjNjY3YzYxOWNkNjA3NjFhODdiNDZhOWFjMDg0ZTU2Nj4KL1UgPDU4MjE0YzJmYzQzMThiMDQ2MTlkY2RiODE2OTVkODFjMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1NjEzMTMyNjIzNzY0MzczODM1NjEzNjY0MzUzNTM3MzUzNjM5NjI2MjM3MzA2NDMyMzQzMjMyNjEzNzMwMzk+IDwzNTYxMzEzMjYyMzc2NDM3MzgzNTYxMzY2NDM1MzUzNzM1MzYzOTYyNjIzNzMwNjQzMjM0MzIzMjYxMzczMDM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK', 'base64');

async function openMaterial(page: Page, draft = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bring your material' }).click();
  if (draft) {
    await page.getByLabel('Course or topic').fill('My course');
    await page.getByLabel('Your source material', { exact: true }).fill(originalDraft);
  }
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel('Upload course material', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer });
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function holdFileRead(page: Page) {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    const control = { started: 0, completed: 0, release: () => {} };
    Object.assign(window, { pdfRead: control });
    File.prototype.arrayBuffer = async function () {
      if (this.name.startsWith('Slow')) {
        control.started += 1;
        await new Promise<void>(resolve => { control.release = resolve; });
      }
      const bytes = await original.call(this);
      if (this.name.startsWith('Slow')) control.completed += 1;
      return bytes;
    };
  });
  return {
    release: () => page.evaluate(() => (window as unknown as { pdfRead: { release(): void } }).pdfRead.release()),
    completed: () => page.evaluate(() => (window as unknown as { pdfRead: { completed: number } }).pdfRead.completed),
  };
}

test('real PDF extraction retains original page numbers and warns about pages without selectable text', async ({ page }) => {
  await openMaterial(page);
  await upload(page, 'Course chapter.pdf', pdf([ethics, [], biology]));
  const material = page.getByLabel('Your source material', { exact: true });
  await expect(material).toHaveValue(/\[Page 1\][\s\S]*Consequentialism[\s\S]*\[Page 3\][\s\S]*Passive transport/);
  await expect(material).not.toHaveValue(/\[Page 2\]/);
  await expect(page.locator('.pdf-import-notice')).toContainText('2 of 3 pages imported. 1 page had no selectable text.');
  await page.reload();
  await page.getByRole('button', { name: 'Bring your material' }).click();
  await expect(material).toHaveValue(/\[Page 3\]/);
  await expect(page.getByLabel('Course or topic')).toHaveValue('Course chapter');
});

test('replacement updates filename-derived titles, preserves custom titles, and can reread the same file', async ({ page }) => {
  await openMaterial(page);
  await upload(page, 'Ethics.pdf', pdf([ethics]));
  await expect(page.getByLabel('Course or topic')).toHaveValue('Ethics');
  await page.reload();
  await page.getByRole('button', { name: 'Bring your material' }).click();
  await upload(page, 'Biology.pdf', pdf([biology]));
  await expect(page.getByLabel('Course or topic')).toHaveValue('Biology');
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Passive transport/);
  await page.getByLabel('Course or topic').fill('My exam revision');
  await upload(page, 'Biology.pdf', pdf([ethics]));
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Deontology/);
  await expect(page.getByLabel('Course or topic')).toHaveValue('My exam revision');
});

const failures = [
  { name: 'damaged', buffer: () => Buffer.from('%PDF-1.4\nThis is not a PDF document.'), message: /This PDF could not be read/ },
  { name: 'image-only', buffer: () => pdf([[]]), message: /fewer than 80 characters of selectable text/ },
  { name: 'password-protected', buffer: () => lockedPdf, message: /This PDF is password-protected/ },
  { name: 'over 80 pages', buffer: () => pdf(Array.from({ length: 81 }, () => ethics)), message: /more than 80 pages/ },
  { name: 'over 30,000 characters', buffer: () => pdf(Array.from({ length: 11 }, () => Array.from({ length: 40 }, () => ethics[0]))), message: /longer than 30,000 characters/ },
  { name: 'over 12 MB', buffer: () => Buffer.alloc(12 * 1024 * 1024 + 1), message: /up to 12 MB/ },
];
for (const failure of failures) test(`${failure.name} PDF gives a useful error and leaves the saved draft usable`, async ({ page }) => {
  await openMaterial(page, true);
  await upload(page, 'Unreadable.pdf', failure.buffer());
  await expect(page.getByRole('alert')).toContainText(failure.message);
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(originalDraft);
  await expect(page.getByLabel('Course or topic')).toHaveValue('My course');
  await expect(page.getByRole('progressbar', { name: 'File import progress' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start free demo', exact: true })).toBeEnabled();
  await upload(page, 'Valid replacement.pdf', pdf([biology]));
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Passive transport/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a pending upload cannot overwrite a newer file or reset its progress', async ({ page }) => {
  const slow = await holdFileRead(page);
  await openMaterial(page);
  await upload(page, 'Slow old chapter.pdf', pdf([ethics]));
  await expect(page.getByRole('status').filter({ hasText: 'Opening your file' })).toContainText('Slow old chapter.pdf');
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeEnabled();
  await upload(page, 'New chapter.pdf', pdf([biology]));
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Passive transport/);
  await slow.release();
  await expect.poll(slow.completed).toBe(1);
  await settle(page);
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Passive transport/);
  await expect(page.getByLabel('Course or topic')).toHaveValue('New chapter');
  await expect(page.locator('.material-input__meta')).toContainText('New chapter.pdf');
});

for (const action of ['edit', 'clear', 'cancel', 'switch subject'] as const) test(`${action} during import prevents late text from replacing the draft`, async ({ page }) => {
  const slow = await holdFileRead(page);
  await openMaterial(page, true);
  await upload(page, 'Slow chapter.pdf', pdf([ethics]));
  await expect(page.getByRole('progressbar', { name: 'File import progress' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start free demo', exact: true })).toBeDisabled();
  if (action === 'edit') await page.getByLabel('Your source material', { exact: true }).fill(`${originalDraft} My latest edit.`);
  if (action === 'clear') await page.getByRole('button', { name: 'Clear', exact: true }).click();
  if (action === 'cancel') await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  if (action === 'switch subject') await page.getByRole('button', { name: 'Try a subject', exact: true }).click();
  await slow.release();
  await expect.poll(slow.completed).toBe(1);
  await settle(page);
  if (action === 'switch subject') {
    await expect(page.getByRole('button', { name: 'Try a subject', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Bring your material' }).click();
  }
  const expected = action === 'clear' ? '' : action === 'edit' ? `${originalDraft} My latest edit.` : originalDraft;
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(expected);
  await expect(page.getByRole('progressbar', { name: 'File import progress' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Bring your material' }).click();
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(expected);
});

test('page progress is bounded and cancellation stops a real PDF extraction', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    const control = { held: false, release: () => {} };
    Object.assign(window, { pdfWorker: control });
    Worker.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      const forward = () => Reflect.apply(original, this, [message, transfer]);
      if (!control.held && message && typeof message === 'object' && 'action' in message && message.action === 'GetTextContent') {
        control.held = true; control.release = forward;
      } else forward();
    };
  });
  await openMaterial(page, true);
  await upload(page, 'Three pages.pdf', pdf([ethics, biology, ethics]));
  const progress = page.getByRole('progressbar', { name: 'File import progress' });
  await expect(progress).toHaveAttribute('max', '3');
  await expect(progress).toHaveAttribute('value', '0');
  await expect(page.getByRole('status').filter({ hasText: 'Reading page 1 of 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await page.evaluate(() => (window as unknown as { pdfWorker: { release(): void } }).pdfWorker.release());
  await settle(page);
  await expect(progress).toHaveCount(0);
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(originalDraft);
  await expect(page.getByRole('button', { name: 'Start free demo', exact: true })).toBeEnabled();
});

test('a stalled read times out without losing the saved draft', async ({ page }) => {
  const slow = await holdFileRead(page);
  await page.clock.install();
  await openMaterial(page, true);
  await upload(page, 'Slow stalled.pdf', pdf([ethics]));
  await expect(page.getByRole('button', { name: 'Cancel import', exact: true })).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('alert')).toContainText('Reading this file took too long');
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(originalDraft);
  await slow.release();
  await expect.poll(slow.completed).toBe(1);
  await expect(page.getByRole('progressbar', { name: 'File import progress' })).toHaveCount(0);
});
