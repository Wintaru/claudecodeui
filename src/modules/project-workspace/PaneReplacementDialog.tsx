import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { getSessionTitle } from '@/shared/utils';
import { MAX_SPLIT_PANES } from '@/modules/project-workspace/hooks/useSplitPanes';
import type { PaneReplacementChoice, PaneReplacementPrompt } from '@/shared/types';

type PaneReplacementDialogProps = {
  prompt: PaneReplacementPrompt | null;
  isSplitFull: boolean;
  onResolve: (choice: PaneReplacementChoice) => void;
};

/**
 * Rendered by ProjectMainRegion when a conversation chosen in the sidebar would
 * take the place of one in the split view. Cancel comes first in the DOM so the
 * dialog's open-focus lands on it, as in BackgroundSendDialog: Esc, a click
 * outside, and an early Enter all leave the panes as they are.
 */
export default function PaneReplacementDialog({ prompt, isSplitFull, onResolve }: PaneReplacementDialogProps) {
  const title = prompt ? getSessionTitle(prompt.session) : '';
  const replacedTitle = prompt?.replacedTitle ?? '';

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) {
          onResolve('cancel');
        }
      }}
    >
      <DialogContent aria-describedby="pane-replacement-dialog-description" className="p-5">
        <DialogTitle className="not-sr-only break-words text-base font-semibold text-foreground">
          {`Replace "${replacedTitle}"?`}
        </DialogTitle>

        <p id="pane-replacement-dialog-description" className="mt-3 break-words text-sm text-muted-foreground">
          {isSplitFull
            ? `All ${MAX_SPLIT_PANES + 1} panes are in use. Show "${title}" in place of "${replacedTitle}", or close a pane first.`
            : `Open "${title}" in a new pane, or show it in place of "${replacedTitle}".`}
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onResolve('cancel')}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => onResolve('replace')}>
            Replace
          </Button>
          <Button type="button" variant="default" disabled={isSplitFull} onClick={() => onResolve('newPane')}>
            Open in new pane
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
