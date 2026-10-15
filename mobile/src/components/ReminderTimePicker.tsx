import { useEffect } from 'react';

import type { LocalTime } from '@/notifications/types';

export type ReminderTimePickerProps = {
  visible: boolean;
  value: LocalTime;
  /** "Reminder time" and the reminder's name, for the picker's heading. */
  title: string;
  uses24HourClock: boolean | null;
  onConfirm: (time: LocalTime) => void;
  onCancel: () => void;
};

/**
 * Web (and the Node tests): reminders are not scheduled there, so there is no
 * picker; an opening is simply cancelled, after the render. Native builds use
 * ReminderTimePicker.native.tsx (the system time picker).
 */
export function ReminderTimePicker({ visible, onCancel }: ReminderTimePickerProps) {
  useEffect(() => {
    if (visible) onCancel();
  }, [visible, onCancel]);
  return null;
}
