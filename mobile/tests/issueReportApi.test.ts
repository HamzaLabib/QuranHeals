import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.2.3' } } }));

const { submitFeedback, submitIssueReport, IssueReportApiError } = await import('@/services/issueReportApi');

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
      source: 'ayah',
      category: 'translation_issue',
      comment: 'Cut off.',
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      appLocale: 'en',
      translationDisplayMode: 'on-demand',
    });

    expect(sentBody).toMatchObject({
      category: 'translation_issue',
      verseKey: '2:255',
      appVersion: '1.2.3',
      platform: 'ios',
    });
    expect(sentBody).not.toHaveProperty('emotionKey');
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

    await submitIssueReport({ source: 'settings', category: 'other', comment: 'Broken.', appLocale: 'ar', translationDisplayMode: 'always' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws IssueReportApiError on a non-ok response or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(submitIssueReport({ source: 'settings', category: 'other', comment: 'Broken.', appLocale: 'en', translationDisplayMode: 'off' })).rejects.toBeInstanceOf(
      IssueReportApiError,
    );

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(submitIssueReport({ source: 'settings', category: 'other', comment: 'Broken.', appLocale: 'en', translationDisplayMode: 'off' })).rejects.toBeInstanceOf(
      IssueReportApiError,
    );
  });
});

describe('submitFeedback', () => {
  const capture = () => {
    const sent: { body: Record<string, unknown>; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/issues');
      sent.push({ body: JSON.parse(String(init?.body)), init });
      return new Response(JSON.stringify({ success: true, data: null }), { status: 201 });
    }));
    return sent;
  };

  it('posts to the same reporting endpoint as type feedback from Home, with only the message, optional email and App Language', async () => {
    const sent = capture();
    await submitFeedback({ comment: 'Lovely app.', email: 'me@example.com', appLocale: 'ar' });
    expect(sent[0].body).toEqual({ type: 'feedback', source: 'home', comment: 'Lovely app.', email: 'me@example.com', appLocale: 'ar', appVersion: '1.2.3', platform: 'ios' });
    expect((sent[0].init?.headers ?? {}) as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('an issue names its type and source, so the backend can tell the two apart', async () => {
    const sent = capture();
    await submitIssueReport({ source: 'ayah', category: 'other', comment: 'x', verseKey: '1:1', surahNumber: 1, ayahNumber: 1, appLocale: 'en', translationDisplayMode: 'off' });
    expect(sent[0].body).toMatchObject({ type: 'issue', source: 'ayah' });
    expect(sent[0].body).not.toHaveProperty('translationId');
  });

  it('only resolves after the backend accepted it; a rejection (e.g. 429 rate limit) or network failure throws', async () => {
    for (const status of [400, 429, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      await expect(submitFeedback({ comment: 'x', appLocale: 'en' })).rejects.toBeInstanceOf(IssueReportApiError);
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    await expect(submitFeedback({ comment: 'x', appLocale: 'en' })).rejects.toBeInstanceOf(IssueReportApiError);
  });
});
