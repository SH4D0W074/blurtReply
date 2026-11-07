import { expect, test, type Page } from '@playwright/test';

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('authored demo goes from private answers to discussion and a fresh reflection', async ({ page, context }, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start a class conversation.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('button', { name: 'Review the reasoning' })).toBeEnabled();
  const code = page.url().split('/').at(-1)!;
  const board = await context.newPage();
  board.on('pageerror', error => failures.push(error.message));
  await board.goto(`/board/${code}`);
  await expect(board.locator('.answer-object')).toHaveCount(6);
  expect(await board.locator('body').textContent()).not.toContain('increasing sample size never reduces random error');

  await page.getByRole('button', { name: 'Review the reasoning' }).click();
  await expect(page.getByRole('button', { name: 'Reveal the reasons' })).toBeEnabled();
  await expect(page.getByText('Suggested groups · not yet sent')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal the reasons' }).click();
  await expect(board.locator('.answer-object.is-revealed')).toHaveCount(6);
  await expect(board.locator('.answer-object__turn').first()).toHaveCSS('transform', 'none');
  await expect(board.getByText('“No, because increasing sample size never reduces random error.”')).toBeVisible();
  await board.getByRole('button', { name: /Read .* complete explanation/ }).first().click();
  await expect(board.getByRole('dialog')).toBeVisible();
  await board.getByRole('button', { name: 'Close explanation' }).click();
  await board.screenshot({ path: testInfo.outputPath('reveal.png'), fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'Start the discussion' }).click();
  await expect(board.getByRole('heading', { name: 'Think together. Leave room for difference.' })).toBeVisible();
  await expect(board.locator('.board-pair').first()).toBeVisible();
  await noHorizontalOverflow(board);
  await board.screenshot({ path: testInfo.outputPath('discussion.png'), fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'Open the fresh question' }).click();
  await expect(board.getByRole('heading', { name: /Which design directly addresses/ })).toBeVisible();
  await page.getByRole('button', { name: 'See the class reflection' }).click();
  await expect(board.getByText('Different questions, not a measure of learning gain.', { exact: false })).toBeVisible();
  await expect(page.getByText('6 responded to both')).toBeVisible();
  await board.screenshot({ path: testInfo.outputPath('reflection.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Finish this session' }).click();
  await expect(page.getByRole('link', { name: 'Start another session' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Start another session' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('independent mobile students keep drafts, rejoin, discuss and submit their own transfer answers', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review the reasoning' })).toBeDisabled();
  const code = page.url().split('/').at(-1)!;
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const first = await mobileContext.newPage();
  const second = await secondContext.newPage();
  const base = 'http://localhost:4173';
  try {
    await first.goto(`${base}/join/${code}`);
    await first.getByRole('button', { name: 'Join the conversation' }).click();
    await first.getByRole('radio', { name: 'B No', exact: true }).check();
    const reason = 'Students outside sports clubs are still missing from the survey.';
    await first.getByLabel('What led you to that answer?').fill(reason);
    await first.reload();
    await expect(first.getByLabel('What led you to that answer?')).toHaveValue(reason);
    await expect(first.getByRole('radio', { name: 'B No', exact: true })).toBeChecked();
    await noHorizontalOverflow(first);
    await first.screenshot({ path: testInfo.outputPath('mobile-answer.png'), fullPage: true, animations: 'disabled' });
    await first.getByRole('button', { name: 'Send my response' }).click();
    await expect(first.getByRole('heading', { name: 'Your thinking is in the room.' })).toBeVisible();
    const firstAlias = await first.locator('.student-identity strong').textContent();
    await first.reload();
    await expect(first.locator('.student-identity strong')).toHaveText(firstAlias!);

    await second.goto(`${base}/join/${code}`);
    await second.getByRole('button', { name: 'Join the conversation' }).click();
    await second.getByRole('radio', { name: 'A Yes', exact: true }).check();
    await second.getByLabel('What led you to that answer?').fill('I think a thousand responses will make the sample representative.');
    await second.getByRole('button', { name: 'Send my response' }).click();
    await expect(second.getByRole('heading', { name: 'Your thinking is in the room.' })).toBeVisible();
    const secondAlias = await second.locator('.student-identity strong').textContent();
    expect(secondAlias).not.toBe(firstAlias);

    await expect(page.getByRole('tab', { name: 'Responses 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Review the reasoning' }).click();
    await expect(page.getByRole('button', { name: 'Reveal the reasons' })).toBeEnabled();
    // With live AI explicitly disabled, comparison groups still support a real classroom flow.
    const hostSnapshot = await (await page.request.get(`/api/rooms/${code}?view=host`)).json();
    expect(hostSnapshot.host.responses.every((response: { analysis: { source: string } }) => response.analysis.source === 'fallback')).toBe(true);
    await page.getByRole('button', { name: 'Reveal the reasons' }).click();
    await page.getByRole('button', { name: 'Start the discussion' }).click();
    await expect(first.getByRole('heading', { name: `You’re with ${secondAlias}.` })).toBeVisible();
    await expect(second.getByRole('heading', { name: `You’re with ${firstAlias}.` })).toBeVisible();
    await noHorizontalOverflow(first);
    await first.screenshot({ path: testInfo.outputPath('mobile-discussion.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Open the fresh question' }).click();
    await expect(first.getByRole('heading', { name: 'Try a different situation.' })).toBeVisible();
    await first.getByRole('radio', { name: 'B Team B', exact: true }).check();
    await first.getByLabel('What led you to that answer?').fill('The whole student list is included, though a random sample can vary.');
    await first.getByRole('button', { name: 'Send my response' }).click();
    await second.getByRole('radio', { name: 'D I am not sure', exact: true }).check();
    await second.getByLabel('What led you to that answer?').fill('I am still unsure how to compare the two sampling methods.');
    await second.getByRole('button', { name: 'Send my response' }).click();
    await expect(page.getByRole('tab', { name: 'Responses 2' })).toBeVisible();
    await page.getByRole('button', { name: 'See the class reflection' }).click();
    await expect(first.getByRole('heading', { name: 'Keep the conversation.' })).toBeVisible();
    await expect(page.getByText('2 responded to both')).toBeVisible();
    const final = await (await page.request.get(`/api/rooms/${code}?view=host`)).json();
    expect(final.summary).toMatchObject({ initialTotal: 2, transferTotal: 2, initialExpected: 1, transferExpected: 1, matchedRespondents: 2 });
  } finally {
    await mobileContext.close();
    await secondContext.close();
  }
});

test('a separate visitor cannot open the lecturer controls and invalid room codes recover clearly', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('button', { name: 'Review the reasoning' })).toBeEnabled();
  const hostUrl = page.url();
  const visitorContext = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(hostUrl);
    await expect(visitor.getByRole('button', { name: 'Review the reasoning' })).toHaveCount(0);
    await expect(visitor.getByRole('link', { name: 'Back to Pairwise' })).toBeVisible();
    await visitor.goto('http://localhost:4173/join');
    await visitor.getByLabel('Room code').fill('ZZZZZZ');
    await visitor.getByRole('button', { name: 'Find this room' }).click();
    await expect(visitor.getByRole('heading', { name: 'Let’s find your room.' })).toBeVisible();
    await noHorizontalOverflow(visitor);
  } finally {
    await visitorContext.close();
  }
});

