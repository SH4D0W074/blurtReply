import { test, expect, type Page } from '@playwright/test';

async function startDemo(page: Page, sample = 'stats-causation') {
  await page.goto('/');
  await page.locator(`input[name="sample"][value="${sample}"]`).check();
  await page.getByRole('radio', { name: /Free guided demo/ }).check();
  await page.getByRole('button', { name: 'Start free demo' }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  await expect(page.getByRole('button', { name: 'Use example answer' })).toBeVisible();
}

async function submitExample(page: Page, last = false) {
  await page.getByRole('button', { name: 'Use example answer' }).click();
  await expect(page.getByLabel('Your answer', { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: last ? 'Finish with this answer' : 'Submit answer', exact: true }).click();
}

test('a six-answer demo shows source evidence, survives reload, and links the final review to answers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startDemo(page);
  await submitExample(page);
  await expect(page.locator('.practice-progress__label')).toContainText('02');
  await expect(page.locator('.evidence__provenance')).toContainText('Authored demo feedback');
  await page.locator('.source-link').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('mark')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Your answer', { exact: true }).fill('My draft should survive a page refresh.');
  const savedUrl = page.url();
  await page.reload();
  await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue('My draft should survive a page refresh.');
  for (let answer = 2; answer <= 6; answer++) {
    await submitExample(page, answer === 6);
    if (answer < 6) await expect(page.locator('.practice-progress__label')).toContainText(`0${answer + 1}`);
  }
  await expect(page.getByRole('heading', { name: /A clearer place to go next/ })).toBeVisible();
  await expect(page.locator('.review-intro')).toContainText('6 answers completed');
  await expect(page.locator('.turn-detail')).toHaveCount(6);
  await page.locator('.review-point__links').getByRole('button', { name: 'Your answer', exact: true }).first().click();
  await expect(page.locator('details.turn-detail[open]')).toHaveCount(1);
  await page.getByRole('link', { name: 'blurtReply home' }).click();
  await expect(page.locator('.recent-row').first()).toContainText('6 of 6 answers');
  await page.locator('.recent-row').first().click();
  await expect(page).toHaveURL(savedUrl);
  expect(errors).toEqual([]);
});

test('mobile biology practice supports keyboard tabs, reading mode, and an early review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page, 'cell-biology');
  await page.getByRole('button', { name: 'Turn on reading mode' }).click();
  await expect(page.getByRole('button', { name: 'Turn off reading mode' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Agents' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true');
  await submitExample(page);
  await expect(page.locator('.practice-progress__label')).toContainText('02');
  await page.getByRole('button', { name: 'Finish here' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 answer');
  await page.getByRole('button', { name: 'Create my review' }).click();
  await expect(page.locator('.review-intro')).toContainText('1 answer completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

function selectablePdf(): Buffer {
  const lines = [
    'Ethics revision notes',
    'Consequentialism evaluates an action by its consequences for those affected.',
    'Deontology considers duties and constraints that can apply regardless of outcomes.',
    'Virtue ethics asks about the character and practical judgement of the person acting.',
    'A strong comparison distinguishes a theory from the justification of a particular choice.',
  ];
  const pageStream = (content: string[]) => `BT /F1 12 Tf 40 740 Td 18 TL ${content.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
  const stream = pageStream(lines.slice(0, 3));
  const secondStream = pageStream(lines.slice(3));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

test('extracts real PDF text, preserves its draft, and uses it as visible source material', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bring your material' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'Ethics revision.pdf', mimeType: 'application/pdf', buffer: selectablePdf() });
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Consequentialism evaluates/);
  await page.reload();
  await page.getByRole('button', { name: 'Bring your material' }).click();
  await expect(page.getByLabel('Your source material', { exact: true })).toHaveValue(/Virtue ethics/);
  await page.getByRole('button', { name: 'Start free demo' }).click();
  await expect(page.getByLabel('Your answer', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sources' }).click();
  await expect(page.locator('.source-list__name')).toContainText('Ethics revision.pdf');
  await expect(page.locator('.source-row strong')).toHaveText(['Page 1 · passage 1', 'Page 2 · passage 1']);
  await expect(page.locator('.source-row small')).toHaveText(['Page 1', 'Page 2']);
  await page.locator('.source-row').first().click();
  await expect(page.getByRole('dialog')).toContainText('Consequentialism');
  await expect(page.getByRole('dialog')).toContainText('[Page 1]');
  await page.keyboard.press('Escape');
  await page.locator('.source-row').nth(1).click();
  await expect(page.getByRole('dialog')).toContainText('Your source material / Page 2');
  await expect(page.getByRole('dialog')).toContainText('Virtue ethics');
  await expect(page.getByRole('dialog')).not.toContainText('Consequentialism');
});
