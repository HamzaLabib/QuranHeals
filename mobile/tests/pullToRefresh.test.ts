import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const favoritesSource = readFileSync(resolve(__dirname, '../src/app/favorites.tsx'), 'utf-8');

describe('Favorites screen: pull-to-refresh (Part 2)', () => {
  it('uses RefreshControl on the existing ScrollView — no new native dependency', () => {
    expect(favoritesSource).toMatch(/from 'react-native'/);
    expect(favoritesSource).toMatch(/RefreshControl/);
    expect(favoritesSource).toMatch(/refreshControl=\{/);
  });

  it('reuses the existing full sync (favorites + preferences + reflections) instead of a duplicate sync implementation', () => {
    expect(favoritesSource).toMatch(/refreshSync\(\)/);
    expect(favoritesSource).toMatch(/from '@\/auth\/useAuth'/);
  });

  it('re-reads local storage into the favorites hook after syncing, so the UI reflects newly-synced data', () => {
    expect(favoritesSource).toMatch(/await refreshFavorites\(\)/);
  });

  it('guards a rapid repeated pull from starting an overlapping second refresh', () => {
    expect(favoritesSource).toMatch(/if \(isRefreshing\) return;/);
  });

  it('always clears the refreshing state, including when the sync fails', () => {
    const block = favoritesSource.match(/const onPullToRefresh = useCallback\(async \(\) => \{[\s\S]*?\}, \[/)?.[0] ?? '';
    expect(block).toMatch(/try \{[\s\S]*\} finally \{\s*setIsRefreshing\(false\);/);
  });
});
