import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.2.3' } } }));

const { submitIssueReport, IssueReportApiError } = await import('@/services/issueReportApi');

afterEach(() => vi.unstubAllGlobals());

describe('submitIssueReport', () => {
  it('sends the safe automatic context plus platform/appVersion — and nothing account/reflection-related', async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/issues');
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: null }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitIssueReport({
      category: 'translation_issue',
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      emotionKey: 'sad',
      appLocale: 'en',
      translationDisplayMode: 'on-demand',
    });

    expect(sentBody).toMatchObject({
      category: 'translation_issue',
      verseKey: '2:255',
      appVersion: '1.2.3',
      platform: 'ios',
    });
    expect(sentBody).not.toHaveProperty('reflection');
    expect(sentBody).not.toHaveProperty('userId');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('headers.Authorization');
  });

  it('never attaches an Authorization header — works identically signed in or as a guest', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return new Response(JSON.stringify({ success: true, data: null }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitIssueReport({ category: 'other', appLocale: 'ar', translationDisplayMode: 'always' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws IssueReportApiError on a non-ok response or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(submitIssueReport({ category: 'other', appLocale: 'en', translationDisplayMode: 'off' })).rejects.toBeInstanceOf(
      IssueReportApiError,
    );

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(submitIssueReport({ category: 'other', appLocale: 'en', translationDisplayMode: 'off' })).rejects.toBeInstanceOf(
      IssueReportApiError,
    );
  });
});
