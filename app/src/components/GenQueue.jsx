import Dialog from './Dialog.jsx';
import { t } from '../i18n.js';

const ICON = { queued: '⏳', running: '✦', done: '✓', reused: '♻', error: '⚠', cancelled: '✕' };
const COLOR = { running: 'var(--accent)', done: 'var(--good)', reused: 'var(--good)', error: 'var(--bad)', cancelled: 'var(--dim)' };

// The generation queue: every job with its album, in order. Cancel waiting jobs, retry failed ones.
export default function GenQueue({ jobs, onCancel, onRetry, onClear, onOpenAlbum, onClose }) {
  const waiting = jobs.filter((j) => j.state === 'queued').length;
  return (
    <Dialog title={t('✦ Generation queue')} onClose={onClose} width={640}
      footer={<><span className="dim" style={{ fontSize: 12, marginInlineEnd: 'auto' }}>{t('Runs in the background — each result goes to its own album and folder, whatever you have open.')}</span>
        <button onClick={onClear} disabled={!jobs.some((j) => j.state !== 'queued' && j.state !== 'running')}>{t('Clear finished')}</button>
        <button className="primary" onClick={onClose}>{t('Close')}</button></>}>
      {!jobs.length && <p className="note">{t('Nothing queued.')}</p>}
      {waiting > 0 && <p className="note">{t('{waiting} waiting · one at a time.', { waiting: waiting })}</p>}
      <div className="wiz-list" style={{ maxHeight: 420 }}>
        {jobs.map((j) => (
          <div key={j.id} className="row" style={{ padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
            <span style={{ color: COLOR[j.state], width: 18 }}>{ICON[j.state]}</span>
            <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b>{j.title}</b> <span className="dim">· </span>
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenAlbum(j.projectId); }}>{j.album}</a>
              {j.error && <div style={{ color: 'var(--bad)', fontSize: 11, whiteSpace: 'normal' }}>{j.error}</div>}
            </span>
            <span className="dim" style={{ fontSize: 11 }}>{j.state === 'reused' ? t('reused identical audio') : j.state}</span>
            {j.state === 'queued' && <button className="mini" onClick={() => onCancel(j)}>{t('Cancel')}</button>}
            {j.state === 'error' && <button className="mini" onClick={() => onRetry(j)}>{t('Retry')}</button>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
