import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRequestGenerationIssues } from '../../domain/requests/request-issue-presentation';
import type { RequestValidationIssue } from '../../domain/requests/request-domain';

const issues: RequestValidationIssue[] = [
  {
    version: 'request-validation-issue/1',
    kind: 'CONFLICT',
    reason: 'OVERLAPPING_POSITIVE_INTENT',
    year: 1404,
    month: 5,
    personnelId: 'p1',
    days: [4, 6],
    requestIds: ['request-a', 'request-b'],
    conflictId: 'conflict:test',
    essentialFlags: [
      { requestId: 'request-a', isEssential: false },
      { requestId: 'request-b', isEssential: true },
    ],
  },
  {
    version: 'request-validation-issue/1',
    kind: 'INVALID',
    reason: 'EMPTY_PATTERN',
    year: 1404,
    month: 5,
    personnelId: 'p2',
    requestIds: ['request-c'],
  },
];

test('generation-blocking request issues are shown with person, days, and IDs', () => {
  const message = formatRequestGenerationIssues(issues, new Map([
    ['p1', 'پرستار اول'],
    ['p2', 'پرستار دوم'],
  ]));

  assert.match(message, /درخواست‌های ثبت‌شده نیاز به اصلاح دارند/);
  assert.match(message, /پرستار اول/);
  assert.match(message, /روزهای 4، 6/);
  assert.match(message, /request-a، request-b/);
  assert.match(message, /الگوی شیفت خالی است/);
  assert.match(message, /request-c/);
});