test('saved clarification remains visible and an existing student who missed round one can still answer the fresh question', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review the reasoning' })).toBeDisabled();
  const code = page.url().split('/').at(-1)!;
  const participantContext = await browser.newContext({ reducedMotion: 'reduce' });
  const lateContext = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const participant = await participantContext.newPage();
    const late = await lateContext.newPage();
    for (const student of [participant, late]) {
      await student.goto(`http://localhost:4173/join/${code}`);
      await student.getByRole('button', { name: 'Join the conversation' }).click();
      await expect(student.getByRole('heading', { name: 'What do you think?' })).toBeVisible();
    }
    await participant.getByRole('radio', { name: 'B No', exact: true }).check();
    await participant.getByLabel('What led you to that answer?').fill('No, I do not think so.');
    await participant.getByRole('button', { name: 'Send my response' }).click();
    await expect(page.getByRole('tab', { name: 'Responses 1' })).toBeVisible();
    await page.getByRole('button', { name: 'Review the reasoning' }).click();
    await participant.getByLabel('Your clarification').fill('Students who do not join sports clubs cannot take part.');
    await participant.getByRole('button', { name: 'Add my clarification' }).click();
    await expect(participant.getByText('Clarification received', { exact: true })).toBeVisible();
    await participant.reload();
    await expect(participant.getByText('Clarification received', { exact: true })).toBeVisible();
    await expect(late.getByRole('heading', { name: 'Stay for the conversation.' })).toBeVisible();
    await expect(late.getByText('Response received', { exact: true })).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Review clarifications (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Use comparison groups', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal the reasons' }).click();
    await page.getByRole('button', { name: 'Start the discussion' }).click();
    await page.getByRole('button', { name: 'Open the fresh question' }).click();
    await expect(late.getByRole('heading', { name: 'Try a different situation.' })).toBeVisible();
    await late.getByRole('radio', { name: 'B Team B', exact: true }).check();
    await late.getByLabel('What led you to that answer?').fill('The full enrolment list includes students outside the cycling club.');
    await late.getByRole('button', { name: 'Send my response' }).click();
    await expect(late.getByRole('heading', { name: 'Thanks for thinking again.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Responses 1' })).toBeVisible();
    await page.getByRole('button', { name: 'See the class reflection' }).click();
    const final = await (await page.request.get(`/api/rooms/${code}?view=host`)).json();
    expect(final.summary).toMatchObject({ initialTotal: 1, transferTotal: 1, matchedRespondents: 0 });
  } finally {
    await participantContext.close();
    await lateContext.close();
  }
});

test('an old poll cannot undo an acknowledged student join', async ({ page, browser }) => {
  const created = await page.request.post('/api/rooms', { data: { lessonId: 'sampling', mode: 'live' } });
  const { code } = await created.json();
  const studentContext = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const student = await studentContext.newPage();
    await student.goto(`http://localhost:4173/join/${code}`);
    await expect(student.getByRole('button', { name: 'Join the conversation' })).toBeVisible();
    let release!: () => void;
    let captured!: () => void;
    const oldSnapshotCaptured = new Promise<void>(resolve => { captured = resolve; });
    const releaseOldSnapshot = new Promise<void>(resolve => { release = resolve; });
    await student.route(`**/api/rooms/${code}?view=student`, async route => {
      const response = await route.fetch();
      captured();
      await releaseOldSnapshot;
      await route.fulfill({ response });
    }, { times: 1 });
    await oldSnapshotCaptured;
    await student.getByRole('button', { name: 'Join the conversation' }).click();
    await expect(student.getByRole('heading', { name: 'What do you think?' })).toBeVisible();
    release();
    await student.waitForTimeout(200);
    await expect(student.getByRole('heading', { name: 'What do you think?' })).toBeVisible();
    await expect(student.getByRole('button', { name: 'Join the conversation' })).toHaveCount(0);
  } finally {
    await studentContext.close();
  }
});
