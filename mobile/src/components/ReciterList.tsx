import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { coverageLabel } from '@/audio/format';
import { RECITERS, reciterName } from '@/audio/reciters';
import type { Messages } from '@/localization/messages';

export type ReciterListTone = { text: string; muted: string; accent: string; selected: string; divider: string };

type ReciterListProps = {
  selectedId: string | null;
  onSelect: (reciterId: string) => void;
  copy: Messages['audio'];
  rtl: boolean;
  tone: ReciterListTone;
  /** A short badge after a reciter's name ("Reciting", "Up next"). */
  badge?: (reciterId: string) => string | null;
  /** Replaces the coverage line (e.g. "Not available for this surah"). */
  note?: (reciterId: string) => string | null;
  testIDPrefix?: string;
};

/**
 * The 17 reciters, in the approved order, each with its name in the app's language and, unless it has all 114 surahs,
 * how much of the Quran it can play ayah by ayah ("103 of 114 surahs", "Ayah-by-ayah playback not available"): every
 * reciter is listed and selectable, with its gaps shown, never hidden. Used by Settings → Favorite Reciter and the Mushaf player.
 */
export function ReciterList({ selectedId, onSelect, copy, rtl, tone, badge, note, testIDPrefix = 'reciter' }: ReciterListProps) {
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  return (
    <View>
      {RECITERS.map((reciter, index) => {
        const selected = reciter.id === selectedId;
        const name = reciterName(reciter, rtl);
        const tag = badge?.(reciter.id) ?? null;
        const line = note?.(reciter.id) ?? coverageLabel(reciter, copy, rtl);
        return (
          <Pressable
            key={reciter.id}
            testID={`${testIDPrefix}-${reciter.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={[name, tag, line].filter(Boolean).join(', ')}
            onPress={() => onSelect(reciter.id)}
            style={({ pressed }) => [
              styles.row,
              rtl && styles.rowRtl,
              index > 0 && { borderTopColor: tone.divider, borderTopWidth: StyleSheet.hairlineWidth },
              selected && { backgroundColor: tone.selected },
              pressed && styles.pressed,
            ]}>
            <View style={styles.texts}>
              <View style={[styles.nameRow, rtl && styles.rowRtl]}>
                <Text style={[styles.name, { color: tone.text }, align]} numberOfLines={1}>{name}</Text>
                {tag && <Text style={[styles.badge, { color: tone.accent, borderColor: tone.accent }]}>{tag}</Text>}
              </View>
              {line && <Text style={[styles.line, { color: tone.muted }, align]} numberOfLines={2}>{line}</Text>}
            </View>
            {selected && <Check size={18} color={tone.accent} strokeWidth={2.5} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  texts: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  line: {
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
