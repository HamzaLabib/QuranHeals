import { ConfirmSheet } from './ConfirmSheet';

type KhatmaReachedSheetProps = {
  visible: boolean;
  wirdName: string;
  labels: { title: string; confirm: string; notNow: string; failed: string };
  busy: boolean;
  failed: boolean;
  onConfirm: () => void;
  onNotNow: () => void;
};

/**
 * «ما شاء الله، أتممت ختم القرآن» — shown in the reader after a save took
 * the ورد from an earlier page to page 604. إتمام الختمة records the Khatma
 * (once); ليس الآن records nothing and leaves it pending in أورادي وختماتي.
 */
export function KhatmaReachedSheet(props: KhatmaReachedSheetProps) {
  return (
    <ConfirmSheet
      visible={props.visible}
      testID="khatma-reached"
      title={props.labels.title}
      body={props.wirdName}
      confirmLabel={props.labels.confirm}
      cancelLabel={props.labels.notNow}
      busy={props.busy}
      error={props.failed ? props.labels.failed : null}
      onConfirm={props.onConfirm}
      onCancel={props.onNotNow}
    />
  );
}
