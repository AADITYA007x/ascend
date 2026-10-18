// "Your data": save a backup file and restore one. The checking lives in model/backup.js.
import { h, icon } from './dom.js';
import { confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { state, reload } from '../state.js';
import { exportAll, replaceAll, setMeta } from '../db/repo.js';
import { makeBackup, parseBackup, backupFileName, countsLine } from '../model/backup.js';
import { todayYMD, relativeDays, formatDate } from '../model/time.js';
import { navigate, rerender } from '../router.js';

/** Downloads everything on this device as one JSON file. */
export async function saveBackup() {
  try {
    const now = new Date();
    const backup = makeBackup(await exportAll(), now);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: backupFileName(todayYMD(now)) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await setMeta('lastBackupAt', now.toISOString());
    await reload();
    rerender();
    toast('Backup saved to your downloads');
  } catch (err) {
    console.error(err);
    toast('Couldn’t save the backup. Please try again.');
  }
}

/** Lets you pick a backup file, shows what's in it, and replaces everything once you agree. */
export function restoreBackup() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      toast(parsed.error, { duration: 6000 });
      return;
    }
    const from = parsed.exportedAt ? ` from ${formatDate(todayYMD(new Date(parsed.exportedAt)))}` : '';
    const ok = await confirmSheet({
      title: 'Restore this backup?',
      message: `It has ${countsLine(parsed.counts)}. Everything on this device now will be replaced by the backup${from}.`,
      confirmLabel: 'Replace',
    });
    if (!ok) return;
    try {
      await replaceAll(parsed.stores);
      await reload();
      navigate('today');
      toast('Backup restored');
    } catch (err) {
      console.error(err);
      toast('Couldn’t restore that backup. Nothing was changed.', { duration: 6000 });
    }
  });
  document.body.append(input);
  input.click();
}

/** The "Your data" card on the Semester screen. */
export function backupCard() {
  const last = state.lastBackupAt ? relativeDays(todayYMD(), todayYMD(new Date(state.lastBackupAt))) : null;
  return h(
    'section',
    { class: 'card backup-card' },
    h('h2', { class: 'card-title' }, 'Your data'),
    h('p', { class: 'muted' }, 'Everything lives only on this device. Save a backup file now and then, and before changing phones.'),
    h('p', { class: 'muted small' }, last ? `Last backup: ${last.toLowerCase()}` : 'No backup yet'),
    h(
      'div',
      { class: 'backup-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: saveBackup }, icon('down', 18), 'Save backup'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: restoreBackup }, icon('file', 18), 'Restore from backup'),
    ),
  );
}
